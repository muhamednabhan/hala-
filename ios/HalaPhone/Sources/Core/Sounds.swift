import AVFoundation
import AudioToolbox
import UIKit

/// Tones are generated in code (no audio files to ship): a ringtone, and a silent loop that keeps the
/// app alive in the background so a call from HALA can still ring.
enum ToneKit {
    private static let rate = 22_050

    static func wav(_ samples: [Int16]) -> Data {
        var d = Data()
        func u32(_ v: UInt32) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: UInt16) { var x = v.littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!)
        u32(UInt32(36 + samples.count * 2))
        d.append("WAVE".data(using: .ascii)!)
        d.append("fmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(UInt32(rate)); u32(UInt32(rate * 2)); u16(2); u16(16)
        d.append("data".data(using: .ascii)!)
        u32(UInt32(samples.count * 2))
        for s in samples { u16(UInt16(bitPattern: s)) }
        return d
    }

    /// A bright marimba-like phrase, twice, then a pause. Loops while the phone rings.
    static func ringtone() -> Data {
        let notes: [Double] = [659.25, 783.99, 987.77, 1318.51, 987.77, 783.99]
        let noteLength = 0.15
        var out: [Int16] = []
        func note(_ freq: Double) {
            let n = Int(noteLength * Double(rate))
            for i in 0..<n {
                let t = Double(i) / Double(rate)
                let attack = min(1.0, t / 0.004)
                let env = attack * exp(-t * 7.5)
                let v = (sin(2 * .pi * freq * t) + 0.35 * sin(4 * .pi * freq * t)) * env * 0.5
                out.append(Int16(max(-1, min(1, v)) * 30_000))
            }
        }
        for _ in 0..<2 { for f in notes { note(f) } }
        out.append(contentsOf: [Int16](repeating: 0, count: Int(1.1 * Double(rate))))
        return wav(out)
    }

    static func silence(seconds: Double = 1) -> Data {
        wav([Int16](repeating: 0, count: Int(seconds * Double(rate))))
    }
}

@MainActor
final class SoundPlayer {
    static let shared = SoundPlayer()
    private var ringtone: AVAudioPlayer?
    private var keepAlive: AVAudioPlayer?
    private var vibrationTimer: Timer?

    // MARK: Ringing

    func startRinging() {
        configureSession()
        if ringtone == nil {
            ringtone = try? AVAudioPlayer(data: ToneKit.ringtone(), fileTypeHint: "wav")
            ringtone?.numberOfLoops = -1
            ringtone?.volume = 1
        }
        ringtone?.currentTime = 0
        ringtone?.play()
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        vibrationTimer?.invalidate()
        vibrationTimer = Timer.scheduledTimer(withTimeInterval: 2.8, repeats: true) { _ in
            AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
        }
    }

    func stopRinging() {
        ringtone?.stop()
        vibrationTimer?.invalidate()
        vibrationTimer = nil
    }

    // MARK: Background keep-alive

    /// iOS suspends apps that are not doing anything. A silent audio loop (with the "audio" background
    /// mode) keeps the app running so it can keep checking for calls. Sideloaded apps only: App Store
    /// review would not allow it.
    func setKeepAlive(_ on: Bool) {
        if on {
            configureSession()
            if keepAlive == nil {
                keepAlive = try? AVAudioPlayer(data: ToneKit.silence(), fileTypeHint: "wav")
                keepAlive?.numberOfLoops = -1
                keepAlive?.volume = 0
            }
            keepAlive?.play()
        } else {
            keepAlive?.stop()
        }
    }

    /// Mixes with other audio so it never interrupts music, and does not fight the call audio.
    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? session.setActive(true)
    }

    // MARK: Small sounds

    /// The keypad click. System DTMF tones, so it sounds like the real keypad.
    func keypadTone(_ key: String) {
        let ids: [String: SystemSoundID] = [
            "1": 1200, "2": 1201, "3": 1202, "4": 1203, "5": 1204, "6": 1205,
            "7": 1206, "8": 1207, "9": 1208, "0": 1209, "*": 1210, "#": 1211
        ]
        if let id = ids[key] { AudioServicesPlaySystemSound(id) }
    }

    /// The short "sent" whoosh and "received" tri-tone are Apple's; these system IDs are the public ones.
    func messageSent() { AudioServicesPlaySystemSound(1004) }
    func messageReceived() { AudioServicesPlaySystemSound(1007) }
}

enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func press() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
    static func select() { UISelectionFeedbackGenerator().selectionChanged() }
}
