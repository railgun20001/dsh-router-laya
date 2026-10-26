/**
 * Tier chip — browser half of `dsh-router-laya` (spec: docs/frontend-auto-tier-spec.md).
 *
 * Packaged as the client module system's lazy-CJS bundle: executing this file only REGISTERS a factory,
 * the module body runs at first materialization, and every side effect (including the stylesheet) lives
 * inside the factory closure. `require("react")` resolves against the shell's frozen platform seed.
 *
 * All colours, sizes, copy and timings are the spec's, copied verbatim; the two places where the spec's
 * literal value cannot be used as written are marked ADAPTED below with the reason.
 */
window.__ModuleLoader__.load({
  id: "dsh-router-laya",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })

    const React = require("react")

    // ── spec §2/§3/§4/§5 constants ────────────────────────────────────────────────────────────────
    const STATE_URL = "http://127.0.0.1:8765/state"
    // Same-origin, unlike /state: a static client bundle has no `host.call` and no `ctx.remote.settings`,
    // so the host half serves this route to read and switch the mode.
    const MODE_URL = "/router-laya/mode"
    const POLL_MS = 3000
    const POLL_FAILURES_BEFORE_OFFLINE = 2
    const TOAST_MS = 2000
    const TOAST_GAP_PX = 8
    const HOVER_SHOW_MS = 300
    const HOVER_HIDE_MS = 150
    const POPOVER_LIMIT = 20
    const TASK_CHARS = 30

    // ── composer preview (2026-10-26) ────────────────────────────────────────────────────────────
    // While the user types, the chip shows the tier the draft WOULD get, so the knob is visible
    // before the message is sent instead of only after. Three guards keep "preview" from turning
    // into "a judgment per keystroke":
    //
    //   PREVIEW_DEBOUNCE_MS  quiet time after the last keystroke before a judgment is asked for
    //   PREVIEW_SETTLE_MS    quiet time after an in-flight judgment settles before asking for the
    //                        next one -- a slow judge plus fast typing must not queue inferences
    //   PREVIEW_MIN_CHARS    below this there is nothing to judge (and "a"/"ab" are noise)
    //
    // Only ONE request is ever in flight; the newest draft supersedes the rest. The host reuses the
    // returned verdict when that exact text is sent, so the preview also removes the judge from the
    // send path.
    const PREVIEW_URL = "/router-laya/preview"
    const PREVIEW_DEBOUNCE_MS = 700
    const PREVIEW_SETTLE_MS = 900
    const PREVIEW_MIN_CHARS = 2
    /**
     * After the box is cleared (a send, mostly) pull /state once instead of waiting out the 3s poll:
     * the host commits the reused verdict as that turn starts, so the row this turn belongs to is
     * usually there a few hundred ms later. Without it the chip sits on "待判定" for a whole polling
     * period, which reads like the judgment was dropped.
     */
    const PREVIEW_REFRESH_MS = 400
    const PREVIEW_TEXT = { low: "预选 · 低", high: "预选 · 高", max: "预选 · MAX" }
    const PREVIEW_PENDING_TEXT = "预选 · …"
    const PREVIEW_TIP = "预选档位 · 按当前输入预判（点击切到手动）"

    const TIER_ORDER = { low: 0, high: 1, max: 2 }
    const TIER_COLOR = { low: "#3fb950", high: "#d29922", max: "#f85149" }
    const TIER_TEXT = { low: "AUTO · 低", high: "AUTO · 高", max: "AUTO · MAX" }
    const TIER_SHORT = { low: "低", high: "高", max: "MAX" }
    const OFFLINE_COLOR = "#8b949e"
    const OFFLINE_TEXT = "AUTO · 离线"
    const OFFLINE_TIP = "判定服务未启动 · 已落 low（powershell -File routing/start_router.ps1）"
    // The spec's five states do not cover "the service is healthy but nothing has been judged yet", which
    // is the real state on every fresh load: /state's log is in-memory and empty until this session's
    // first turn is judged. Showing the offline copy there claims a failure that is not happening.
    const PENDING_TEXT = "AUTO · 待判定"
    const PENDING_TIP = "自动 · 等待本轮判定"
    const MANUAL_TEXT = "手动"

    const TOAST_TEXT = {
      escalate_regenerate: "⤴ 升档 · 检测到重试",
      intent_force: "⚡ 用户指定",
      intent_inherit: "↻ 保持上轮",
      intent_exclude: "按你的要求排除",
    }
    const REASON_TEXT = {
      laya: "内容判断",
      escalate_regenerate: "检测到重试·升档",
      intent_force: "用户指定",
      intent_inherit: "保持上轮",
      intent_exclude: "用户排除",
    }

    const CSS = `
@keyframes routerLayaTierPop{0%{transform:scale(1)}40%{transform:scale(1.08)}100%{transform:scale(1)}}
@keyframes routerLayaBreathe{0%,100%{opacity:.85}50%{opacity:1}}
@keyframes routerLayaToastIn{0%{opacity:0;transform:translateY(4px)}100%{opacity:1;transform:translateY(0)}}
@keyframes routerLayaToastOut{0%{opacity:1}100%{opacity:0}}
.routerLayaChip{display:inline-flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;
  user-select:none;box-sizing:border-box;background:transparent;
  transition:background-color .16s ease-out,border-color .16s ease-out,color .3s ease}
.routerLayaChip:hover{background:var(--dsw-alias-interactive-bg-hover)}
.routerLayaDot{width:6px;height:6px;border-radius:999px;flex:none;transition:background-color .3s ease}
.routerLayaPop{animation:routerLayaTierPop 300ms ease-out}
.routerLayaMax{animation:routerLayaBreathe 2.4s ease-in-out infinite}
.routerLayaToast{position:absolute;bottom:calc(100% + ${TOAST_GAP_PX}px);right:0;white-space:nowrap;
  padding:4px 9px;border-radius:7px;font-size:11px;line-height:16px;pointer-events:none;
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-3,#fff));
  border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);
  box-shadow:0 6px 18px rgba(0,0,0,.14);animation:routerLayaToastIn .18s ease-out}
.routerLayaToastOut{animation:routerLayaToastOut .3s ease-in forwards}
.routerLayaPopover{position:absolute;bottom:calc(100% + 8px);right:0;width:330px;max-height:320px;
  overflow-y:auto;padding:6px;border-radius:9px;text-align:left;z-index:30;
  background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-3,#fff));
  border:1px solid var(--dsw-alias-border-l1);box-shadow:0 10px 28px rgba(0,0,0,.18)}
.routerLayaRow{display:flex;align-items:center;gap:7px;padding:3px 6px;border-radius:5px;font-size:11px;line-height:16px}
.routerLayaRow:hover{background:var(--dsw-alias-interactive-bg-hover)}
.routerLayaPreviewRow{border:1px dashed var(--dsw-alias-border-l1)}
.routerLayaTime{opacity:.55;font-variant-numeric:tabular-nums;flex:none}
.routerLayaTask{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.routerLayaWhy{opacity:.6;flex:none}
`

    // ── shared poll state: server owns the truth (spec §6 constraint 2) ──────────────────────────
    const store = { data: null, offline: false, failures: 0, mode: null, listeners: new Set() }
    let poller = null
    let styleEl = null

    function notify() {
      for (const fn of Array.from(store.listeners)) {
        try { fn() } catch (error) { /* one bad subscriber must not stop the rest */ }
      }
    }

    function sessionsList() {
      const data = store.data
      if (data === null || typeof data !== "object" || data === null) return null
      const sessions = data.sessions
      return sessions !== null && typeof sessions === "object" ? sessions : null
    }

    /** Session match (spec §2): by id when known, otherwise the newest ts across all sessions. */
    function rowsFor(sessionId) {
      const sessions = sessionsList()
      if (sessions === null) return []
      if (sessionId !== undefined && sessionId !== null && Array.isArray(sessions[sessionId])) {
        return sessions[sessionId]
      }
      let best = null
      let bestTs = -Infinity
      for (const key of Object.keys(sessions)) {
        const rows = sessions[key]
        if (!Array.isArray(rows) || rows.length === 0) continue
        const tail = rows[rows.length - 1]
        const ts = tail !== undefined && typeof tail.ts === "number" ? tail.ts : -Infinity
        if (ts > bestTs) { bestTs = ts; best = rows }
      }
      return best === null ? [] : best
    }

    function pollOnce() {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return
      fetch(STATE_URL, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error("http " + String(res.status)))))
        .then((json) => {
          store.data = json
          store.failures = 0
          if (store.offline) store.offline = false
          notify()
        })
        .catch(() => {
          store.failures += 1
          if (store.failures >= POLL_FAILURES_BEFORE_OFFLINE && !store.offline) {
            store.offline = true
            notify()
          }
        })
      fetch(MODE_URL, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json !== null && (json.mode === "auto" || json.mode === "manual") && json.mode !== store.mode) {
            store.mode = json.mode
            notify()
          }
        })
        .catch(() => { /* the chip keeps its last known mode */ })
    }

    /** Switch mode; the response is authoritative, so a refused write cannot desync the chip. */
    function writeMode(next) {
      return fetch(MODE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json !== null && (json.mode === "auto" || json.mode === "manual")) {
            store.mode = json.mode
            notify()
          }
        })
        .catch(() => { /* leave the displayed mode as it was */ })
    }

    function startPolling() {
      if (poller !== null) return
      pollOnce()
      poller = setInterval(pollOnce, POLL_MS)
    }

    // ── spec §4 toast copy ───────────────────────────────────────────────────────────────────────
    function toastText(triggeredBy, nextTier, prevTier) {
      if (Object.prototype.hasOwnProperty.call(TOAST_TEXT, triggeredBy)) return TOAST_TEXT[triggeredBy]
      if (triggeredBy === "laya") {
        const next = TIER_ORDER[nextTier]
        const prev = TIER_ORDER[prevTier]
        if (next === undefined || prev === undefined) return null
        if (next > prev) return "⤴ 升档 · 内容判断"
        if (next < prev) return "↩ 降回 · 新任务"
        return null
      }
      return null
    }

    function reasonText(triggeredBy) {
      return Object.prototype.hasOwnProperty.call(REASON_TEXT, triggeredBy)
        ? REASON_TEXT[triggeredBy]
        : String(triggeredBy === undefined || triggeredBy === null ? "" : triggeredBy)
    }

    function clockOf(ts) {
      if (typeof ts !== "number" || !isFinite(ts)) return "--:--"
      const d = new Date(ts * 1000)
      const hh = String(d.getHours()).padStart(2, "0")
      const mm = String(d.getMinutes()).padStart(2, "0")
      return hh + ":" + mm
    }

    function clip(text) {
      const s = typeof text === "string" ? text : ""
      return s.length > TASK_CHARS ? s.slice(0, TASK_CHARS) + "…" : s
    }

    /**
     * One popover row: time, tier dot, the task excerpt, and why it got that tier.
     *
     * Shared by the real history and the single preview row so the two read identically; the preview
     * row is marked with a dashed border and a trailing 预选 tag, and carries no regenerate marker
     * (nothing has run yet to retry).
     */
    function rowNode(row, key, preview) {
      return React.createElement("div", {
        key: key,
        className: "routerLayaRow" + (preview ? " routerLayaPreviewRow" : ""),
      },
        React.createElement("span", { className: "routerLayaTime" }, clockOf(row.ts)),
        React.createElement("span", {
          className: "routerLayaDot",
          style: { background: TIER_COLOR[row.tier] || OFFLINE_COLOR },
        }),
        React.createElement("span", { className: "routerLayaTask" }, clip(row.task)),
        React.createElement("span", { className: "routerLayaWhy" },
          reasonText(row.triggered_by)
            + (row.regenerate === true ? " ↻" : "")
            + (preview ? " · 预选" : "")),
      )
    }

    /** The composer draft, from the shell's `InputState` snapshot. */
    function selectDraft(snapshot) {
      return snapshot !== undefined && snapshot !== null && typeof snapshot.draft === "string"
        ? snapshot.draft
        : ""
    }

    /**
     * Stand-in for the shell's `useInput` when a build does not provide it: same call shape, no
     * subscription, so the preview simply never arms instead of the chip failing to render.
     */
    function NO_DRAFT() {
      return ""
    }

    // ── spec §3 geometry: sit beside the model selector, copying its own shape ───────────────────
    //
    // ADAPTED (1 of 2): the spec gives a literal `translateX(-8px)`. In this composer the chip's cell
    // renders BEFORE the model selector, so a negative offset moves it further away, not closer, and the
    // acceptance item it serves is "间距 8px" (spec §7.1). A fixed number cannot satisfy that because the
    // row's gap is not fixed, so the offset is measured: the chip is nudged by exactly
    // (current gap - 8px). The spec's intent -- an 8px gap -- is what is implemented.
    function measureGap(chipEl) {
      try {
        const effort = document.querySelector('[class*="triggerEffort"]')
        if (effort === null) return null
        const trigger = effort.closest("button") || effort.parentElement
        if (trigger === null) return null
        const chip = chipEl.getBoundingClientRect()
        const target = trigger.getBoundingClientRect()
        if (chip.width === 0 || target.width === 0) return null
        return { delta: target.left - chip.right - 8, trigger: trigger }
      } catch (error) {
        return null
      }
    }

    /** ADAPTED (2 of 2): "读它 computed style 复制" -- radius/height/font copied from the neighbour. */
    function copyNeighbourShape(trigger) {
      try {
        const cs = getComputedStyle(trigger)
        const shape = {}
        if (cs.borderRadius && cs.borderRadius !== "0px") shape.borderRadius = cs.borderRadius
        const h = parseFloat(cs.height)
        if (isFinite(h) && h >= 16 && h <= 40) shape.height = Math.round(h) + "px"
        const fs = parseFloat(cs.fontSize)
        if (isFinite(fs) && fs >= 10 && fs <= 18) shape.fontSize = Math.round(fs) + "px"
        return shape
      } catch (error) {
        return {}
      }
    }

    function useStore() {
      const tick = React.useState(0)
      React.useEffect(() => {
        startPolling()
        const fn = () => tick[1]((n) => n + 1)
        store.listeners.add(fn)
        return () => { store.listeners.delete(fn) }
      }, [])
      return store
    }

    function Chip(props) {
      const state = useStore()
      const chipRef = React.useState(null)
      const offset = React.useState(0)
      const shape = React.useState(null)
      const pop = React.useState(0)
      const toast = React.useState(null)
      const toastOut = React.useState(false)
      const popover = React.useState(false)
      const previous = React.useState(null)

      const sessionId = props === undefined || props === null ? undefined : props.sessionId
      const rows = rowsFor(sessionId)
      const latest = rows.length === 0 ? null : rows[rows.length - 1]
      const offline = state.offline
      const tier = latest !== null && typeof latest.tier === "string" ? latest.tier : null

      const manual = state.mode === "manual"

      // spec §4.3: first render is silent; only an adjacent-poll change on the same session animates.
      React.useEffect(() => {
        if (latest === null) return
        const prev = previous[0]
        previous[1]({ tier: latest.tier, triggeredBy: latest.triggered_by, sessionId: sessionId })
        if (prev === null) return
        if (prev.sessionId !== sessionId) return
        if (prev.tier === latest.tier) return
        pop[1]((n) => n + 1)
        const text = toastText(latest.triggered_by, latest.tier, prev.tier)
        if (text !== null) {
          toast[1](text)
          toastOut[1](false)
        }
      }, [latest === null ? null : latest.ts, sessionId])

      React.useEffect(() => {
        if (toast[0] === null) return undefined
        const hide = setTimeout(() => toastOut[1](true), TOAST_MS)
        const clear = setTimeout(() => { toast[1](null); toastOut[1](false) }, TOAST_MS + 320)
        return () => { clearTimeout(hide); clearTimeout(clear) }
      }, [toast[0]])

      // Geometry: measure once after layout settles, then keep the neighbour's shape.
      React.useEffect(() => {
        const node = chipRef[0]
        if (node === null) return undefined
        let raf = 0
        const apply = () => {
          const found = measureGap(node)
          if (found === null) return
          offset[1](found.delta)
          const copied = copyNeighbourShape(found.trigger)
          if (Object.keys(copied).length > 0) shape[1](copied)
        }
        raf = setTimeout(apply, 300)
        window.addEventListener("resize", apply)
        return () => { clearTimeout(raf); window.removeEventListener("resize", apply) }
      }, [props === undefined ? null : props.sessionId])

      // Hover timing per spec §5: 300ms to show, 150ms to hide.
      const hoverTimer = React.useState(null)
      const onEnter = () => {
        if (hoverTimer[0] !== null) clearTimeout(hoverTimer[0])
        hoverTimer[1](setTimeout(() => popover[1](true), HOVER_SHOW_MS))
      }
      const onLeave = () => {
        if (hoverTimer[0] !== null) clearTimeout(hoverTimer[0])
        hoverTimer[1](setTimeout(() => popover[1](false), HOVER_HIDE_MS))
      }
      React.useEffect(() => () => { if (hoverTimer[0] !== null) clearTimeout(hoverTimer[0]) }, [])

      // ── composer preview (2026-10-26) ────────────────────────────────────────────────────────
      //
      // The live draft comes from the shell's standard `useInput` slot prop. The hook identity is
      // fixed at mount on purpose: a build that does not provide it must degrade to "never preview"
      // (the shipped behaviour) without ever changing this render's hook order.
      //
      // Held in an OBJECT, not directly: `React.useState(fn)` treats a function as a lazy
      // initializer and would CALL it -- with no selector argument, and as a hook call in an
      // initializer. Storing the hook behind a field keeps it a plain value.
      const draftSource = React.useState({
        use: props !== undefined && props !== null && typeof props.useInput === "function"
          ? props.useInput
          : NO_DRAFT,
      })[0]
      const draft = draftSource.use(selectDraft)
      /** The preview verdict for one exact draft: { task, tier, triggered_by, ts }. */
      const preview = React.useState(null)
      const previewBusy = React.useState(false)
      // The three values below change inside async callbacks, never in render, so they live in
      // holders rather than state: a `React.useState` array is re-created by every render, which
      // would let a timer scheduled one render earlier read a stale "not in flight" flag and start a
      // second concurrent judgment.
      /** Immediately-visible in-flight guard (the state above only drives what is painted). */
      const inFlight = React.useState({ value: false })[0]
      /** Newest draft that arrived while a judgment was in flight; judged once it settles. */
      const wanted = React.useState({ value: null })[0]
      const settle = React.useState({ timer: null })[0]
      /** Mirrors the newest draft for the async response handler (no re-render, no stale closure). */
      const latestDraft = React.useState({ value: "" })[0]
      /**
       * Latched when the host says the judge service cannot preview (it is older than this plugin,
       * so a preview would land in the real history). Off for the rest of the page's life: the
       * alternative is asking again on every typing pause for an answer that will not come.
       */
      const previewOff = React.useState(false)

      const trimmed = typeof draft === "string" ? draft.trim() : ""
      latestDraft.value = trimmed

      // No preview in manual (nothing will be applied) or offline (nothing can judge).
      const previewKey = offline || manual || previewOff[0] ? "" : trimmed
      const previewArmed = previewKey.length >= PREVIEW_MIN_CHARS
      // Only a verdict for the draft still in the box is shown; a stale one would be a lie.
      const previewRow = preview[0] !== null && preview[0].task === previewKey ? preview[0] : null

      const firePreview = (text) => {
        if (inFlight.value) {
          // One judgment at a time. Queue only the newest draft -- a slow judge plus fast typing
          // must cost one inference per pause, not one per keystroke.
          wanted.value = text
          return
        }
        if (settle.timer !== null) { clearTimeout(settle.timer); settle.timer = null }
        inFlight.value = true
        previewBusy[1](true)
        fetch(PREVIEW_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionId === undefined ? null : sessionId, text: text }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((json) => {
            if (json === null) return
            if (json.unsupported === true) {
              previewOff[1](true)
              preview[1](null)
              return
            }
            if (typeof json.tier !== "string") return
            // A verdict for a draft that is no longer in the box is noise: drop it and let the
            // newer fire (or its queued follow-up) own the chip.
            if (latestDraft.value !== text) return
            preview[1]({
              // Shaped like a history row (`task`/`tier`/`triggered_by`/`ts`) so the popover can
              // render a preview with the same row component instead of a look-alike.
              task: text,
              tier: json.tier,
              triggered_by: typeof json.triggeredBy === "string" ? json.triggeredBy : "",
              ts: Date.now() / 1000,
            })
          })
          .catch(() => { /* the /state poll owns the offline flag; keep the last preview shown */ })
          .then(() => {
            inFlight.value = false
            previewBusy[1](false)
            const next = wanted.value
            wanted.value = null
            if (next === null || next === text) return
            if (next.length < PREVIEW_MIN_CHARS || next !== latestDraft.value) return
            // Settle first: never fire the next judgment immediately on top of the previous one.
            settle.timer = setTimeout(() => {
              settle.timer = null
              firePreview(next)
            }, PREVIEW_SETTLE_MS)
          })
      }

      /** One deferred /state read after a clear, so a just-sent turn shows up without waiting 3s. */
      const refresh = React.useState({ timer: null })[0]
      const refreshSoon = () => {
        if (refresh.timer !== null) return
        refresh.timer = setTimeout(() => { refresh.timer = null; pollOnce() }, PREVIEW_REFRESH_MS)
      }

      React.useEffect(() => {
        if (!previewArmed) {
          // Clearing the box (a send, an erase) clears the preview: from here the chip shows the
          // real judgment again, which for a fresh send is the tier that turn actually got.
          if (preview[0] !== null) {
            preview[1](null)
            // That judgement is now a real turn: its row is being committed right about now, so
            // look once instead of leaving "待判定" up for a full polling period.
            refreshSoon()
          }
          wanted.value = null
          return undefined
        }
        if (previewRow !== null) return undefined
        const timer = setTimeout(() => firePreview(previewKey), PREVIEW_DEBOUNCE_MS)
        return () => clearTimeout(timer)
      }, [previewKey, previewArmed, previewRow === null ? null : previewRow.task])

      React.useEffect(() => () => {
        if (settle.timer !== null) clearTimeout(settle.timer)
        if (refresh.timer !== null) clearTimeout(refresh.timer)
      }, [])

      // spec §3: manual shows 手动 with the pinned tier when one is known; colour returns to the default
      // foreground (no tier colour is painted in manual).
      const manualText = tier === null ? MANUAL_TEXT : MANUAL_TEXT + " · " + TIER_SHORT[tier]
      const nothingYet = !offline && tier === null
      // 预选中：有当前草稿的判定，或者正在判定（此时点脉冲为灰，文字是 预选 · …）。
      const previewBusyNow = !offline && !manual && previewArmed && previewRow === null && previewBusy[0]
      const previewPaint = previewRow !== null || previewBusyNow
      const color = offline || previewBusyNow
        ? OFFLINE_COLOR
        : (manual || (nothingYet && previewRow === null) ? null
          : (previewRow !== null ? TIER_COLOR[previewRow.tier] : TIER_COLOR[tier]))
      const text = offline
        ? OFFLINE_TEXT
        : (manual ? manualText
          : (previewRow !== null ? (PREVIEW_TEXT[previewRow.tier] || PENDING_TEXT)
            : (previewBusyNow ? PREVIEW_PENDING_TEXT
              : (nothingYet ? PENDING_TEXT : TIER_TEXT[tier]))))
      const title = offline
        ? OFFLINE_TIP
        : (previewPaint
          ? PREVIEW_TIP
          : (manual ? "手动 · 点击恢复 Auto" : (nothingYet ? PENDING_TIP : "自动 · 点击切到手动")))

      const style = {
        height: "22px",
        padding: "0 9px",
        borderRadius: "999px",
        fontSize: "11px",
        lineHeight: "1",
        // A preview must not look like a commitment: dashed edge until the text is actually sent.
        border: "1px " + (previewPaint ? "dashed" : "solid") + " var(--dsw-alias-border-l1)",
        color: manual
          ? "var(--dsw-alias-label-primary)"
          : (color === null ? OFFLINE_COLOR : color),
        fontWeight: manual ? 400 : 600,
        transform: "translateX(" + String(offset[0]) + "px)",
      }
      if (shape[0] !== null) {
        if (shape[0].height !== undefined) style.height = shape[0].height
        if (shape[0].borderRadius !== undefined) style.borderRadius = shape[0].borderRadius
        if (shape[0].fontSize !== undefined) style.fontSize = shape[0].fontSize
      }

      const dot = React.createElement("span", {
        className: "routerLayaDot",
        style: { background: color === null ? "var(--dsw-alias-label-dimmed)" : color },
      })

      const classes = ["routerLayaChip"]
      if (pop[0] !== 0) classes.push("routerLayaPop")
      if (!offline && !manual && tier === "max") classes.push("routerLayaMax")

      const chip = React.createElement("div", {
        ref: (node) => chipRef[1](node),
        className: classes.join(" "),
        style: style,
        title: title,
        onClick: () => { writeMode(manual ? "auto" : "manual") },
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
      }, dot, React.createElement("span", null, text))

      const toastNode = toast[0] === null
        ? null
        : React.createElement("div", {
            className: "routerLayaToast" + (toastOut[0] ? " routerLayaToastOut" : ""),
          }, toast[0])

      // While a preview is on screen the list is EXACTLY one row -- the preview itself. The 20-entry
      // history is a record of judged turns; mixing a draft's verdict into it would make one
      // conversation look like it had been routed a dozen times.
      const popoverNode = !popover[0]
        ? null
        : (previewRow !== null
          ? React.createElement("div", { className: "routerLayaPopover" }, rowNode(previewRow, "preview", true))
          : (rows.length > 0
            ? React.createElement("div", { className: "routerLayaPopover" },
                rows.slice(-POPOVER_LIMIT).reverse().map((row, index) => rowNode(
                  row, String(row.ts) + ":" + String(index), false)))
            : null))

      return React.createElement("div", {
        style: { position: "relative", display: "inline-flex", alignItems: "center" },
      }, chip, toastNode, popoverNode)
    }

    function apply(ctx) {
      if (styleEl === null) {
        styleEl = document.createElement("style")
        styleEl.setAttribute("data-router-laya", "tier-chip")
        styleEl.textContent = CSS
        document.head.appendChild(styleEl)
      }
      startPolling()
      ctx.effect(() => () => {
        if (poller !== null) { clearInterval(poller); poller = null }
        if (styleEl !== null && styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl)
        styleEl = null
      })
      ctx.slots.inject("conversation.input.right", () => ctx.slots.register(
        { name: "conversation.input.right", id: "router-laya-tier", order: 5 },
        (slotProps) => React.createElement(Chip, {
          sessionId: slotProps === undefined || slotProps === null ? undefined : slotProps.sessionId,
          // The standard props channel: `useInput` is how the chip sees the draft being typed.
          useInput: slotProps === undefined || slotProps === null ? undefined : slotProps.useInput,
        }),
      ))
    }

    exports.name = "router-laya-client"
    exports.inject = ["slots"]
    exports.apply = apply
    return module.exports
  },
})
