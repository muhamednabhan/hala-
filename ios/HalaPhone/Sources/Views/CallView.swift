import SwiftUI

/// Full-screen call UI. Same layout as the iOS in-call screen: name and timer on top, a 3x2 grid of
/// round controls, and the red end button. For an incoming call it switches to the Decline / Accept layout.
struct CallView: View {
    @EnvironmentObject var calls: CallCoordinator
    @State private var showKeypad = false
    @State private var dialled = ""

    var body: some View {
        ZStack {
            CallBackdrop(speaking: calls.agentSpeaking)
            if let call = calls.call {
                switch call.phase {
                case .ringing: incoming(call)
                case .failed(let message): failed(message)
                default: active(call)
                }
            }
        }
        .preferredColorScheme(.dark)
        .statusBarHidden(false)
    }

    // MARK: Header

    private func header(_ call: ActiveCall, subtitle: String) -> some View {
        VStack(spacing: 10) {
            ZStack {
                if calls.agentSpeaking {
                    PulseRing()
                }
                HalaAvatar(size: 104)
            }
            .frame(width: 104, height: 104)
            .padding(.bottom, 8)

            Text(HALA.name)
                .font(.system(size: 32, weight: .semibold))
                .displayTracking(32)
                .foregroundStyle(.white)
            Text(subtitle)
                .font(.system(size: 20, weight: .regular))
                .monospacedDigit()
                .foregroundStyle(.white.opacity(0.72))
                .contentTransition(.numericText())
                .animation(.default, value: subtitle)
            Text("AI assistant · مساعد ذكاء اصطناعي")
                .font(.system(size: 12, weight: .semibold))
                .tracking(0.4)
                .foregroundStyle(.white.opacity(0.85))
                .padding(.horizontal, 12)
                .padding(.vertical, 5)
                .background(Capsule().fill(.white.opacity(0.14)))
                .padding(.top, 2)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Active call

    private func active(_ call: ActiveCall) -> some View {
        VStack(spacing: 0) {
            header(call, subtitle: calls.statusText).padding(.top, 56)

            if calls.captionsOn {
                captionCard.padding(.top, 18).padding(.horizontal, 22)
            }
            Spacer(minLength: 12)

            if showKeypad {
                keypad
            } else {
                grid
            }

            Button { calls.hangUp() } label: {
                Image(systemName: "phone.down.fill")
                    .font(.system(size: 30))
                    .foregroundStyle(.white)
                    .frame(width: 76, height: 76)
                    .background(Circle().fill(Theme.red))
            }
            .buttonStyle(PressableCircleStyle())
            .accessibilityLabel("End call")
            .padding(.top, 26)
            .padding(.bottom, 34)
        }
    }

    private var grid: some View {
        VStack(spacing: 22) {
            HStack(spacing: 28) {
                control("mic.slash.fill", "mute", on: calls.isMuted) { calls.toggleMute() }
                control("circle.grid.3x3.fill", "keypad") { Haptics.tap(); showKeypad = true }
                control(calls.speakerOn ? "speaker.wave.3.fill" : "speaker.fill", "speaker", on: calls.speakerOn) { calls.toggleSpeaker() }
            }
            HStack(spacing: 28) {
                control("plus", "add call", enabled: false) {}
                control("captions.bubble.fill", "captions", on: calls.captionsOn) { Haptics.tap(); withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) { calls.captionsOn.toggle() } }
                control("person.crop.circle.fill", "contacts", enabled: false) {}
            }
        }
    }

    private func control(_ symbol: String, _ label: String, on: Bool = false, enabled: Bool = true, action: @escaping () -> Void) -> some View {
        VStack(spacing: 8) {
            Button(action: action) {
                Image(systemName: symbol)
                    .font(.system(size: 30))
                    .foregroundStyle(on ? Color.black : Color.white)
                    .frame(width: 76, height: 76)
                    .background(Circle().fill(on ? AnyShapeStyle(Color.white) : AnyShapeStyle(Material.ultraThin)))
                    .animation(.spring(response: 0.25, dampingFraction: 0.8), value: on)
            }
            .buttonStyle(PressableCircleStyle())
            .disabled(!enabled)
            .opacity(enabled ? 1 : 0.45)
            Text(label).font(.system(size: 13)).foregroundStyle(.white.opacity(enabled ? 0.9 : 0.5))
        }
        .accessibilityElement(children: .combine)
    }

    private var captionCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(calls.captions.suffix(4)) { line in
                Text(line.text)
                    .font(.system(size: 15, weight: line.mine ? .regular : .medium))
                    .foregroundStyle(.white.opacity(line.mine ? 0.7 : 1))
                    .frame(maxWidth: .infinity, alignment: line.mine ? .trailing : .leading)
                    .multilineTextAlignment(line.mine ? .trailing : .leading)
            }
            if calls.captions.isEmpty {
                Text("Live captions appear here.").font(.system(size: 14)).foregroundStyle(.white.opacity(0.6))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity)
        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(.ultraThinMaterial))
        .transition(.opacity.combined(with: .scale(scale: 0.96)))
    }

    // MARK: In-call keypad (tones only; HALA does not listen for key presses)

    private var keypad: some View {
        VStack(spacing: 12) {
            Text(dialled.isEmpty ? " " : dialled)
                .font(.system(size: 30, weight: .light))
                .foregroundStyle(.white)
                .frame(height: 38)
            ForEach(["123", "456", "789", "*0#"], id: \.self) { row in
                HStack(spacing: 22) {
                    ForEach(Array(row), id: \.self) { ch in
                        Button {
                            Haptics.tap()
                            SoundPlayer.shared.keypadTone(String(ch))
                            if dialled.count < 24 { dialled.append(ch) }
                        } label: {
                            Text(String(ch))
                                .font(.system(size: 32))
                                .foregroundStyle(.white)
                                .frame(width: 70, height: 70)
                                .background(Circle().fill(.ultraThinMaterial))
                        }
                        .buttonStyle(PressableCircleStyle(pressedScale: 0.94))
                    }
                }
            }
            Button("Hide") { Haptics.tap(); showKeypad = false }
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.white)
                .padding(.top, 2)
        }
    }

    // MARK: Incoming

    private func incoming(_ call: ActiveCall) -> some View {
        VStack(spacing: 0) {
            header(call, subtitle: "mobile").padding(.top, 70)
            if let reason = call.reason, !reason.isEmpty {
                Text(reason)
                    .font(.system(size: 14))
                    .foregroundStyle(.white.opacity(0.7))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 36)
                    .padding(.top, 16)
            }
            Spacer()

            HStack {
                smallAction("bell.fill", "Remind Me")
                Spacer()
                smallAction("message.fill", "Message")
            }
            .padding(.horizontal, 56)
            .padding(.bottom, 30)

            HStack {
                bigAnswer(symbol: "phone.down.fill", label: "Decline", color: Theme.red) { calls.decline() }
                Spacer()
                bigAnswer(symbol: "phone.fill", label: "Accept", color: Theme.green) { calls.accept() }
            }
            .padding(.horizontal, 52)
            .padding(.bottom, 44)
        }
    }

    private func smallAction(_ symbol: String, _ label: String) -> some View {
        VStack(spacing: 6) {
            Image(systemName: symbol).font(.system(size: 20)).frame(width: 50, height: 50)
                .background(Circle().fill(.ultraThinMaterial))
            Text(label).font(.system(size: 13))
        }
        .foregroundStyle(.white)
        .opacity(0.9)
        .accessibilityHidden(true)
    }

    private func bigAnswer(symbol: String, label: String, color: Color, action: @escaping () -> Void) -> some View {
        VStack(spacing: 10) {
            Button(action: action) {
                Image(systemName: symbol)
                    .font(.system(size: 32))
                    .foregroundStyle(.white)
                    .frame(width: 78, height: 78)
                    .background(Circle().fill(color))
            }
            .buttonStyle(PressableCircleStyle())
            Text(label).font(.system(size: 14)).foregroundStyle(.white)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Failed

    private func failed(_ message: String) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Image(systemName: "phone.down.fill")
                .font(.system(size: 40))
                .foregroundStyle(.white.opacity(0.9))
            Text("Call Failed")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(.white)
            Text(message)
                .font(.system(size: 16))
                .foregroundStyle(.white.opacity(0.75))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
            Button { calls.hangUp() } label: {
                Text("Dismiss").font(.system(size: 17, weight: .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 36).padding(.vertical, 14)
                    .background(Capsule().fill(.ultraThinMaterial))
            }
            .buttonStyle(PressableCircleStyle(pressedScale: 0.95))
            .padding(.bottom, 44)
        }
    }
}

/// Ripples out from the avatar while HALA is speaking. Still when Reduce Motion is on.
struct PulseRing: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animate = false

    var body: some View {
        Circle()
            .stroke(Theme.halaLight.opacity(0.7), lineWidth: 3)
            .scaleEffect(animate && !reduceMotion ? 1.45 : 1)
            .opacity(animate && !reduceMotion ? 0 : 0.7)
            .animation(reduceMotion ? nil : .easeOut(duration: 1.3).repeatForever(autoreverses: false), value: animate)
            .onAppear { animate = true }
    }
}

/// A dark teal backdrop with two slow-moving blurred lights, the way iOS tints the call screen from the
/// contact's colours. It brightens a little while HALA speaks, and holds still under Reduce Motion.
struct CallBackdrop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var speaking: Bool

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { context in
            let t = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
            ZStack {
                LinearGradient(
                    colors: [Color(red: 0.03, green: 0.09, blue: 0.11), Color(red: 0.02, green: 0.17, blue: 0.17)],
                    startPoint: .top, endPoint: .bottom
                )
                Circle()
                    .fill(Theme.hala.opacity(0.55))
                    .frame(width: 380, height: 380)
                    .blur(radius: 90)
                    .offset(x: 80 * sin(t * 0.25), y: -190 + 40 * cos(t * 0.31))
                Circle()
                    .fill(Theme.halaLight.opacity(speaking ? 0.38 : 0.2))
                    .frame(width: 300, height: 300)
                    .blur(radius: 80)
                    .offset(x: -90 * cos(t * 0.21), y: 210 + 50 * sin(t * 0.27))
            }
            .animation(.easeInOut(duration: 0.6), value: speaking)
        }
        .ignoresSafeArea()
    }
}
