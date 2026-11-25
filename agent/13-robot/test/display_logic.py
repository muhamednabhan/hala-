"""Checks the bridge's face/LED/QR logic with a stub robot. Run by display-bridge.test.ts: python display_logic.py <bridge.py> <looks.json>."""
import importlib.util
import json
import os
import struct
import sys
import tempfile
import time

os.environ["HALA_SIM"] = "1"
os.environ["HALA_VIDEO_DIR"] = tempfile.mkdtemp(prefix="hala_video_")
os.environ["HALA_FFMPEG"] = "no-such-ffmpeg"   # exercise the pure-Python AVI path; the mp4 path is checked in the end-to-end run
spec = importlib.util.spec_from_file_location("bridge", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def check(cond, msg):
    if not cond:
        print("FAIL:", msg)
        sys.exit(1)


# 1. the Python looks equal the TypeScript ones (the website and the bridge must agree)
ts = json.load(open(sys.argv[2]))
check(set(ts) == set(m.LOOKS), "same look names: %s vs %s" % (sorted(ts), sorted(m.LOOKS)))
for name, look in ts.items():
    emoji, loop, led = m.LOOKS[name]
    want = (look["emoji"], look["loop"], (look["led"]["mode"], look["led"]["r"], look["led"]["g"], look["led"]["b"]))
    check((emoji, loop, tuple(led)) == want, "look %s: python %r vs ts %r" % (name, (emoji, loop, led), want))

# 2. the QR frame and the AVI writer
rows = ["1010101", "0101010", "1010101", "0101010", "1010101", "0101010", "1010101"]
f = m.qr_frame(rows, 720, 720)
check(len(f) == 720 * 720 * 3, "frame size %d" % len(f))
check(f[:3] == b"\xff\xff\xff", "corner is white (quiet zone)")
check(b"\x01\x15\x30" in f, "has dark modules")
check(m.qr_frame(rows, 800, 480)[:3] == b"\xff\xff\xff" and len(m.qr_frame(rows, 800, 480)) == 800 * 480 * 3, "non-square frame")
avi = os.path.join(os.environ["HALA_VIDEO_DIR"], "t.avi")
m.write_avi(avi, [f] * 4, 720, 720)
raw = open(avi, "rb").read()
check(raw[:4] == b"RIFF" and raw[8:12] == b"AVI ", "AVI header")
check(struct.unpack("<I", raw[4:8])[0] == len(raw) - 8, "RIFF size is exact")
check(raw.count(b"00db") >= 4, "four frames")


# 3. the look state machine with a stub robot
class IO:
    ros = False

    def __init__(self):
        self.calls = []

    def play_emoji(self, i, loop, pr):
        self.calls.append(("emoji", i, loop, pr)); return True, "ok"

    def play_video(self, path, loop, pr):
        self.calls.append(("video", os.path.exists(path), loop, pr)); return True, "ok"

    def set_led(self, mode, r, g, b, pr):
        self.calls.append(("led", mode, r, g, b, pr)); return True, "ok"


class Net:
    def request(self, path, body=None, **k):
        assert path == "/api/robot/qr"
        return {"rows": rows}


class B:
    running = True
    phase = "idle"
    speaking_until = 0.0
    tool_inflight = 0
    thinking_until = 0.0

    def __init__(self):
        self.io = IO()
        self.net = Net()
        self.logs = []

    def log(self, level, text):
        self.logs.append((level, text))


def settle():
    time.sleep(0.5)


b = B()
d = m.Display(b)
time.sleep(0.4)  # let the loop thread run a few ticks
check(b.io.calls == [], "never touches the face before a conversation: %r" % b.io.calls)

b.phase = "conversation"
d.tick(); settle()
check(("emoji", 10, True, 11) in b.io.calls, "listening: calm eyes looping at priority 11 -> %r" % b.io.calls)
check(("led", 1, 0, 194, 255, 10) in b.io.calls, "listening: cyan breathing")
check(all(c[3] == 11 for c in b.io.calls if c[0] == "emoji"), "face priority is above the system's 10")

b.io.calls.clear(); b.speaking_until = time.monotonic() + 5
d.tick(); settle()
check(("emoji", 11, True, 11) in b.io.calls and ("led", 3, 0, 194, 255, 10) in b.io.calls, "speaking: flowing cyan -> %r" % b.io.calls)

b.io.calls.clear(); b.speaking_until = 0; b.tool_inflight = 1
d.tick(); settle()
check(("emoji", 170, True, 11) in b.io.calls and ("led", 2, 47, 107, 246, 10) in b.io.calls, "thinking while a tool runs -> %r" % b.io.calls)

b.io.calls.clear(); d.tick(); settle()
check(b.io.calls == [], "no change, no calls (the robot is not spammed): %r" % b.io.calls)

b.io.calls.clear(); b.tool_inflight = 0
d.on_directive({"look": {"id": "e1", "name": "delighted"}, "qr": None})
d.tick(); settle()
check(("emoji", 100, False, 11) in b.io.calls and ("led", 3, 31, 178, 107, 10) in b.io.calls, "a booking is a delighted moment -> %r" % b.io.calls)
b.io.calls.clear()
d.on_directive({"look": {"id": "e1", "name": "delighted"}, "qr": None}); d.tick(); settle()
check(b.io.calls == [], "the same event is not played twice")
d.moment_until = 0  # the moment is over
d.tick(); settle()
check(("emoji", 10, True, 11) in b.io.calls, "the conversation look comes back after the moment")

# QR on the screen: the video plays, the face holds still, the lights keep following
b.io.calls.clear()
d.on_directive({"look": None, "qr": {"key": "pass:HALA-1001:1", "kind": "pass", "text": "https://x/pass/HALA-1001?k=a"}})
time.sleep(1.2)
check(("video", True, True, 11) in b.io.calls, "QR video exists on disk and plays on a loop -> %r" % b.io.calls)
check(any(f.endswith(".avi") for f in os.listdir(os.environ["HALA_VIDEO_DIR"])), "video was delivered to HALA_VIDEO_DIR")
b.io.calls.clear(); b.speaking_until = time.monotonic() + 5
d.tick(); settle()
check(not any(c[0] == "emoji" for c in b.io.calls), "no emoji over the QR: %r" % b.io.calls)
check(any(c[0] == "led" for c in b.io.calls), "the lights still follow the conversation")
b.io.calls.clear()
d.on_directive({"look": None, "qr": None}); settle()
check(any(c[0] == "emoji" for c in b.io.calls), "when the QR goes the face comes back")

# a dashboard test takes over for a while, and the conversation looks stay out of its way
b.io.calls.clear(); b.speaking_until = 0
done = []
d.run({"type": "emoji", "id": 120, "loop": False}, lambda ok, msg: done.append((ok, msg))); settle()
check(done and done[0][0] and ("emoji", 120, False, 11) in b.io.calls, "test emoji ran and reported: %r %r" % (done, b.io.calls))
b.io.calls.clear(); b.thinking_until = time.monotonic() + 5
d.tick(); settle()
check(b.io.calls == [], "the automatic look does not override a test: %r" % b.io.calls)
d.run({"type": "bogus"}, lambda ok, msg: done.append((ok, msg)))
check(done[-1][0] is False, "unknown test is reported as failed")

# the conversation ends: idle once, then the face is handed back
d.hold_until = 0; b.phase = "idle"; b.io.calls.clear()
d.tick(); settle()
check(("emoji", 10, False, 11) in b.io.calls, "idle plays once (not looping) -> %r" % b.io.calls)
b.io.calls.clear(); d.tick(); d.tick(); settle()
check(b.io.calls == [], "after idle the robot's own system has the face back: %r" % b.io.calls)

print("OK")
