// 浏览器侧（client.js）预览时序检查：用最小 React / DOM / 定时器替身跑真实工厂，只验证策略，
// 不验证样式——防抖、单飞（同一时刻只判一次）、陈旧结果丢弃、预览时历史只留一条。
//
//     node client.test.mjs
//
// 为什么值得这些替身：预览的承诺就是"输入时不一直生成"。这条性质只存在于 client.js 的定时器与
// 状态机里，host 侧的单测和真实服务都证明不了它；把它写成断言，才能防止以后一次重构悄悄退回
// "每敲一个字判一次"。

let pass = 0;
const fail = [];
function check(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else fail.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── 假定时器 ────────────────────────────────────────────────────────────────────────────────
// 真实的 700ms 防抖会让测试既慢又不稳；这里把时间变成可以精确推进的队列。
let clock = 0;
let timerId = 0;
let timers = [];
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (fn, ms) => {
  const id = ++timerId;
  timers.push({ id, at: clock + (typeof ms === 'number' ? ms : 0), fn });
  return id;
};
globalThis.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
globalThis.setInterval = () => { return ++timerId; }; // 轮询另行驱动，不要让定时器队列自己跑
globalThis.clearInterval = () => {};
/** 推进时间：按到期顺序执行定时器，每次执行后让微任务落地（Promise 链）。 */
async function advance(ms) {
  const target = clock + ms;
  for (;;) {
    const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
    if (due === undefined) break;
    timers = timers.filter((t) => t !== due);
    clock = due.at;
    due.fn();
    await flush();
  }
  clock = target;
  await flush();
}
/** 排队中的微任务落地（含 Promise.then 链），并让由此引发的重渲染跑完。 */
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

// ── 最小 React 替身 ─────────────────────────────────────────────────────────────────────────
function createReactRuntime() {
  const slotValues = [];
  let effects = [];
  let cursor = 0;
  let collected = null;
  let dirty = false;
  let rootRender = null;
  let tree = null;

  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

  function schedule() {
    if (dirty) return;
    dirty = true;
    Promise.resolve().then(paint);
  }

  function paint() {
    dirty = false;
    cursor = 0;
    collected = new Map();
    tree = rootRender();
    const next = effects.slice();
    for (const [index, entry] of collected) {
      const prev = effects[index];
      if (prev !== undefined && sameDeps(prev.deps, entry.deps)) continue;
      if (prev !== undefined && typeof prev.cleanup === 'function') prev.cleanup();
      const cleanup = entry.fn();
      next[index] = { deps: entry.deps, cleanup: typeof cleanup === 'function' ? cleanup : null };
    }
    for (let index = 0; index < next.length; index++) {
      if (next[index] === undefined) continue;
      if (collected.has(index)) continue;
      if (typeof next[index].cleanup === 'function') next[index].cleanup();
      next[index] = undefined;
    }
    effects = next;
  }

  function useState(initial) {
    const index = cursor++;
    if (!(index in slotValues)) {
      slotValues[index] = typeof initial === 'function' ? initial() : initial;
    }
    const set = (next) => {
      const value = typeof next === 'function' ? next(slotValues[index]) : next;
      if (Object.is(value, slotValues[index])) return;
      slotValues[index] = value;
      schedule();
    };
    return [slotValues[index], set];
  }

  function useEffect(fn, deps) {
    const index = cursor++;
    const entry = { fn, deps };
    if (collected !== null && !collected.has(index)) collected.set(index, entry);
  }

  function createElement(type, props, ...children) {
    return { type, props: props === undefined || props === null ? {} : props, children };
  }

  /**
   * 展开函数组件。真实 React 会替我们做这一步；这里的应用只有一颗组件树，所以直接调用即可，
   * 它的 hooks 会落进同一串 hook 槽位里。
   */
  function expand(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { type: node.type, props: node.props, children: node.children.map(expand) };
  }

  return {
    React: { useState, useEffect, createElement },
    mount(render) {
      rootRender = () => expand(render());
      paint();
    },
    schedule,
    get tree() { return tree; },
  };
}

/** 把渲染树摊平成文本，便于对芯片文案做断言。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children);
}

/** 按 className 片段收集元素（芯片本体、弹层、弹层里的行）。 */
function findAll(node, fragment, found) {
  const out = found === undefined ? [] : found;
  if (node === null || node === undefined || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, fragment, out);
    return out;
  }
  const className = node.props.className;
  if (typeof className === 'string' && className.split(' ').includes(fragment)) out.push(node);
  for (const child of node.children) findAll(child, fragment, out);
  return out;
}

// ── 假浏览器 ────────────────────────────────────────────────────────────────────────────────
const PREVIEW_URL = '/router-laya/preview';
const STATE_URL = 'http://127.0.0.1:8765/state';
const MODE_URL = '/router-laya/mode';

let loaded = null;
globalThis.window = { __ModuleLoader__: { load(module) { loaded = module; } } };
globalThis.document = {
  visibilityState: 'visible',
  createElement: () => ({ setAttribute() {}, textContent: '', parentNode: null }),
  head: { appendChild() {} },
  querySelector: () => null,
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const runtime = createReactRuntime();
const draftStore = { value: '', listeners: new Set() };
/**
 * 模拟一次按键：写入草稿 → 订阅者同步 → 落下微任务让重渲染（以及它安排的防抖定时器）真正发生。
 * 不 flush 就去推进时间，会越过"渲染结束后才挂上的定时器"，测出来的时序就不是真实时序。
 */
async function setDraft(text) {
  draftStore.value = text;
  for (const fn of Array.from(draftStore.listeners)) fn();
  await flush();
}
/** 标准 props 里的 `useInput`：订阅草稿，变化时触发重渲染。 */
function useInput(selector) {
  const value = selector({ draft: draftStore.value });
  runtime.React.useEffect(() => {
    const fn = () => runtime.schedule();
    draftStore.listeners.add(fn);
    return () => draftStore.listeners.delete(fn);
  }, []);
  return value;
}

// 两个历史判定（真实的一行 + 更早的一行），这样"预览时只显示一条"才有对照。
const HISTORY = {
  sessions: {
    S: [
      { ts: 1700000000, tier: 'low', triggered_by: 'laya', regenerate: false, ms: 900, task: '旧任务' },
      { ts: 1700000100, tier: 'low', triggered_by: 'laya', regenerate: false, ms: 900, task: '新任务' },
    ],
  },
  protocol: 'finetuned',
};

const previewCalls = [];
let previewPending = [];
let previewReply = { tier: 'high', triggeredBy: 'laya' };
globalThis.fetch = (url, init) => {
  const href = String(url);
  if (href === PREVIEW_URL) {
    previewCalls.push(JSON.parse(init.body));
    return new Promise((resolve) => previewPending.push(resolve));
  }
  if (href === STATE_URL) {
    return Promise.resolve({ ok: true, json: async () => HISTORY });
  }
  if (href === MODE_URL) {
    return Promise.resolve({ ok: true, json: async () => ({ mode: 'auto', writable: true }) });
  }
  return Promise.resolve({ ok: false, json: async () => null });
};
/** 让最早发起的那次预览请求返回。 */
async function answerPreview(body) {
  const resolve = previewPending.shift();
  const reply = body === undefined ? previewReply : body;
  resolve({ ok: true, json: async () => reply });
  await flush();
}

// ── 装载真实 client.js ──────────────────────────────────────────────────────────────────────
await import(new URL('./client.js', import.meta.url).href);
check('client bundle registers a module', loaded !== null, true);
const exportsObject = loaded.factory((name) => {
  if (name === 'react') return runtime.React;
  throw new Error(`unexpected require: ${name}`);
});

const registered = [];
exportsObject.apply({
  slots: {
    inject: (key, callback) => callback(),
    register: (meta, renderer) => { registered.push({ meta, renderer }); return () => {}; },
  },
  effect: (fn) => { const dispose = fn(); return dispose; },
});
check('client registers the composer cell', registered.map((r) => r.meta.id), ['router-laya-tier']);

runtime.mount(() => registered[0].renderer({ sessionId: 'S', useInput }));
await flush();
const chipNow = () => findAll(runtime.tree, 'routerLayaChip')[0];
const popoverRows = () => findAll(runtime.tree, 'routerLayaRow');
check('chip shows the last real judgement before any typing', textOf(chipNow()), 'AUTO · 低');

// 对照：没有预览时，悬停看到的是完整历史（本轮垫了两条）。
chipNow().props.onMouseEnter();
await advance(300);
check('hover shows the whole history when nothing is being previewed', popoverRows().length, 2);
chipNow().props.onMouseLeave();
await advance(150);

// ── 1. 太短的草稿不预判 ────────────────────────────────────────────────────────────────────
await setDraft('帮');
await advance(5000);
check('a one-character draft is never judged', previewCalls.length, 0);

// ── 2. 防抖：停手之前不判 ──────────────────────────────────────────────────────────────────
await setDraft('帮我设计一个分布式限流器');
await advance(699);
check('no judgement before the debounce elapses', previewCalls.length, 0);
await advance(1);
check('exactly one judgement once typing stops', previewCalls.length, 1);
check('the draft is what gets judged', previewCalls[0], { sessionId: 'S', text: '帮我设计一个分布式限流器' });
check('the chip announces the judgement in flight', textOf(chipNow()), '预选 · …');

// ── 3. 结果落到芯片上（虚线 = 预选，不是已生效档位） ──────────────────────────────────────
await answerPreview();
const previewChip = chipNow();
check('the previewed tier is shown', textOf(previewChip), '预选 · 高');
check('a preview is drawn as a dashed chip',
  previewChip.props.style.border, '1px dashed var(--dsw-alias-border-l1)');

// ── 4. 悬停时历史只留一条：就是这次预判 ───────────────────────────────────────────────────
previewChip.props.onMouseEnter();
await advance(300); // HOVER_SHOW_MS
check('hover opens the popover', findAll(runtime.tree, 'routerLayaPopover').length, 1);
check('a preview shows exactly one row', popoverRows().length, 1);
check('that row is the preview, not a history entry',
  findAll(runtime.tree, 'routerLayaPreviewRow').length, 1);
check('that row names the draft and marks itself as a preview',
  [textOf(popoverRows()[0]).includes('帮我设计一个分布式限流器'),
    textOf(popoverRows()[0]).endsWith('内容判断 · 预选')], [true, true]);
previewChip.props.onMouseLeave();
await advance(150);

// ── 5. 一次在飞时继续输入：不并发，settle 之后最多补一次 ──────────────────────────────────
await setDraft('帮我设计一个分布式限流器，要能扛住区域级故障');
await advance(700);
check('the new draft starts one judgement', previewCalls.length, 2);
for (const draft of ['a', 'ab', 'abc', 'abcd']) {
  await setDraft(draft);
  await advance(50);
}
await advance(2000);
check('typing while a judgement is in flight never fires a second one', previewCalls.length, 2);
await answerPreview();
await advance(2000);
check('at most one follow-up judgement after the settle gap', previewCalls.length <= 3, true);

// ── 6. 草稿清空（发送 / 删除）后预览消失，芯片回到真实档位 ──────────────────────────────────
await setDraft('');
await advance(5000);
check('clearing the draft clears the preview', textOf(chipNow()), 'AUTO · 低');

// ── 7. host 说预判不可用（判服务太旧）时闭嘴，不再反复请求 ────────────────────────────────
previewReply = { unsupported: true };
await setDraft('帮我优化一下性能');
await advance(700);
const before = previewCalls.length;
await answerPreview();
await advance(0);
check('an unsupported host turns the preview off', textOf(chipNow()), 'AUTO · 低');
await setDraft('帮我优化一下性能，再快一点');
await advance(5000);
check('no further judgements once the preview is off', previewCalls.length, before);

// ── 报告 ───────────────────────────────────────────────────────────────────────────────────
globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;
console.log('='.repeat(70));
console.log(`  router-laya client preview checks: ${pass} passed, ${fail.length} failed`);
console.log('='.repeat(70));
for (const line of fail) console.log('  FAIL ' + line);
process.exit(fail.length ? 1 : 0);
