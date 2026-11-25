"""Checks the bridge's audio and reconnect logic without a robot. Run by display-bridge.test.ts: python audio_logic.py <bridge.py>."""
import base64
import importlib.util
import json
import os
import random
import struct
import sys
import tempfile
import threading
import time
import types

os.environ["HALA_SIM"] = "1"
os.environ["HALA_VIDEO_DIR"] = tempfile.mkdtemp(prefix="hala_video_")
spec = importlib.util.spec_from_file_location("bridge", sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def check(cond, msg):
    if not cond:
        print("FAIL:", msg)
        sys.exit(1)


# 1. the fast AVI writer produces exactly what the old per-pixel one did (checked on a row that needs padding too)
def old_write_avi_frames(frames_rgb, width, height):
    row = width * 3
    pad = (4 - row % 4) % 4
    chunks = []
    for rgb in frames_rgb:
        out = bytearray()
        for y in range(height - 1, -1, -1):
            line = rgb[y * row:(y + 1) * row]
            out += bytes(b for i in range(0, len(line), 3) for b in (line[i + 2], line[i + 1], line[i])) + b"\0" * pad
        chunks.append(bytes(out))
    return chunks


def avi_frames(path):
    raw = open(path, "rb").read()
    frames, pos = [], 0
    while True:
        pos = raw.find(b"00db", pos)
        if pos < 0:
            break
        size = struct.unpack("<I", raw[pos + 4:pos + 8])[0]
        frames.append(raw[pos + 8:pos + 8 + size])
        pos += 8 + size
        if len(frames) == 4:
            break
    return frames


random.seed(7)
for w, h in ((8, 6), (5, 4), (12, 3)):          # 5 wide: 15 bytes a row, so 1 byte of padding
    frame = bytes(random.randrange(256) for _ in range(w * h * 3))
    path = os.path.join(os.environ["HALA_VIDEO_DIR"], "c%d.avi" % w)
    t0 = time.time()
    m.write_avi(path, [frame] * 4, w, h)
    got = avi_frames(path)
    want = old_write_avi_frames([frame] * 4, w, h)
    check(got == want, "AVI frames equal the old writer's for %dx%d" % (w, h))
big = bytes(random.randrange(256) for _ in range(720 * 720 * 3))
t0 = time.time()
m.write_avi(os.path.join(os.environ["HALA_VIDEO_DIR"], "big.avi"), [big] * 4, 720, 720)
check(time.time() - t0 < 1.5, "a 720x720 AVI is written in under 1.5 s (took %.2f s)" % (time.time() - t0))

# 2. stale audio after an interruption is never played; event numbers restart with every conversation
b = m.Bridge()
b.io = m.SimIO(b)
chunk = base64.b64encode(bytes(3200)).decode()


def audio(eid):
    ev = {"type": "audio", "audio_event": {"audio_base_64": chunk}}
    if eid is not None:
        ev["audio_event"]["event_id"] = eid
    b.on_message(None, json.dumps(ev))


audio(1)
check(len(b.spk) == 3200, "audio before any interruption plays")
b.on_message(None, json.dumps({"type": "interruption", "interruption_event": {"event_id": 5}}))
check(len(b.spk) == 0, "interruption clears what was waiting")
audio(4)
audio("5")
check(len(b.spk) == 0, "audio numbered up to the interruption is dropped (int and string ids)")
audio(6)
check(len(b.spk) == 3200, "audio after the interruption plays")
audio(None)
check(len(b.spk) == 6400, "audio without a number plays")
b.on_message(None, json.dumps({"type": "conversation_initiation_metadata", "conversation_initiation_metadata_event": {
    "conversation_id": "c1", "agent_output_audio_format": "pcm_16000", "user_input_audio_format": "pcm_16000"}}))
audio(2)
check(len(b.spk) == 9600, "a new conversation starts counting again")
b.on_message(None, json.dumps({"type": "interruption"}))   # no event number at all: must not crash
check(len(b.spk) == 0, "an interruption without a number still clears the speaker")

# 3. a stalled network send must not be followed by a burst of fake silence
b = m.Bridge()
b.io = m.SimIO(b)
b.connected = True
sent = []
first = [True]


def slow_send(obj):
    if first[0]:
        first[0] = False
        time.sleep(1.2)                           # one slow send
    sent.append(time.monotonic())


b.ws_send = slow_send
threading.Thread(target=b.mic_loop, daemon=True).start()
time.sleep(3.0)
b.running = False
check(len(sent) <= 22, "after a 1.2 s stall the loop did not replay the missed ticks as silence (%d chunks in 3 s; 30 would be the real-time maximum)" % len(sent))
check(len(sent) >= 12, "the loop kept sending after the stall (%d chunks)" % len(sent))
bursts = sum(1 for i in range(1, len(sent)) if sent[i] - sent[i - 1] < 0.03)
check(bursts <= 1, "no burst of back-to-back chunks after the stall (%d)" % bursts)

# 4. a conversation that dies at once is retried with a growing delay, not every second
attempts = []


class FakeApp:
    def __init__(self, url, **k):
        attempts.append(time.monotonic())

    def run_forever(self, **k):
        return None                               # closed straight away, like a refused link


sys.modules["websocket"] = types.SimpleNamespace(WebSocketApp=FakeApp)
b = m.Bridge()
b.io = m.SimIO(b)
b.net = types.SimpleNamespace(request=lambda path, body=None, **k: {"signedUrl": "wss://x", "startProcedureIds": []})
b.desired = "running"
t = threading.Thread(target=b.run_session, daemon=True)
t.start()
time.sleep(6.5)
b.desired = "stopped"
t.join(2)
check(not t.is_alive(), "Stop on the website ends the retry loop within a second or two")
check(2 <= len(attempts) <= 4, "retries back off (1, 2, 4 s): %d attempts in 6.5 s, not 6 or 7" % len(attempts))

# 5. the speaker: plays at once by default; with HALA_PREBUFFER it waits for a little audio, but never longer than 0.6 s
def speaker_test(prebuffer, feed, wait):
    m.PREBUFFER = prebuffer
    s = m.Bridge()
    s.io = m.SimIO(s)
    threading.Thread(target=s.speaker_loop, daemon=True).start()
    with s.spk_lock:
        s.spk += bytes(feed)
    time.sleep(wait)
    played = s.io.played
    s.running = False
    return played


check(m.PREBUFFER == 0.0, "PREBUFFER is off by default")
check(speaker_test(0.0, 3200, 0.25) > 0, "default: the first 100 ms plays at once")
check(speaker_test(0.25, 3200, 0.3) == 0, "prebuffer 0.25: 100 ms of audio is held back")
check(speaker_test(0.25, 8000, 0.3) > 0, "prebuffer 0.25: 250 ms of audio plays")
check(speaker_test(0.25, 3200, 0.9) > 0, "prebuffer 0.25: a short sentence still plays after 0.6 s at most")
m.PREBUFFER = 0.0

print("OK")
