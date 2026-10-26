"""Dependency-free HTTP guards and /state history rules for the judge service.

None of this can be exercised through `laya_router.py` itself: importing that module pulls torch in
for `laya`, so a check that imported it could not run in CI. They live here instead, stdlib-only, and
`http_guards.test.py` pins them without a checkpoint.

1. `ExclusiveHTTPServer` -- one listening socket per port, on every platform (issue #2).
2. `is_allowed_origin`   -- the tier chip's CORS allowlist (issue #3).
3. `records_judgment`    -- the /state history rule the composer preview depends on.
4. `judgment_row` / `append_judgment` -- the one row shape and bounded append every path shares.
"""
import os
import time
from collections import deque
from http.server import HTTPServer

# How many judgments one session keeps for the chip's popover.
HISTORY_LIMIT = 20

# Origins the tier chip may poll /state from: the web profile's page on loopback, and the DSH desktop
# shell, which loads the GUI from its own privileged scheme instead of an http port. A prefix
# allowlist rather than `*` on purpose -- /state echoes prompt text back.
ALLOWED_ORIGIN_PREFIXES = (
    "http://127.0.0.1:",
    "http://localhost:",
    "http://[::1]:",
    "dsh-app://",
)


def is_allowed_origin(origin):
    """Whether an `Origin` header value may read /state. A missing origin is refused, not defaulted."""
    return bool(origin) and origin.startswith(ALLOWED_ORIGIN_PREFIXES)


def records_judgment(judgment, preview):
    """Whether one /judge answer belongs in the per-session /state history.

    Two conditions, the second easy to forget:

    - no tier -> nothing to record (an error answer, or a base-protocol answer);
    - `preview` -> the composer's pre-send judging. It runs the SAME inference and returns the same
      shape, but it fires on every typing pause, so recording it would evict the 20 real turns the
      chip's popover exists to show -- and that history would become a list of drafts, most of which
      were never sent.
    """
    return bool(judgment.get("tier")) and not preview


def judgment_row(task, tier, triggered_by="", regenerate=False, ms=None, now=None):
    """One /state history row -- the single shape every writer produces.

    Shared by the two paths that add history: a `/judge` call that was actually served (the row is a
    side effect of the judgment) and a `/record` call that commits a verdict the client obtained
    earlier as a preview and the host then reused for the send (no second inference, but the turn
    *did* get that tier, so it belongs in the history exactly like any other).
    """
    return {
        "ts": time.time() if now is None else now,
        "tier": tier,
        "triggered_by": triggered_by or "",
        "regenerate": bool(regenerate),
        "ms": ms,
        "task": (task or "")[:60],
    }


def append_judgment(history, session_id, row):
    """Append one row to a session's bounded history, keeping the newest `HISTORY_LIMIT`.

    `history` is the service's `session_id -> deque` map. A deque (not a list) so the bound is the
    data structure's job, not a caller's `if len >` that one new writer can forget.
    """
    history.setdefault(session_id, deque(maxlen=HISTORY_LIMIT)).append(row)
    return len(history[session_id])


class ExclusiveHTTPServer(HTTPServer):
    """An HTTPServer that a second process cannot share the port with.

    `http.server.HTTPServer` sets `allow_reuse_address = 1` (SO_REUSEADDR). On POSIX that only buys a
    restart the right to rebind a TIME_WAIT port -- two *live* listeners still conflict -- but on
    Windows SO_REUSEADDR is what allows a second socket to bind an address another process is
    already listening on, so the duplicate-start guard the plugin documents in index.js did not
    exist there: every extra `--http` spawn stayed alive and loaded its own copy of the checkpoint
    (issue #2: 11 listeners, ~2.9 GB each).

    Measured on Windows 11 (26300), Python 3.13, loopback: with the owner holding SO_REUSEADDR a
    second SO_REUSEADDR bind succeeds; without it the second bind is refused (WinError 10048, or
    10013 when the second binder sets SO_REUSEADDR itself). Rebinding after the previous owner has
    closed -- the port still in TIME_WAIT -- succeeded in all three combinations, so dropping the
    flag on Windows costs no restart behaviour. POSIX keeps it, where it is still needed for exactly
    that restart.
    """

    allow_reuse_address = os.name != "nt"
