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
  HALA_PREBUFFER=0    seconds of speech to collect before a sentence starts playing (0 = at once). If the beginning of
                      sentences sounds choppy, try 0.25. It adds at most that much delay.
  VERBOSE=1           print every event from ElevenLabs

Face, lights and screen (new in 1.1.0; AgiBot 5.2.2, 6.1.26, 6.1.33)
  The robot's emoji face and LED strip follow the conversation (listening, speaking, thinking) and react to what HALA does
  (a booking is a happy face with green lights, a hand-over a sympathetic one with amber ...). A QR code (the phone link, the
  Smart Pass) is played on the robot's screen as a looping video. The Robot page has a test card for all of it.
  HALA_FACE=0           turn all of this off (voice only)
  HALA_FACE_PRIORITY=11 emoji/video priority. System modules use up to 10 for faults, so 11 wins over them.
  HALA_LED_PRIORITY=10  LED priority. Run `aima em stop-app task_manager` on PC1 first, or it fights for the strip.
  HALA_PC3_SSH=user@10.0.1.42  videos must be on the interaction computer (PC3): copy them there with scp (key login)
  HALA_VIDEO_DIR=/var/tmp/hala  folder for the videos, on PC3 (or on this computer if it IS PC3 / the folder is shared)
  HALA_VIDEO_SIZE=720x720       size of the QR video
  HALA_FFMPEG=ffmpeg            used to make an MP4; without it a plain AVI is written

Movement stays with MangoBot: this program never publishes to a motion topic. It starts ONE ROS node.
"""

import array
import base64
import re
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

BRIDGE_VERSION = "1.1.1"

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
# Seconds of agent speech to collect before the first sample of a sentence plays. 0 = play at once (default, lowest latency).
# If the start of sentences sounds choppy, try HALA_PREBUFFER=0.25.
try:
    PREBUFFER = max(0.0, min(0.6, float(os.environ.get("HALA_PREBUFFER", "0"))))
except ValueError:
    PREBUFFER = 0.0


def now():
    return time.strftime("%H:%M:%S")


def as_int(v):
    """ElevenLabs event numbers: an int, or a string of digits. None when it is neither."""
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


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
    PlayEmoji = PlayVideo = SetPmuLed = None
    if HAVE_ROS:
        try:
            from aimdk_msgs.srv import PlayEmoji, PlayVideo, SetPmuLed
        except Exception as e:  # an older AimDK: no screen or LED services
            ROS_ERROR_DISPLAY = str(e)


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

    def play_emoji(self, emoji_id, loop, priority):
        self.b.log("info", "[simulation] emoji %d %s (priority %d)" % (emoji_id, "loop" if loop else "once", priority))
        return True, "simulation: emoji %d" % emoji_id

    def play_video(self, path, loop, priority):
        ok = os.path.exists(path)
        self.b.log("info" if ok else "warn", "[simulation] video %s %s (priority %d)%s" % (path, "loop" if loop else "once", priority, "" if ok else " NOT FOUND"))
        return ok, ("simulation: video %s" % path) if ok else "simulation: no such file on this computer: %s" % path

    def set_led(self, mode, r, g, b, priority):
        self.b.log("info", "[simulation] LED mode %d rgb(%d,%d,%d) (priority %d)" % (mode, r, g, b, priority))
        return True, "simulation: LED"

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
            self.token += 1  # a new token_id clears the robot's playback buffer: that happens right here, at once
            # The StopAudioPlay call can take seconds when the robot's audio node is slow, and stop() runs on the websocket
            # thread at every interruption: waiting for it froze every incoming message. It is only belt and braces, so
            # it goes on its own thread.
            def call_stop():
                try:
                    self.call(self.stop_cli, StopAudioPlay.Request(), tries=2)
                except Exception:
                    pass
            threading.Thread(target=call_stop, daemon=True).start()

        def set_volume(self, v):
            from aimdk_msgs.srv import SetVolume  # imported on demand: only the volume command needs it
            if self.volume_cli is None:
                self.volume_cli = self.create_client(SetVolume, "/aimdk_5Fmsgs/srv/SetVolume")
            req = SetVolume.Request()
            req.audio_volume = int(v)
            res = self.call(self.volume_cli, req)
            return "volume set" if res is not None else "the volume service did not answer"

        # ---- face, screen, lights (AgiBot: PlayEmoji, PlayVideo, SetPmuLed)
        def stamp(self, req, kind):
            """The samples stamp a different header field per service."""
            now_msg = self.get_clock().now().to_msg()
            try:
                if kind == "led":
                    req.request.header.stamp = now_msg
                else:
                    req.header.header.stamp = now_msg
            except AttributeError:
                pass

        def play_emoji(self, emoji_id, loop, priority):
            if PlayEmoji is None:
                return False, "this AimDK has no PlayEmoji service"
            if getattr(self, "emoji_cli", None) is None:
                self.emoji_cli = self.create_client(PlayEmoji, "/aimdk_5Fmsgs/srv/PlayEmoji")
            req = PlayEmoji.Request()
            req.emotion_id = int(emoji_id)
            req.mode = 2 if loop else 1
            req.priority = int(priority)
            self.stamp(req, "emoji")
            res = self.call(self.emoji_cli, req, tries=8, timeout=0.25)
            if res is None:
                return False, "the emoji service did not answer (is the interaction computer up?)"
            return bool(res.success), (res.message or ("played" if res.success else "refused"))

        def play_video(self, path, loop, priority):
            if PlayVideo is None:
                return False, "this AimDK has no PlayVideo service"
            if getattr(self, "video_cli", None) is None:
                self.video_cli = self.create_client(PlayVideo, "/aimdk_5Fmsgs/srv/PlayVideo")
            req = PlayVideo.Request()
            req.video_path = str(path)
            req.mode = 2 if loop else 1
            req.priority = int(priority)
            self.stamp(req, "video")
            res = self.call(self.video_cli, req, tries=8, timeout=0.5)
            if res is None:
                return False, "the video service did not answer"
            return bool(res.success), (res.message or ("playing" if res.success else "refused (is the file on PC3 and readable by all?)"))

        def set_led(self, mode, r, g, b, priority):
            if SetPmuLed is None:
                return False, "this AimDK has no SetPmuLed service"
            if getattr(self, "led_cli", None) is None:
                self.led_cli = self.create_client(SetPmuLed, "/aimdk_5Fmsgs/srv/SetPmuLed")
            for reset in (False, True):
                req = SetPmuLed.Request()
                req.led_strip_mode = int(mode)
                req.r, req.g, req.b = int(r), int(g), int(b)
                req.priority = int(priority)
                req.reset_priority = reset
                req.trace_id = "hala_led"
                self.stamp(req, "led")
                res = self.call(self.led_cli, req, tries=4, timeout=1.25)   # the strip answers slowly: up to ~5 s
                if res is None:
                    return False, "the LED service did not answer"
                if res.status_code == 0:
                    return True, "ok"
                if res.status_code != 0x1024 or reset:
                    return False, "LED refused: status 0x%X" % res.status_code
                # 0x1024: priority too low. Ask again resetting the threshold (stop task_manager on PC1 to avoid this).
            return False, "LED refused"

        def shutdown(self):
            try:
                self.ex.shutdown()
                self.destroy_node()
                rclpy.shutdown()
            except Exception:
                pass


# --------------------------------------------------------------------------- face, screen and lights
# AgiBot 5.2.2 Screen Control (PlayEmoji, PlayVideo), 6.1.26 Emoji Control, 6.1.33 LED Strip Control (SetPmuLed).
#
# The robot's screen can play emoji and VIDEO only, so a QR code is built as a short video here and played on a loop.
# Video files must live on the interaction computer (PC3), readable by everybody. If this program runs on PC2, set
# HALA_PC3_SSH=user@10.0.1.42 (key-based ssh) so the file is copied there; otherwise it is written to HALA_VIDEO_DIR on
# the computer the bridge runs on (right when that is PC3, or when the folder is shared).
FACE_ENABLED = os.environ.get("HALA_FACE", "1") != "0"
FACE_PRIORITY = int(os.environ.get("HALA_FACE_PRIORITY", "11"))   # above the 10 that system modules use for faults
LED_PRIORITY = int(os.environ.get("HALA_LED_PRIORITY", "10"))
VIDEO_DIR = os.environ.get("HALA_VIDEO_DIR", "/var/tmp/hala").rstrip("/") or "/var/tmp/hala"
PC3_SSH = os.environ.get("HALA_PC3_SSH", "").strip()
FFMPEG = os.environ.get("HALA_FFMPEG", "ffmpeg")
try:
    VIDEO_W, VIDEO_H = [int(x) for x in os.environ.get("HALA_VIDEO_SIZE", "720x720").lower().split("x")]
    VIDEO_W -= VIDEO_W % 4
    VIDEO_H -= VIDEO_H % 4
except ValueError:
    VIDEO_W = VIDEO_H = 720
FACE_HOLD_SECS = 4.5      # a moment (happy ...) lasts this long, then the conversation state comes back
TEST_HOLD_SECS = 12.0     # after a test from the dashboard the automatic faces stay out of the way this long

# name: (emoji id, loop, (led mode, r, g, b)). Mirrors LOOKS in agent/13-robot/src/display.ts (a test keeps them equal).
#   led mode: 0 steady, 1 breathing, 2 blinking, 3 flowing
LOOKS = {
    "idle":      (10,  False, (1, 47, 107, 246)),
    "listening": (10,  True,  (1, 0, 194, 255)),
    "speaking":  (11,  True,  (3, 0, 194, 255)),
    "thinking":  (170, True,  (2, 47, 107, 246)),
    "happy":     (90,  False, (0, 31, 178, 107)),
    "delighted": (100, False, (3, 31, 178, 107)),
    "sympathy":  (120, False, (1, 255, 170, 0)),
    "confused":  (130, False, (2, 255, 170, 0)),
    "cute":      (150, False, (0, 0, 194, 255)),
    "serious":   (160, False, (2, 255, 59, 48)),
    "error":     (70,  False, (2, 255, 59, 48)),
}


def qr_frame(rows, width, height):
    """One RGB24 frame (top-down): the QR, dark blue on white, centred with its 4-module quiet zone. Pure Python: no image library."""
    n = len(rows)
    quiet = 4
    scale = max(1, (min(width, height) * 9 // 10) // (n + 2 * quiet))
    side = (n + 2 * quiet) * scale
    left = (width - side) // 2
    top = (height - side) // 2
    white = bytes([255, 255, 255])
    dark = bytes([1, 21, 48])          # DSO Midnight
    blank = white * width
    band = blank * (quiet * scale)    # the white quiet zone above and below
    frame = bytearray(blank * top)
    frame += band
    for row in rows:
        line = bytearray(white * (left + quiet * scale))
        for ch in row:
            line += (dark if ch == "1" else white) * scale
        line += white * (width - left - quiet * scale - n * scale)
        frame += bytes(line) * scale
    frame += band
    frame += blank * (height - top - side)
    return bytes(frame)


def write_avi(path, frames_rgb, width, height, fps=2):
    """Uncompressed (BI_RGB) AVI, no tools needed. Used only when ffmpeg is not installed; an MP4 is preferred."""
    row = width * 3
    pad = (4 - row % 4) % 4
    chunks = []
    done = {}                                           # the QR video repeats ONE frame: convert it once, not four times
    for rgb in frames_rgb:
        if id(rgb) not in done:
            # RGB -> BGR with two slice assignments (C speed). The old per-pixel generator held the Python interpreter for
            # seconds on the robot's PC2, exactly when the QR appears and the agent is talking: audio could stutter.
            bgr = bytearray(rgb)
            bgr[0::3] = rgb[2::3]
            bgr[2::3] = rgb[0::3]
            out = bytearray()
            padding = b"\0" * pad
            for y in range(height - 1, -1, -1):        # bottom-up
                out += bgr[y * row:(y + 1) * row]
                out += padding
            done[id(rgb)] = bytes(out)
        chunks.append(done[id(rgb)])
    size = len(chunks[0])
    n = len(chunks)

    def chunk(tag, data):
        return tag + struct.pack("<I", len(data)) + data + (b"\0" if len(data) % 2 else b"")

    def lst(kind, data):
        return b"LIST" + struct.pack("<I", len(data) + 4) + kind + data

    avih = struct.pack("<IIIIIIIIIIIIII", 1000000 // fps, size * fps, 0, 0x10, n, 0, 1, size, width, height, 0, 0, 0, 0)
    strh = b"vids" + b"DIB " + struct.pack("<IHHIIIIIIIIhhhh", 0, 0, 0, 0, 1, fps, 0, n, size, 0xFFFFFFFF, 0, 0, 0, width, height)
    strf = struct.pack("<IiiHHIIiiII", 40, width, height, 1, 24, 0, size, 0, 0, 0, 0)
    hdrl = lst(b"hdrl", chunk(b"avih", avih) + lst(b"strl", chunk(b"strh", strh) + chunk(b"strf", strf)))
    movi_body = b"".join(chunk(b"00db", c) for c in chunks)
    idx = b""
    offset = 4
    for c in chunks:
        idx += b"00db" + struct.pack("<III", 0x10, offset, len(c))
        offset += 8 + len(c) + (len(c) % 2)
    body = b"AVI " + hdrl + lst(b"movi", movi_body) + chunk(b"idx1", idx)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", len(body)) + body)


def build_qr_video(rows, key):
    """A 2-second looping-friendly video of the QR. Returns (local path, how). MP4 through ffmpeg when it is installed."""
    import hashlib
    import shutil
    import subprocess
    import tempfile
    tag = hashlib.sha1((key + "".join(rows)).encode()).hexdigest()[:10]
    folder = os.path.join(tempfile.gettempdir(), "hala_qr")
    os.makedirs(folder, exist_ok=True)
    frame = qr_frame(rows, VIDEO_W, VIDEO_H)
    ffmpeg = shutil.which(FFMPEG)
    if ffmpeg:
        out = os.path.join(folder, "qr_%s.mp4" % tag)
        if not os.path.exists(out):
            cmd = [ffmpeg, "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (VIDEO_W, VIDEO_H), "-framerate", "2",
                   "-i", "-", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
            r = subprocess.run(cmd, input=frame * 4, capture_output=True, timeout=60)
            if r.returncode != 0:
                raise RuntimeError("ffmpeg failed: %s" % r.stderr.decode(errors="replace")[:200])
        return out, "mp4 via ffmpeg"
    out = os.path.join(folder, "qr_%s.avi" % tag)
    if not os.path.exists(out):
        write_avi(out, [frame] * 4, VIDEO_W, VIDEO_H)
    return out, "avi without ffmpeg (install ffmpeg on this computer for an mp4)"


def deliver_video(local):
    """Put the file where the robot's screen can read it. Returns the absolute path on PC3."""
    import shutil
    import subprocess
    name = os.path.basename(local)
    remote = "%s/%s" % (VIDEO_DIR, name)
    if PC3_SSH:
        opts = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6"]
        for cmd in (["ssh"] + opts + [PC3_SSH, "mkdir -p '%s' && chmod 755 '%s'" % (VIDEO_DIR, VIDEO_DIR)],
                    ["scp"] + opts + [local, "%s:%s" % (PC3_SSH, remote)],
                    ["ssh"] + opts + [PC3_SSH, "chmod 644 '%s'" % remote]):
            r = subprocess.run(cmd, capture_output=True, timeout=40)
            if r.returncode != 0:
                raise RuntimeError("%s failed: %s" % (cmd[0], r.stderr.decode(errors="replace").strip()[:200] or "exit %d" % r.returncode))
        return remote
    os.makedirs(VIDEO_DIR, exist_ok=True)
    os.chmod(VIDEO_DIR, 0o755)
    shutil.copyfile(local, remote)
    os.chmod(remote, 0o644)
    return remote


class Lane:
    """One thread and one queue. The LED strip answers in up to 5 s, so it must never hold up the face (or the conversation)."""

    def __init__(self, name):
        self.q = queue.Queue()
        threading.Thread(target=self.run, name=name, daemon=True).start()

    def put(self, fn, done=None, replace=False):
        if replace:                      # a newer look makes an older, still waiting one pointless
            keep = []
            try:
                while True:
                    item = self.q.get_nowait()
                    if not item[2]:
                        keep.append(item)
            except queue.Empty:
                pass
            for item in keep:
                self.q.put(item)
        self.q.put((fn, done, replace))

    def run(self):
        while True:
            fn, done, _ = self.q.get()
            try:
                ok, msg = fn()
            except Exception as e:
                ok, msg = False, str(e)[:250]
            if done:
                try:
                    done(ok, msg)
                except Exception:
                    pass


class Display:
    """The robot's face, lights and screen, following the conversation. Every call is best effort: a failing face must never
    stop the conversation, so errors are logged (once per kind) and the voice carries on."""

    def __init__(self, bridge):
        self.b = bridge
        self.io = bridge.io
        self.face = Lane("face")
        self.led = Lane("led")
        self.screen = Lane("screen")
        self.cur = None            # the look last applied
        self.active = False        # was a conversation running at the last tick
        self.last_look_id = None
        self.moment = None
        self.moment_until = 0.0
        self.qr_key = None
        self.qr_until = 0.0
        self.hold_until = 0.0
        self.warned = set()
        threading.Thread(target=self.loop, name="look", daemon=True).start()

    # ---- low level (each returns (ok, message))
    def _warn(self, what, msg):
        if what not in self.warned:
            self.warned.add(what)
            self.b.log("warn", "%s: %s" % (what, msg))

    def do_emoji(self, emoji_id, loop):
        ok, msg = self.io.play_emoji(emoji_id, loop, FACE_PRIORITY)
        if not ok:
            self._warn("face", msg)
        return ok, ("emoji %d %s" % (emoji_id, "looping" if loop else "once")) if ok else msg

    def do_led(self, mode, r, g, b):
        ok, msg = self.io.set_led(mode, r, g, b, LED_PRIORITY)
        if not ok:
            self._warn("led", msg)
        return ok, ("LED mode %d rgb(%d,%d,%d)" % (mode, r, g, b)) if ok else msg

    # ---- looks
    def apply_look(self, name, force=False):
        emoji, loop, led = LOOKS[name]
        if self.qr_key and not force:
            pass                               # the QR owns the screen; the lights still follow
        else:
            self.face.put(lambda: self.do_emoji(emoji, loop), replace=True)
        self.led.put(lambda: self.do_led(*led), replace=True)
        self.cur = name

    def state_look(self):
        b = self.b
        if b.phase != "conversation":
            return "idle"
        t = time.monotonic()
        if t < b.speaking_until:
            return "speaking"
        if b.tool_inflight > 0 or t < b.thinking_until:
            return "thinking"
        return "listening"

    def loop(self):
        while self.b.running:
            try:
                self.tick()
            except Exception as e:
                self._warn("look loop", str(e)[:200])
            time.sleep(0.25)

    def tick(self):
        t = time.monotonic()
        conv = self.b.phase == "conversation"
        # the QR is over (its time ran out, or the conversation ended)
        if self.qr_key and ((self.qr_until and t > self.qr_until) or (not conv and not self.qr_until)):
            self.stop_qr()
        if t < self.hold_until:
            return                              # a test from the dashboard is on show
        if not conv and not self.active:
            return                              # never touch the face before the first conversation or after we handed it back
        self.active = conv
        want = self.moment if (self.moment and t < self.moment_until) else self.state_look()
        if want != self.cur:
            self.apply_look(want)
        if not conv and self.cur == "idle":
            self.active = False                 # idle was shown once: hand the face back to the robot's own system

    # ---- from the website
    def on_directive(self, d):
        if not d or not FACE_ENABLED:
            return
        look = d.get("look")
        if look and look.get("id") != self.last_look_id:
            self.last_look_id = look.get("id")
            if look.get("name") in LOOKS and time.monotonic() >= self.hold_until:
                self.moment = look["name"]
                self.moment_until = time.monotonic() + FACE_HOLD_SECS
        qr = d.get("qr")
        if qr and qr.get("key") != self.qr_key and time.monotonic() >= self.hold_until:
            self.start_qr(qr["key"], qr["text"], 0)
        elif not qr and self.qr_key and not self.qr_until:
            self.stop_qr()

    # ---- QR on the screen, as a looping video
    def start_qr(self, key, text, seconds, done=None):
        self.qr_key = key
        self.qr_until = time.monotonic() + seconds if seconds else 0.0

        def job():
            rows = self.b.net.request("/api/robot/qr", {"text": text})["rows"]
            local, how = build_qr_video(rows, key)
            path = deliver_video(local)
            ok, msg = self.io.play_video(path, True, FACE_PRIORITY)
            if not ok:
                self.qr_key = None
                self._warn("screen", msg)
                return False, "could not play the QR video (%s): %s" % (how, msg)
            return True, "QR playing on a loop (%s, %dx%d) from %s%s" % (how, VIDEO_W, VIDEO_H, path, (" for %ds" % seconds) if seconds else "")

        def fail(ok, msg):
            if not ok:
                self.qr_key = None
            if done:
                done(ok, msg)
        self.screen.put(job, fail)

    def stop_qr(self):
        self.qr_key = None
        self.qr_until = 0.0
        name = self.cur if self.cur in LOOKS else "idle"
        emoji, _, _ = LOOKS[name]
        # an emoji at the same priority replaces the looping video
        self.face.put(lambda: self.do_emoji(emoji, LOOKS[name][1]), replace=True)

    # ---- test commands from the dashboard
    def run(self, p, done):
        """Run one dashboard test. `done(ok, message)` is called when the robot has answered (the LED strip can take ~5 s)."""
        kind = p.get("type")
        self.hold_until = time.monotonic() + TEST_HOLD_SECS
        if not FACE_ENABLED:
            return done(False, "face control is switched off (HALA_FACE=0)")
        if kind == "emoji":
            self.face.put(lambda: self.do_emoji(int(p["id"]), bool(p.get("loop"))), done)
        elif kind == "led":
            self.led.put(lambda: self.do_led(int(p["mode"]), int(p["r"]), int(p["g"]), int(p["b"])), done)
        elif kind == "look":
            name = p.get("name")
            if name not in LOOKS:
                return done(False, "unknown look %r" % name)
            emoji, loop, led = LOOKS[name]
            results = []

            def part(label):
                def cb(ok, msg):
                    results.append((label, ok, msg))
                    if len(results) == 2:
                        bad = [m for _, ok2, m in results if not ok2]
                        done(not bad, ("look %s: face and lights set" % name) if not bad else "; ".join(bad))
                return cb
            self.face.put(lambda: self.do_emoji(emoji, loop), part("face"))
            self.led.put(lambda: self.do_led(*led), part("led"))
            self.cur = name
        elif kind == "qr":
            self.start_qr("test:%d" % int(time.time()), str(p.get("text", "")), int(p.get("seconds", 20)), done)
        elif kind == "video":
            path = str(p.get("path", ""))
            self.screen.put(lambda: self.io.play_video(path, bool(p.get("loop")), FACE_PRIORITY), done)
        elif kind == "clear":
            self.stop_qr()
            self.cur = None
            self.face.put(lambda: self.do_emoji(LOOKS["idle"][0], False), done)
        else:
            done(False, "unknown display command %r" % kind)


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
        self.interrupt_id = 0
        # audio
        self.mic_q = queue.Queue()
        self.spk = bytearray()
        self.spk_lock = threading.Lock()
        self.speaking_until = 0.0
        self.mic_stream = 0
        self.mic_messages = 0
        self.last_mic = 0.0
        # face and lights
        self.display = None
        self.tool_inflight = 0
        self.thinking_until = 0.0

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
            late = time.monotonic() - nxt > 0.05
            out = bytes(buf[:n]) if n else SILENCE
            # When this loop has fallen behind (a slow send), the missed ticks must not be replayed as a burst of fake
            # silence: that stretches the stream and the recogniser hears a long pause that never happened.
            if self.connected and (n or not late):
                self.ws_send({"user_audio_chunk": base64.b64encode(out).decode()})
            nxt += 0.1
            t = time.monotonic()
            if nxt < t - 0.3:                           # stalled for good: start a fresh schedule
                nxt = t
            time.sleep(max(0.0, nxt - t))

    # ------------------------------------------------------------------ speaker
    def speaker_loop(self):
        """Paced at real time with a small lead, as in the starter bridge."""
        lead = 0.3
        clock = None
        sent = 0
        first_seen = None
        while self.running:
            with self.spk_lock:
                have = len(self.spk)
            if not have:
                clock, sent, first_seen = None, 0, None
                time.sleep(0.02)
                continue
            if clock is None:
                # Optional jitter buffer (HALA_PREBUFFER, default off): let a little audio pile up before the first sample
                # leaves, so a slow start of a sentence cannot play as a stutter. Never waits longer than 0.6 s.
                if first_seen is None:
                    first_seen = time.monotonic()
                if PREBUFFER > 0 and have < int(PREBUFFER * BYTES_PER_SEC) and time.monotonic() - first_seen < 0.6:
                    time.sleep(0.01)
                    continue
                clock = time.monotonic()
                first_seen = None
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
            self.interrupt_id = 0                       # event numbers start again in every conversation
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
            ae = ev["audio_event"]
            eid = as_int(ae.get("event_id"))
            if eid is not None and eid <= self.interrupt_id:
                return                                  # a leftover of an answer that was cut off: never play it
            self.thinking_until = 0.0
            pcm = resample(base64.b64decode(ae["audio_base_64"]), self.out_rate)
            with self.spk_lock:
                self.spk += pcm
        elif t == "interruption":
            iid = as_int((ev.get("interruption_event") or {}).get("event_id"))
            if iid is not None:
                self.interrupt_id = max(self.interrupt_id, iid)
            self.stop_speaking()
        elif t == "user_transcript":
            self.thinking_until = time.monotonic() + 10   # the caller finished a sentence: HALA is thinking until it speaks
            self.log("user", ev["user_transcription_event"]["user_transcript"])
        elif t == "agent_response":
            self.log("agent", re.sub(r"\s*\[[^\]]{1,30}\]\s*", " ", ev["agent_response_event"]["agent_response"]).strip())
        elif t in ("agent_tool_request", "agent_tool_response"):
            self.tool_inflight = max(0, self.tool_inflight + (1 if t.endswith("request") else -1))
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
            started = time.monotonic()
            try:
                self.phase = "connecting"
                if not self.focus:
                    self.focus = self.io.take_focus()
                    self.log("info" if self.focus else "warn", "speaker focus: " + ("yes" if self.focus else "NO (ask MangoBot to check the agent module)"))
                s = self.net.request("/api/robot/session", {})
                url = s["signedUrl"]
                self.start_procedures = s.get("startProcedureIds") or []
                self.ws = websocket.WebSocketApp(
                    url,
                    on_open=lambda ws: self.on_open(ws),
                    on_message=self.on_message,
                    on_error=lambda ws, e: self.log("warn", "websocket error: %s" % e),
                    on_close=lambda ws, c, m: self.on_close(c, m))
                self.ws.run_forever(ping_interval=20, ping_timeout=10)
            except Exception as e:
                self.last_error = "cannot start the conversation: %s" % e
                self.log("error", self.last_error + " (does PC2 have internet?)")
            self.ws = None
            self.connected = False
            if self.running and self.desired == "running":
                self.phase = "connecting"
                # A conversation that ran for a while and then ended (the visitor left, the call ended) is followed by the next
                # one almost at once. One that died within seconds (no credit left, a refused link) is a failure: back off
                # 1, 2, 4 ... 15 s instead of asking ElevenLabs for a new conversation every second.
                if time.monotonic() - started > 20:
                    backoff = 1
                else:
                    self.log("warn", "the conversation ended after %d s. Trying again in %d s." % (time.monotonic() - started, backoff))
                wake = time.monotonic() + backoff
                while self.running and self.desired == "running" and time.monotonic() < wake:
                    time.sleep(0.25)                   # so that Stop on the website is obeyed at once
                backoff = min(backoff * 2, 15)
        self.finish_session()

    def on_open(self, ws):
        self.connected = True
        self.last_error = ""
        init = {"type": "conversation_initiation_client_data"}
        if getattr(self, "start_procedures", None):
            init["start_procedure_ids"] = self.start_procedures  # the booking flow is ready from the first word
        self.ws_send(init)

    def on_close(self, code, msg):
        self.connected = False
        self.log("info", "conversation closed %s %s" % (code or "", msg or ""))

    def finish_session(self):
        self.stop_speaking()
        if self.focus:
            self.io.drop_focus()
            self.focus = False
        self.conversation_id = ""
        self.tool_inflight = 0
        self.thinking_until = 0.0
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
            if t == "display":
                if self.display is None:
                    return False, "face control is not available (HALA_FACE=0, or this AimDK has no screen services)"
                self.display.run(p, lambda ok, text: self.finish_async(cmd, ok, text))
                return None  # the answer comes later, from the face/LED thread
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

    def finish_async(self, cmd, ok, text):
        """A command that was handed to another thread has an answer: report it at the next sync."""
        self.log("info" if ok else "warn", "command %s: %s" % (cmd.get("payload", {}).get("type", cmd["type"]), text))
        self.results.append({"id": cmd["id"], "ok": bool(ok), "result": str(text)[:290]})

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
        if self.display is not None:
            self.display.on_directive(res.get("display"))
        for cmd in res.get("commands", []):
            out = self.run_command(cmd)
            if out is None:
                continue  # answered later (finish_async)
            ok, text = out
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
        if FACE_ENABLED:
            self.display = Display(self)
            self.log("info", "face, lights and screen: %s" % ("simulated" if SIM else "ready (emoji priority %d, LED priority %d)" % (FACE_PRIORITY, LED_PRIORITY)))
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
