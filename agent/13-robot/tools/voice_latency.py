#!/usr/bin/env python3
"""
Voice round trip of the REAL robot path, without a robot.

It makes a throw-away robot on the website, runs hala_robot_bridge.py in simulation mode (HALA_SIM=1: real pairing, real
signed link, real ElevenLabs robot agent, real tools through the tunnel; only the robot's own speaker and microphone are
replaced), speaks a few test questions into the bridge's microphone input as synthetic speech, and times how long the first
audio of the answer takes to come back. Then it deletes its robot.

  HALA_URL=http://localhost:3005 HALA_ADMIN_KEY=... ELEVENLABS_API_KEY=... python3 voice_latency.py [bridge.py]

  HALA_URL         where the website runs (the laptop). Default http://localhost:3005
  HALA_ADMIN_KEY   the admin key from .env.hala (to create and delete the test robot)
  ELEVENLABS_API_KEY  only used to turn the test questions into speech (a few hundred characters)
  QUESTIONS        optional: ';'-separated list replacing the defaults

What it measures, per question (seconds):
  asr     end of the question -> the transcript of it arrives
  reply   end of the question -> the FIRST sample of the answer reaches the bridge   <- the number that matters
  The numbers include turn detection, the language model, the tools, speech synthesis and the network to this computer.
  They leave out the robot's own audio path (a few tens of milliseconds) and the time it takes the robot's speaker to play.

It talks to the REAL robot agent, so it makes one short test conversation there (and, if a question books something, a real
demo booking). The default questions only ask for information. Do not run it while the robot is in use: the laptop screen
follows whichever robot has a live conversation.
"""
import importlib.util
import json
import os
import sys
import threading
import time
import urllib.request

try:
    sys.stdout.reconfigure(encoding="utf-8")   # a Windows console is not UTF-8: Arabic questions would crash the printing
except Exception:
    pass
HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "..", "bridge", "hala_robot_bridge.py")
URL = os.environ.get("HALA_URL", "http://localhost:3005").rstrip("/")
ADMIN = os.environ.get("HALA_ADMIN_KEY", "")
XI = os.environ.get("ELEVENLABS_API_KEY", "")
if not ADMIN or not XI:
    sys.exit("Set HALA_ADMIN_KEY and ELEVENLABS_API_KEY (read them from .env.hala / .env.local; they are never printed).")
DEFAULT_QUESTIONS = [
    "How much does a no objection certificate cost?",
    "What documents do I need to renew an employee visa?",
    "ما هي المستندات المطلوبة لبطاقة الدخول؟",
]
QUESTIONS = [q.strip() for q in os.environ.get("QUESTIONS", "").split(";") if q.strip()] or DEFAULT_QUESTIONS


def http(method, path, body=None, headers=None, raw=False, base=None):
    req = urllib.request.Request((base or URL) + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"content-type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    return data if raw else json.loads(data or b"{}")


def speech(text):
    """The question as 16 kHz mono PCM (what the robot's microphone delivers)."""
    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=pcm_16000", method="POST",
        data=json.dumps({"text": text, "model_id": "eleven_flash_v2_5"}).encode(),
        headers={"content-type": "application/json", "xi-api-key": XI})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


admin = {"x-hala-admin-key": ADMIN}
print("making the test robot ...")
made = http("POST", "/api/robots", {"name": "ZZ voice latency test (deleted afterwards)"}, admin)
robot_id, token = made["robot"]["id"], made["token"]
os.environ.update(HALA_SIM="1", HALA_URL=URL, HALA_ROBOT_TOKEN=token, HALA_FACE="0", VERBOSE="0")
results = []
try:
    questions = [(q, speech(q)) for q in QUESTIONS]
    spec = importlib.util.spec_from_file_location("bridge", BRIDGE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    b = m.Bridge()
    log = []          # (monotonic time, type, detail)
    orig = b.on_message

    def spy(ws, raw):
        t = time.monotonic()
        try:
            ev = json.loads(raw)
        except ValueError:
            ev = {}
        typ = ev.get("type")
        if typ == "audio":
            log.append((t, "audio", 0))
        elif typ == "user_transcript":
            log.append((t, "transcript", ev["user_transcription_event"]["user_transcript"]))
        elif typ == "agent_response":
            log.append((t, "response", ev["agent_response_event"]["agent_response"]))
        elif typ == "conversation_initiation_metadata":
            log.append((t, "connected", 0))
        orig(ws, raw)

    b.on_message = spy
    http("PATCH", "/api/robots/" + robot_id, {"desired": "running"}, admin)
    t0 = time.monotonic()
    threading.Thread(target=b.start, daemon=True).start()

    def last(kind):
        return max((e[0] for e in log if e[1] == kind), default=None)

    def quiet(secs):
        """No agent audio for `secs`, nothing left to play, and the speaker tail is over."""
        la = last("audio")
        return la is not None and time.monotonic() - la > secs and not b.spk and time.monotonic() > b.speaking_until

    deadline = time.monotonic() + 60
    while not any(e[1] == "audio" for e in log):
        if time.monotonic() > deadline:
            raise SystemExit("the agent never spoke: is the server up, and is the robot agent set up?")
        time.sleep(0.05)
    first_audio = next(e[0] for e in log if e[1] == "audio")
    print("session start: robot told to run -> first audio of the greeting %.1f s (includes the bridge's 2 s check-in)" % (first_audio - t0))
    while not quiet(2.0):
        time.sleep(0.1)
    print("greeting finished after %.1f s of audio\n" % (last("audio") - first_audio))

    for text, pcm in questions:
        mark = len(log)
        step = m.CHUNK
        pad = pcm + bytes(m.BYTES_PER_SEC // 2)
        nxt = time.monotonic()
        for i in range(0, len(pcm), step):
            b.accept(pcm[i:i + step])
            nxt += 0.1
            time.sleep(max(0.0, nxt - time.monotonic()))
        t_end = time.monotonic()
        t_reply = t_asr = None
        stop = time.monotonic() + 30
        while time.monotonic() < stop and t_reply is None:
            for e in log[mark:]:
                if e[0] >= t_end - 0.05:
                    if e[1] == "transcript" and t_asr is None:
                        t_asr = e[0]
                    if e[1] == "audio" and t_reply is None:
                        t_reply = e[0]
            time.sleep(0.02)
        time.sleep(2.5)                           # the written answer arrives a little after its first audio
        heard = next((e[2] for e in log[mark:] if e[1] == "transcript"), "?")
        said = next((e[2] for e in log[mark:] if e[1] == "response"), "")
        row = {"q": text, "asr": None if t_asr is None else t_asr - t_end, "reply": None if t_reply is None else t_reply - t_end}
        results.append(row)
        print("Q: %s\n   heard: %s\n   asr %s   reply %s   answer: %s\n" % (
            text, heard[:70], "-" if row["asr"] is None else "%.2f s" % row["asr"], "NONE in 30 s" if row["reply"] is None else "%.2f s" % row["reply"],
            m.re.sub(r"\s*\[[^\]]{1,30}\]\s*", " ", said)[:80]))
        wait = time.monotonic() + 45
        while not quiet(2.0) and time.monotonic() < wait:
            time.sleep(0.1)
    b.desired = "stopped"
    b.stop()
    ok = [r["reply"] for r in results if r["reply"] is not None]
    if ok:
        ok.sort()
        print("first reply audio: median %.2f s, best %.2f s, worst %.2f s (%d questions)" % (ok[len(ok) // 2], ok[0], ok[-1], len(ok)))
finally:
    try:
        http("DELETE", "/api/robots/" + robot_id, None, admin, raw=True)
        print("test robot deleted")
    except Exception as e:
        print("COULD NOT DELETE the test robot %s: %s (delete it on the Robot page)" % (robot_id, e))
