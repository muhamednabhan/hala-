#!/usr/bin/env python3
"""
HALA robot bridge: the HALA website  <->  ElevenLabs agent  <->  AgiBot X2 microphone and speaker.

Based on the Voice of the Oasis starter bridge (ElevenLabs Robot Bridge.py). What is new: it does not need an
agent id or an API key on the robot. It pairs with the HALA website using a token, takes its settings from the
website, opens the conversation only when you press Start there, and reports what it is doing so you can see it.

  robot microphone  /agent/process_audio_output   (16 kHz, 16-bit, mono)
        -> ElevenLabs agent (signed link from the website)
        -> robot speaker  /aima/hal/audio/playback

Run it on the robot's development computer (PC2), inside the container MangoBot set up. Never on PC1.
The Robot page on the website shows the exact commands for your robot. In short:

  pip3 install websocket-client numpy
  source /opt/ros/humble/setup.bash
  source <path to aimdk>/install/setup.bash
  curl -fsSL https://YOUR-SITE/hala_robot_bridge.py -o hala_robot_bridge.py
  HALA_URL=https://YOUR-SITE HALA_ROBOT_TOKEN=hbr_... python3 hala_robot_bridge.py

Environment variables
  HALA_URL            the website address (required)
  HALA_ROBOT_TOKEN    the pairing token from the Robot page (required)
  HALA_MIC=raw        (default) raw microphone /aima/hal/audio/capture: no wake word needed, but no echo
                      cancellation, so the bridge mutes the mic while the robot speaks (half duplex).
                      HALA_MIC=processed uses /agent/process_audio_output, which stays silent until the wake word.
  HALA_SIM=1          simulation: no ROS, no robot. Pairs, syncs and talks to the agent, discards the audio.
                      Use it on a laptop to check everything except the robot's own audio.
  HALA_ECHO_TAIL=0.3  seconds the microphone stays closed after the robot stops speaking (half duplex). Raise it
                      if the robot hears the end of its own sentence.
  VERBOSE=1           print every event from ElevenLabs

Movement stays with MangoBot: this program never publishes to a motion topic. It starts ONE ROS node.
"""

import array
import base64
import json
import math
import os
import queue
import signal
import struct
import sys
import threading
import time
import urllib.error
import urllib.request

BRIDGE_VERSION = "1.0.0"

HALA_URL = os.environ.get("HALA_URL", "").strip().rstrip("/")
TOKEN = os.environ.get("HALA_ROBOT_TOKEN", "").strip()
SIM = os.environ.get("HALA_SIM", "0") == "1"
MIC_MODE = "processed" if os.environ.get("HALA_MIC", "raw") == "processed" else "raw"
VERBOSE = os.environ.get("VERBOSE", "0") == "1"

RATE = 16000                 # Hz: what the robot gives and takes
BYTES_PER_SEC = RATE * 2     # 16-bit mono
CHUNK = BYTES_PER_SEC // 10  # 100 ms
SILENCE = bytes(CHUNK)
FOCUS_PRIORITY = 8           # same value as AgiBot's stream example
SYNC_SECS = 2.0
# Half duplex keeps the microphone closed for this long after the last audio the robot sent to its speaker.
# Shorter = the caller can answer sooner; too short and the robot may hear the end of its own sentence.
ECHO_TAIL = float(os.environ.get("HALA_ECHO_TAIL", "0.3"))


def now():
    return time.strftime("%H:%M:%S")


# --------------------------------------------------------------------------- ROS (optional)
HAVE_ROS = False
ROS_ERROR = ""
if not SIM:
    try:
        import rclpy
        from rclpy.executors import MultiThreadedExecutor
        from rclpy.node import Node
        from rclpy.qos import QoSHistoryPolicy, QoSProfile, QoSReliabilityPolicy
        from aimdk_msgs.msg import (AudioData, AudioInfo, AudioPlayback, AudioVadStateType, CommonState,
                                    FocusRequester, FocusResponse, ProcessedAudioOutput)
        from aimdk_msgs.srv import AbandonAudioFocus, RequestAudioFocus, StopAudioPlay
        try:
            from aimdk_msgs.msg import AudioCapture  # raw multi-channel microphone
        except Exception:
            AudioCapture = None
        HAVE_ROS = True
    except Exception as e:  # ImportError, or a ROS environment that is not sourced
        ROS_ERROR = str(e)


class Net:
    """Talks to the HALA website. Plain urllib so there is nothing extra to install."""

    def request(self, path, body=None, raw=False, timeout=12):
        data = json.dumps(body if body is not None else {}).encode()
        req = urllib.request.Request(
            HALA_URL + path, data=data, method="POST",
            headers={"content-type": "application/json", "authorization": "Bearer " + TOKEN})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
        return payload if raw else json.loads(payload)


def resample(pcm, src_rate):
    """Agent audio in another PCM rate -> 16 kHz. Better: the robot agent is set to PCM 16000, so this is a no-op."""
    if src_rate == RATE or not pcm:
        return pcm
    import numpy as np
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    n = int(len(x) * RATE / src_rate)
    y = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return y.astype(np.int16).tobytes()


def tone(freq=660.0, secs=0.5, amp=0.25):
    """A soft beep as 16 kHz mono S16LE, with short fades so it does not click."""
    n = int(RATE * secs)
    fade = int(RATE * 0.03)
    out = bytearray()
    for i in range(n):
        g = min(1.0, i / fade, (n - i) / fade)
        out += struct.pack("<h", int(32767 * amp * g * math.sin(2 * math.pi * freq * i / RATE)))
    return bytes(out)


# --------------------------------------------------------------------------- audio back ends
class SimIO:
    """No robot: the speaker discards audio (and counts it), focus always succeeds."""
    ros = False

    def __init__(self, bridge):
        self.b = bridge
        self.played = 0

    def take_focus(self):
        return True

    def drop_focus(self):
        pass

    def play(self, pcm):
        self.played += len(pcm)

    def stop(self):
        pass

    def set_volume(self, v):
        return "simulation: volume %d ignored" % v

    def shutdown(self):
        pass


if HAVE_ROS:
    class RosIO(Node):
        """The real thing: AimDK microphone topic in, audio playback topic out, with audio focus."""
        ros = True

        def __init__(self, bridge):
            super().__init__("hala_robot_bridge")
            self.b = bridge
            self.pkg = "hala_bridge%d" % os.getpid()
            self.token = 0
            mic_qos = QoSProfile(history=QoSHistoryPolicy.KEEP_LAST, depth=500, reliability=QoSReliabilityPolicy.BEST_EFFORT)
            if MIC_MODE == "raw" and AudioCapture is not None:
                # 6 interleaved channels, S16LE, 16 kHz: 4 microphones + 2 speaker reference. Needs no wake word.
                self.create_subscription(AudioCapture, "/aima/hal/audio/capture", self.on_raw_mic, mic_qos)
            else:
                self.create_subscription(ProcessedAudioOutput, "/agent/process_audio_output", self.on_mic, mic_qos)
            self.create_subscription(FocusResponse, "/aima/hal/audio/focus_response", self.on_focus, 10)
            self.player = self.create_publisher(AudioPlayback, "/aima/hal/audio/playback", 10)
            self.focus_cli = self.create_client(RequestAudioFocus, "/aimdk_5Fmsgs/srv/RequestAudioFocus")
            self.abandon_cli = self.create_client(AbandonAudioFocus, "/aimdk_5Fmsgs/srv/AbandonAudioFocus")
            self.stop_cli = self.create_client(StopAudioPlay, "/aimdk_5Fmsgs/srv/StopAudioPlay")
            self.volume_cli = None
            self.holding = False
            ex = MultiThreadedExecutor()
            ex.add_node(self)
            self.ex = ex
            threading.Thread(target=ex.spin, daemon=True).start()

        def call(self, client, req, tries=8, timeout=0.25):
            """AgiBot's advice: cross-host ROS services need retries."""
            for _ in range(tries):
                if not client.wait_for_service(timeout_sec=timeout):
                    continue
                fut = client.call_async(req)
                done = threading.Event()
                fut.add_done_callback(lambda f: done.set())
                if done.wait(timeout * 4) and fut.result() is not None:
                    return fut.result()
            return None

        def requester(self):
            return FocusRequester(pkg_name=self.pkg, priority=FOCUS_PRIORITY)

        def take_focus(self):
            req = RequestAudioFocus.Request()
            req.focus_requester = self.requester()
            res = self.call(self.focus_cli, req)
            ok = (res is not None and res.reponse.status.value == CommonState.SUCCESS and res.focus_response.focus_gain)
            self.holding = bool(ok)
            return bool(ok)

        def drop_focus(self):
            if not self.holding:
                return
            req = AbandonAudioFocus.Request()
            req.focus_requester = self.requester()  # must match the request exactly
            self.call(self.abandon_cli, req, tries=3)
            self.holding = False

        def on_focus(self, msg):
            if msg.pkg_name == self.pkg and not msg.focus_gain and self.holding:
                self.b.log("warn", "speaker focus lost, asking again")
                threading.Thread(target=self.take_focus, daemon=True).start()

        def on_raw_mic(self, msg):
            import numpy as np
            try:
                a = np.frombuffer(bytes(msg.data.data), dtype="<i2").reshape(-1, msg.info.channels)[:, :msg.mic_channels]
                pcm = np.clip(a.astype(np.int32).mean(axis=1), -32768, 32767).astype("<i2").tobytes()
            except Exception as e:
                self.b.log("warn", "raw microphone frame ignored: %s" % e)
                return
            self.b.accept(pcm)

        def on_mic(self, msg):
            self.b.on_mic(msg.stream_id, bytes(msg.audio_data), msg.audio_vad_state.value == AudioVadStateType.AUDIO_VAD_STATE_BEGIN)

        def play(self, pcm):
            msg = AudioPlayback()
            msg.pkg_name = self.pkg
            msg.token_id = "%s-%d" % (self.pkg, self.token)
            msg.info = AudioInfo(channels=1, sample_rate=RATE)
            msg.data = AudioData(data=array.array("B", pcm))
            self.player.publish(msg)

        def stop(self):
            self.token += 1  # a new token_id clears the robot's playback buffer
            self.call(self.stop_cli, StopAudioPlay.Request(), tries=2)

        def set_volume(self, v):
            from aimdk_msgs.srv import SetVolume  # imported on demand: only the volume command needs it
            if self.volume_cli is None:
                self.volume_cli = self.create_client(SetVolume, "/aimdk_5Fmsgs/srv/SetVolume")
            req = SetVolume.Request()
            req.audio_volume = int(v)
            res = self.call(self.volume_cli, req)
            return "volume set" if res is not None else "the volume service did not answer"

        def shutdown(self):
            try:
                self.ex.shutdown()
                self.destroy_node()
                rclpy.shutdown()
            except Exception:
                pass


# --------------------------------------------------------------------------- the bridge
class Bridge:
    def __init__(self):
        self.net = Net()
        self.running = True
        self.desired = "stopped"
        self.config = {"micStream": 0, "halfDuplex": False, "volume": None}
        self.applied_volume = None
        self.io = None
        self.phase = "starting"
        self.last_error = ""
        self.logq = []
        self.log_lock = threading.Lock()
        self.results = []
        # conversation
        self.ws = None
        self.connected = False
        self.session_thread = None
        self.conversation_id = ""
        self.out_rate = RATE
        self.in_format = ""
        self.out_format = ""
        self.focus = False
        # audio
        self.mic_q = queue.Queue()
        self.spk = bytearray()
        self.spk_lock = threading.Lock()
        self.speaking_until = 0.0
        self.mic_stream = 0
        self.mic_messages = 0
        self.last_mic = 0.0

    # ------------------------------------------------------------------ logging
    def log(self, level, text):
        print(now(), level.upper(), text, flush=True)
        with self.log_lock:
            self.logq.append({"level": level, "message": str(text)[:480]})
            if len(self.logq) > 300:
                del self.logq[:100]

    # ------------------------------------------------------------------ microphone
    def on_mic(self, stream_id, pcm, speech_start):
        """Processed microphone (wake-word gated): pick one stream, then hand over to accept()."""
        want = self.config.get("micStream", 0)
        if want:
            if stream_id != want:
                return
        elif self.mic_stream == 0:
            self.mic_stream = stream_id
            self.log("info", "listening on microphone stream %d" % stream_id)
        elif stream_id != self.mic_stream:
            return
        if VERBOSE and speech_start:
            self.log("info", "speech start")
        self.accept(pcm)

    def accept(self, pcm):
        """One chunk of 16 kHz mono S16LE microphone audio, from either microphone source."""
        self.mic_messages += 1
        self.last_mic = time.monotonic()
        # The raw microphone has no echo cancellation: without half duplex the robot hears and answers itself.
        if (self.config.get("halfDuplex") or MIC_MODE == "raw") and time.monotonic() < self.speaking_until:
            return
        self.mic_q.put(pcm)

    def mic_loop(self):
        """Every 100 ms send whatever the microphone gave us, however little. Send silence ONLY when nothing arrived at all.
        (Waiting for a full 100 ms and sending silence otherwise chopped speech into pieces with gaps, which the speech
        recogniser heard as noise.) Silence keeps the stream alive so ElevenLabs can tell when the person stopped talking."""
        nxt = time.monotonic()
        while self.running:
            buf = bytearray()
            try:
                while True:
                    buf += self.mic_q.get_nowait()
            except queue.Empty:
                pass
            n = len(buf) - len(buf) % 2
            out = bytes(buf[:n]) if n else SILENCE
            if self.connected:
                self.ws_send({"user_audio_chunk": base64.b64encode(out).decode()})
            nxt += 0.1
            time.sleep(max(0.0, nxt - time.monotonic()))

    # ------------------------------------------------------------------ speaker
    def speaker_loop(self):
        """Paced at real time with a small lead, as in the starter bridge."""
        lead = 0.3
        clock = None
        sent = 0
        while self.running:
            with self.spk_lock:
                have = len(self.spk)
            if not have:
                clock, sent = None, 0
                time.sleep(0.02)
                continue
            if clock is None:
                clock = time.monotonic()
            allowed = int((time.monotonic() - clock + lead) * BYTES_PER_SEC) - sent
            if allowed >= CHUNK or (allowed > 0 and have < CHUNK):
                n = min(have, max(CHUNK, allowed - allowed % 2))
                with self.spk_lock:
                    pcm = bytes(self.spk[:n])
                    del self.spk[:n]
                self.io.play(pcm)
                sent += len(pcm)
                self.speaking_until = time.monotonic() + lead + ECHO_TAIL
            time.sleep(0.05)

    def stop_speaking(self):
        with self.spk_lock:
            self.spk.clear()
        self.io.stop()
        self.speaking_until = 0.0

    def play_blocking(self, pcm):
        """Play a clip through the same path the agent uses. Takes the speaker if the conversation is not using it."""
        own = not self.focus
        if own and not self.io.take_focus():
            raise RuntimeError("could not get the speaker (audio focus refused)")
        try:
            with self.spk_lock:
                self.spk += pcm
            deadline = time.monotonic() + len(pcm) / BYTES_PER_SEC + 8
            while time.monotonic() < deadline:
                with self.spk_lock:
                    if not self.spk:
                        break
                time.sleep(0.05)
            time.sleep(0.6)
        finally:
            if own:
                self.io.drop_focus()

    # ------------------------------------------------------------------ conversation
    def ws_send(self, obj):
        ws = self.ws
        if ws is None:
            return
        try:
            ws.send(json.dumps(obj))
        except Exception as e:
            self.log("warn", "send failed: %s" % e)

    def on_message(self, ws, raw):
        try:
            ev = json.loads(raw)
        except ValueError:
            return
        t = ev.get("type")
        if VERBOSE and t != "audio":
            self.log("info", "event: " + raw[:300])
        if t == "ping":
            self.ws_send({"type": "pong", "event_id": ev["ping_event"]["event_id"]})
        elif t == "conversation_initiation_metadata":
            m = ev["conversation_initiation_metadata_event"]
            self.conversation_id = m.get("conversation_id", "")
            self.out_format = m.get("agent_output_audio_format", "")
            self.in_format = m.get("user_input_audio_format", "")
            self.log("info", "connected. agent speaks %s and listens to %s" % (self.out_format, self.in_format))
            if self.in_format != "pcm_16000":
                self.log("warn", "the agent's input audio should be PCM 16000 Hz (run agent:sync for the robot agent)")
            if self.out_format.startswith("pcm_"):
                self.out_rate = int(self.out_format.split("_")[1])
            else:
                self.log("error", "the agent's output audio must be PCM 16000 Hz, it is %s" % (self.out_format or "unknown"))
            self.phase = "conversation"
        elif t == "audio":
            pcm = resample(base64.b64decode(ev["audio_event"]["audio_base_64"]), self.out_rate)
            with self.spk_lock:
                self.spk += pcm
        elif t == "interruption":
            self.stop_speaking()
        elif t == "user_transcript":
            self.log("user", ev["user_transcription_event"]["user_transcript"])
        elif t == "agent_response":
            self.log("agent", ev["agent_response_event"]["agent_response"])
        elif t in ("agent_tool_request", "agent_tool_response"):
            try:
                body = ev.get(t) or {}
                self.log("info", "tool %s: %s" % ("call" if t.endswith("request") else "result", body.get("tool_name", "?")))
            except Exception:
                pass
        elif t == "client_tool_call":
            # Our tools are server-side webhooks, so a client tool call is unexpected. Answer so the agent does not hang.
            call = ev.get("client_tool_call", {})
            self.log("warn", "unexpected client tool call: %s" % call.get("tool_name"))
            self.ws_send({"type": "client_tool_result", "tool_call_id": call.get("tool_call_id"), "result": "not available on the robot", "is_error": True})

    def run_session(self):
        """One conversation, with reconnects, for as long as the website says running."""
        import websocket  # pip3 install websocket-client
        backoff = 1
        while self.running and self.desired == "running":
            try:
                self.phase = "connecting"
                if not self.focus:
                    self.focus = self.io.take_focus()
                    self.log("info" if self.focus else "warn", "speaker focus: " + ("yes" if self.focus else "NO (ask MangoBot to check the agent module)"))
                s = self.net.request("/api/robot/session", {})
                url = s["signedUrl"]
                self.ws = websocket.WebSocketApp(
                    url,
                    on_open=lambda ws: self.on_open(ws),
                    on_message=self.on_message,
                    on_error=lambda ws, e: self.log("warn", "websocket error: %s" % e),
                    on_close=lambda ws, c, m: self.on_close(c, m))
                self.ws.run_forever(ping_interval=20, ping_timeout=10)
                backoff = 1
            except Exception as e:
                self.last_error = "cannot start the conversation: %s" % e
                self.log("error", self.last_error + " (does PC2 have internet?)")
            self.ws = None
            self.connected = False
            if self.running and self.desired == "running":
                self.phase = "connecting"
                time.sleep(backoff)
                backoff = min(backoff * 2, 15)
        self.finish_session()

    def on_open(self, ws):
        self.connected = True
        self.last_error = ""
        self.ws_send({"type": "conversation_initiation_client_data"})

    def on_close(self, code, msg):
        self.connected = False
        self.log("info", "conversation closed %s %s" % (code or "", msg or ""))

    def finish_session(self):
        self.stop_speaking()
        if self.focus:
            self.io.drop_focus()
            self.focus = False
        self.conversation_id = ""
        self.phase = "idle"

    def ensure_session(self):
        alive = self.session_thread is not None and self.session_thread.is_alive()
        if self.desired == "running" and not alive:
            self.session_thread = threading.Thread(target=self.run_session, daemon=True)
            self.session_thread.start()
        elif self.desired == "stopped" and alive:
            self.phase = "stopping"
            ws = self.ws
            if ws is not None:
                try:
                    ws.close()
                except Exception:
                    pass

    # ------------------------------------------------------------------ commands from the website
    def run_command(self, cmd):
        t, p = cmd["type"], cmd.get("payload") or {}
        try:
            if t == "speaker_test":
                self.play_blocking(tone(660, 0.45) + bytes(3200) + tone(880, 0.45))
                return True, "played two beeps"
            if t == "say":
                pcm = self.net.request("/api/robot/tts", {"text": p.get("text", "")}, raw=True, timeout=30)
                if not pcm:
                    return False, "no audio came back"
                self.play_blocking(pcm)
                return True, "spoken (%.1fs)" % (len(pcm) / BYTES_PER_SEC)
            if t == "set_volume":
                return True, self.io.set_volume(int(p.get("volume", 50)))
            if t == "reconnect":
                ws = self.ws
                if ws is not None:
                    ws.close()
                return True, "reconnecting"
            return False, "unknown command " + str(t)
        except Exception as e:
            return False, str(e)[:250]

    # ------------------------------------------------------------------ sync with the website
    def state(self):
        age = None if not self.last_mic else round(time.monotonic() - self.last_mic, 1)
        st = {
            "phase": self.phase, "ros": bool(self.io and self.io.ros), "simulation": SIM, "speakerFocus": self.focus,
            "micStream": self.config.get("micStream") or self.mic_stream, "micMode": MIC_MODE, "micMessages": self.mic_messages, "micAgeSecs": age,
            "agentOutputFormat": self.out_format, "agentInputFormat": self.in_format,
        }
        if self.conversation_id:
            st["conversationId"] = self.conversation_id
        if self.last_error:
            st["lastError"] = self.last_error
        return st

    def sync_once(self):
        with self.log_lock:
            logs, self.logq = self.logq[:40], self.logq[40:]
        results, self.results = self.results, []
        try:
            res = self.net.request("/api/robot/sync", {"version": BRIDGE_VERSION, "state": self.state(), "logs": logs, "results": results})
        except urllib.error.HTTPError as e:
            with self.log_lock:
                self.logq = logs + self.logq
            self.results = results + self.results
            if e.code == 401:
                self.log("error", "the website rejected the token. Make a new one on the Robot page.")
            else:
                self.log("warn", "website answered %d" % e.code)
            return
        except Exception as e:
            with self.log_lock:
                self.logq = logs + self.logq
            self.results = results + self.results
            print(now(), "cannot reach the website:", e, flush=True)
            return
        self.config = res.get("config", self.config)
        self.desired = res.get("desired", self.desired)
        vol = self.config.get("volume")
        if vol is not None and vol != self.applied_volume:
            self.applied_volume = vol
            try:
                self.log("info", "volume: " + self.io.set_volume(int(vol)))
            except Exception as e:
                self.log("warn", "could not set the volume: %s" % e)
        for cmd in res.get("commands", []):
            ok, text = self.run_command(cmd)
            self.log("info" if ok else "warn", "command %s: %s" % (cmd["type"], text))
            self.results.append({"id": cmd["id"], "ok": ok, "result": text})
        self.ensure_session()

    def keep_warm(self):
        """While a conversation runs, touch the tools endpoint every 25 s. It answers 401 (no secret) but that is enough to keep
        the serverless function warm, so the agent's first tool call does not wait for a cold start."""
        def ping():
            try:
                req = urllib.request.Request(HALA_URL + "/api/tools/find_service", data=b"{}", method="POST", headers={"content-type": "application/json"})
                urllib.request.urlopen(req, timeout=10).read()
            except Exception:
                pass
        threading.Thread(target=ping, daemon=True).start()

    def control_loop(self):
        last_warm = 0.0
        while self.running:
            self.sync_once()
            if self.desired == "running" and time.monotonic() - last_warm > 25:
                last_warm = time.monotonic()
                self.keep_warm()
            time.sleep(SYNC_SECS)

    # ------------------------------------------------------------------ lifecycle
    def start(self):
        if SIM:
            self.io = SimIO(self)
            self.log("info", "SIMULATION: no robot audio. Everything else is real.")
        else:
            if not HAVE_ROS:
                sys.exit("ROS 2 / aimdk_msgs not found (%s).\nSource /opt/ros/humble/setup.bash and the AimDK workspace first, "
                         "or set HALA_SIM=1 to test without a robot." % ROS_ERROR)
            try:
                from rclpy.signals import SignalHandlerOptions
                rclpy.init(signal_handler_options=SignalHandlerOptions.NO)
            except (ImportError, TypeError):
                rclpy.init()
            self.io = RosIO(self)
            self.log("info", "ROS 2 ready (one node: hala_robot_bridge)")
        self.phase = "idle"
        threading.Thread(target=self.mic_loop, daemon=True).start()
        threading.Thread(target=self.speaker_loop, daemon=True).start()
        self.log("info", "bridge %s started (microphone: %s). Waiting for Start on the website." % (BRIDGE_VERSION, MIC_MODE))
        self.control_loop()

    def stop(self, *_):
        self.running = False
        self.desired = "stopped"
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass


def main():
    if not HALA_URL or not TOKEN:
        sys.exit("Set HALA_URL (the website address) and HALA_ROBOT_TOKEN (from the Robot page) first.")
    if not HALA_URL.startswith("https://") and not HALA_URL.startswith("http://localhost"):
        sys.exit("HALA_URL must be https://...")
    bridge = Bridge()
    signal.signal(signal.SIGINT, bridge.stop)
    signal.signal(signal.SIGTERM, bridge.stop)
    try:
        bridge.start()
    finally:
        bridge.running = False
        if bridge.io:
            try:
                bridge.finish_session()
                bridge.io.shutdown()
            except Exception:
                pass
        print(now(), "bye", flush=True)


if __name__ == "__main__":
    main()
