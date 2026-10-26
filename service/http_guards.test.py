"""Plain-script check for the guards in http_guards.py (repo convention: no framework).

    python service/http_guards.test.py

The first two guards are the defects reported in issues #2 and #3, and all of them are stdlib-only,
so this runs without torch or a checkpoint: a second binder must be refused the port, the desktop
shell origin must be allowed to read /state, and a preview must stay out of the history.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http.server import BaseHTTPRequestHandler  # noqa: E402

from http_guards import (ExclusiveHTTPServer, append_judgment, is_allowed_origin,  # noqa: E402
                         judgment_row, records_judgment)

passed = 0
failed = []


def check(name, got, want=True):
    global passed
    if got == want:
        passed += 1
    else:
        failed.append("%s -> got %r, want %r" % (name, got, want))


class Quiet(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass


# --- the CORS allowlist (issue #3: the desktop origin was missing, chip read "AUTO · 离线") ---
check("web profile origin allowed", is_allowed_origin("http://127.0.0.1:3080"))
check("desktop shell origin allowed", is_allowed_origin("dsh-app://app"))
check("ipv6 loopback allowed", is_allowed_origin("http://[::1]:3080"))
check("external origin refused", is_allowed_origin("https://example.com"), False)
check("lookalike scheme refused", is_allowed_origin("dsh-appx://app"), False)
check("missing origin refused", is_allowed_origin(None), False)

# --- the /state history rule (composer preview: judged while typing, never recorded) ---
tiered = {"tier": "high", "triggered_by": "laya"}
check("a real judgement is recorded", records_judgment(tiered, False))
check("a preview is NOT recorded", records_judgment(tiered, True), False)
check("an answer with no tier is not recorded", records_judgment({"error": "boom"}, False), False)
check("a preview error is not recorded", records_judgment({"error": "boom"}, True), False)

# --- one row shape, one bounded append (both the judged and the recorded path go through it) ---
row = judgment_row("帮我设计一个限流器" * 10, "high", triggered_by="laya", regenerate=True, ms=1234,
                   now=1700000000.0)
check("row keeps the fields the chip renders",
      [row["ts"], row["tier"], row["triggered_by"], row["regenerate"], row["ms"]],
      [1700000000.0, "high", "laya", True, 1234])
check("row trims the task excerpt to 60 chars", len(row["task"]), 60)
defaults = judgment_row("t", "low")
check("row defaults",
      [defaults["triggered_by"], defaults["regenerate"], defaults["ms"], defaults["task"]],
      ["", False, None, "t"])

history = {}
check("first append creates the session history", append_judgment(history, "s1", row), 1)
append_judgment(history, "s1", judgment_row("second", "max"))
check("second append is the newest", history["s1"][-1]["task"], "second")
# 20 条上限是 deque 的职责：不是每次写都记得 `if len > 20`（历史被挤爆过一次，就是因为漏了一次）。
for index in range(30):
    append_judgment(history, "s1", judgment_row("t%d" % index, "low"))
check("the history stays bounded at 20", len(history["s1"]), 20)
check("and the newest survives", history["s1"][-1]["task"], "t29")

# --- one owner per port (issue #2: SO_REUSEADDR let 11 Windows judges bind :8765 at once) ---
first = ExclusiveHTTPServer(("127.0.0.1", 0), Quiet)
port = first.server_address[1]
check("first binder owns a port", port > 0)
try:
    second = ExclusiveHTTPServer(("127.0.0.1", port), Quiet)
except OSError:
    check("second binder is refused the same port", True)
else:
    second.server_close()
    check("second binder is refused the same port", False)
finally:
    first.server_close()

print("%d passed, %d failed" % (passed, len(failed)))
for line in failed:
    print("  FAIL " + line)
sys.exit(1 if failed else 0)
