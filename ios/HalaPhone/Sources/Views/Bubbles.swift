import AVFoundation
import SwiftUI

/// A chat bubble: rounded body plus the small tail iMessage draws on the last bubble of a run.
/// Body and tail are separate fills so there is never a seam or a winding-rule hole.
struct BubbleBackground: View {
    var mine: Bool
    var tail: Bool
    var color: Color

    var body: some View {
        ZStack(alignment: mine ? .bottomTrailing : .bottomLeading) {
            RoundedRectangle(cornerRadius: 18, style: .continuous).fill(color)
            if tail {
                BubbleTail(mine: mine)
                    .fill(color)
                    .frame(width: 20, height: 16)
                    .offset(x: mine ? 6 : -6)
            }
        }
    }
}

struct BubbleTail: Shape {
    var mine: Bool
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: 4, y: 0))
        p.addCurve(to: CGPoint(x: 20, y: 16), control1: CGPoint(x: 4, y: 9), control2: CGPoint(x: 11, y: 15.5))
        p.addCurve(to: CGPoint(x: 0, y: 12), control1: CGPoint(x: 13, y: 17), control2: CGPoint(x: 5, y: 15))
        p.addLine(to: CGPoint(x: 0, y: 0))
        p.closeSubpath()
        if mine { return p }
        // Mirror for received bubbles (tail on the left).
        return p.applying(CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: rect.width, ty: 0))
    }
}

struct TextBubble: View {
    let message: ChatMessage
    let showTail: Bool

    var body: some View {
        Text(linkified(message.text))
            .font(.system(size: 17))
            .foregroundStyle(message.fromMe ? Color.white : Color.primary)
            .padding(.horizontal, 13)
            .padding(.vertical, 8)
            .background(BubbleBackground(mine: message.fromMe, tail: showTail, color: message.fromMe ? Theme.green : Theme.received))
            .frame(maxWidth: 290, alignment: message.fromMe ? .trailing : .leading)
            .opacity(message.state == .sending ? 0.7 : 1)
            .accessibilityLabel("\(message.fromMe ? "You" : "HALA"): \(message.text)")
    }
}

/// Makes every web address in a message tappable. HALA texts the Smart Pass link, and SwiftUI's `Text` does not
/// detect links in a plain String. A message with no link comes back unchanged.
func linkified(_ string: String) -> AttributedString {
    var result = AttributedString(string)
    guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return result }
    let whole = NSRange(string.startIndex..., in: string)
    for match in detector.matches(in: string, options: [], range: whole) {
        guard let url = match.url,
              let range = Range(match.range, in: string),
              let lower = AttributedString.Index(range.lowerBound, within: result),
              let upper = AttributedString.Index(range.upperBound, within: result) else { continue }
        result[lower..<upper].link = url
    }
    return result
}

/// A voice message from HALA: play button, waveform, length, and the transcript underneath, like the
/// Messages app shows for audio messages.
struct VoiceBubble: View {
    let message: ChatMessage
    let showTail: Bool
    @EnvironmentObject var state: AppState
    @ObservedObject private var player = VoicePlayer.shared

    private var playing: Bool { player.playingID == message.id }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                Button {
                    Haptics.tap()
                    if let path = message.audioPath, let url = state.api.absolute(path) {
                        player.toggle(id: message.id, url: url)
                    }
                } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 32, height: 32)
                        .background(Circle().fill(Theme.blue))
                }
                .buttonStyle(PressableCircleStyle(pressedScale: 0.9))
                .accessibilityLabel(playing ? "Pause voice message" : "Play voice message")

                Waveform(seed: message.id, progress: playing ? player.progress : 0, tint: Theme.blue)
                    .frame(width: 112, height: 24)

                Text(durationText)
                    .font(.system(size: 13, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            if !message.text.isEmpty {
                Text(message.text)
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 9)
        .background(BubbleBackground(mine: false, tail: showTail, color: Theme.received))
        .frame(maxWidth: 290, alignment: .leading)
    }

    private var durationText: String {
        let total = max(1, message.durationSec ?? 1)
        let shown = playing ? Int(Double(total) * player.progress) : total
        return String(format: "%d:%02d", shown / 60, shown % 60)
    }
}

struct Waveform: View {
    let seed: String
    let progress: Double
    let tint: Color
    private let count = 22

    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(0..<count, id: \.self) { i in
                Capsule()
                    .fill(Double(i) / Double(count) < progress ? tint : tint.opacity(0.35))
                    .frame(width: 2.5, height: height(i))
            }
        }
        .frame(maxHeight: .infinity)
    }

    /// Deterministic bars from the message id, so a message always looks the same.
    private func height(_ i: Int) -> CGFloat {
        var h: UInt64 = 5381
        for c in seed.utf8 { h = (h &* 33) &+ UInt64(c) }
        let x = (h &+ UInt64(i + 1) &* 2_654_435_761) % 1000
        return 5 + CGFloat(x) / 1000 * 19
    }
}

struct TypingBubble: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 0.08)) { context in
            let t = context.date.timeIntervalSinceReferenceDate
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(Color.secondary)
                        .frame(width: 8, height: 8)
                        .opacity(reduceMotion ? 0.6 : 0.3 + 0.7 * max(0, sin(t * 4.5 - Double(i) * 0.8)))
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 14)
            .background(BubbleBackground(mine: false, tail: true, color: Theme.received))
        }
        .accessibilityLabel("HALA is typing")
    }
}

/// Plays HALA's voice messages. One at a time.
@MainActor
final class VoicePlayer: ObservableObject {
    static let shared = VoicePlayer()
    @Published var playingID: String?
    @Published var progress: Double = 0
    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?

    func toggle(id: String, url: URL) {
        if playingID == id { stop(); return }
        stop()
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .spokenAudio, options: [.mixWithOthers])
        try? session.setActive(true)

        let item = AVPlayerItem(url: url)
        let p = AVPlayer(playerItem: item)
        player = p
        playingID = id
        progress = 0
        timeObserver = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main) { [weak self] time in
            Task { @MainActor in
                guard let self, let duration = self.player?.currentItem?.duration.seconds, duration.isFinite, duration > 0 else { return }
                self.progress = min(1, time.seconds / duration)
            }
        }
        endObserver = NotificationCenter.default.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: item, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.stop() }
        }
        p.play()
    }

    func stop() {
        if let observer = timeObserver { player?.removeTimeObserver(observer) }
        if let end = endObserver { NotificationCenter.default.removeObserver(end) }
        timeObserver = nil
        endObserver = nil
        player?.pause()
        player = nil
        playingID = nil
        progress = 0
    }
}
