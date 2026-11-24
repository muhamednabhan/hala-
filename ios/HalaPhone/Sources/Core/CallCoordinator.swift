import AVFoundation
import Combine
import ElevenLabs
import SwiftUI

enum CallPhase: Equatable {
    case ringing            // incoming, not answered yet
    case calling            // outgoing, dialling
    case connecting         // answered, joining the voice room
    case connected
    case failed(String)
    case ended
}

struct ActiveCall: Identifiable, Equatable {
    let id = UUID()
    var incoming: Bool
    var phase: CallPhase
    var startedAt: Date?
    /// What HALA says first when it called you. Starts with the AI disclosure.
    var opening: String?
    var reason: String?
    var language: String?
    var ringID: String?
    /// The line (E.164) this call belongs to.
    var number: String
}

struct CaptionLine: Identifiable, Equatable {
    let id: String
    let mine: Bool
    let text: String
}

/// One phone call at a time: the outgoing call to HALA, or HALA calling you. The voice itself is the
/// ElevenLabs conversation (WebRTC); this class is the "phone" around it: ringing, timer, mute, speaker,
/// call history.
@MainActor
final class CallCoordinator: ObservableObject {
    @Published var call: ActiveCall?
    @Published var isMuted = false
    @Published var speakerOn = true
    @Published var captionsOn = false
    @Published var agentSpeaking = false
    @Published var captions: [CaptionLine] = []
    @Published var elapsed: TimeInterval = 0

    private let client = ConversationClient()
    private var bag = Set<AnyCancellable>()
    private weak var state: AppState?
    private var timer: Timer?
    private var ringTimeout: Task<Void, Never>?
    private var startTask: Task<Void, Never>?

    func attach(_ state: AppState) {
        guard self.state == nil else { return }
        self.state = state
        state.calls = self

        client.$state
            .receive(on: DispatchQueue.main)
            .sink { [weak self] s in self?.clientStateChanged(s) }
            .store(in: &bag)
        client.$agentState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] s in self?.agentSpeaking = (s == .speaking) }
            .store(in: &bag)
        client.$isMicMuted
            .receive(on: DispatchQueue.main)
            .sink { [weak self] muted in self?.isMuted = muted }
            .store(in: &bag)
        client.$chatHistory
            .receive(on: DispatchQueue.main)
            .sink { [weak self] items in
                let lines = items.compactMap { $0.message }.suffix(8).map {
                    CaptionLine(id: $0.id, mine: $0.role == .user, text: $0.content)
                }
                self?.captions = Array(lines)
            }
            .store(in: &bag)
    }

    // MARK: Status text

    var statusText: String {
        guard let call else { return "" }
        switch call.phase {
        case .ringing: return "mobile"
        case .calling: return "calling…"
        case .connecting: return "connecting…"
        case .connected: return Self.format(elapsed)
        case .failed: return "Call Failed"
        case .ended: return "Call Ended"
        }
    }

    static func format(_ t: TimeInterval) -> String {
        let s = Int(t)
        return s >= 3600
            ? String(format: "%d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
            : String(format: "%02d:%02d", s / 60, s % 60)
    }

    // MARK: Outgoing

    /// The dialled digits. Only HALA's own number connects; anything else behaves like a dead number.
    func startOutgoing(digits: String) {
        guard call == nil, let state else { return }
        let cleaned = digits.filter { $0.isNumber }
        guard !cleaned.isEmpty else { return }
        Haptics.press()
        if cleaned != HALA.dialNumber {
            let record = CallRecord(date: Date(), direction: .outgoing, duration: 0, number: digits)
            state.record(record)
            call = ActiveCall(incoming: false, phase: .failed("The number you dialled isn't available. Dial 800 4252 to reach HALA."), number: state.activeLine.e164)
            Haptics.warning()
            dismiss(after: 2.8)
            return
        }
        let c = ActiveCall(incoming: false, phase: .calling, number: state.activeLine.e164)
        begin(c)
    }

    private func begin(_ c: ActiveCall) {
        call = c
        elapsed = 0
        captions = []
        captionsOn = false
        speakerOn = state?.data.speakerDefault ?? true
        UIApplication.shared.isIdleTimerDisabled = true
        startTask?.cancel()
        startTask = Task { [weak self] in await self?.connect(c) }
    }

    private func connect(_ c: ActiveCall) async {
        guard let state else { return }
        let line = state.activeLine
        let api = state.api
        var vars: [String: DynamicVariableValue] = [
            "caller_number": .string(line.e164),
            "caller_name": .string(line.name),
            "contact_mode": .string(c.incoming ? "outbound call" : "voice call"),
            "call_reason": .string(c.reason ?? "none")
        ]
        vars["caller_language"] = .string(line.language)
        var overrides: AgentOverrides?
        if let opening = c.opening {
            overrides = AgentOverrides(firstMessage: opening, language: c.language.map { Language(rawValue: $0) })
        }
        let config = ConversationConfig(agentOverrides: overrides, dynamicVariables: vars)
        do {
            call?.phase = c.incoming ? .connecting : .calling
            _ = try await client.startVoiceConversation(.conversationToken { try await api.voiceToken() }, config: config)
        } catch is CancellationError {
            // hung up before it connected
        } catch {
            fail((error as? LocalizedError)?.errorDescription ?? error.localizedDescription)
        }
    }

    private func clientStateChanged(_ s: ConversationState) {
        guard let current = call else { return }
        switch s {
        case .connected(let info):
            if current.phase != .connected && current.phase != .ended { markConnected(conversationId: info.conversationId) }
        case .ended:
            if current.phase == .connected { finish() }
        case .error(let error):
            if current.phase == .calling || current.phase == .connecting {
                fail(error.errorDescription ?? "Could not connect")
            }
        default:
            break
        }
    }

    private func markConnected(conversationId: String) {
        guard var c = call else { return }
        c.phase = .connected
        c.startedAt = Date()
        call = c
        Haptics.success()
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self, let start = self.call?.startedAt else { return }
                self.elapsed = Date().timeIntervalSince(start)
            }
        }
        if let state {
            let api = state.api
            let phone = c.number
            Task { await api.bindCall(phone: phone, conversationId: conversationId) }
        }
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 600_000_000)
            self?.applySpeaker()
        }
    }

    private func fail(_ message: String) {
        guard let c = call, c.phase != .ended else { return }
        startTask?.cancel()
        timer?.invalidate()
        if let state, !c.incoming {
            state.record(CallRecord(date: Date(), direction: .outgoing, duration: 0, number: HALA.displayNumber))
        }
        var failed = c
        failed.phase = .failed(message)
        call = failed
        Haptics.warning()
        Task { await client.endConversation() }
        cleanUpAudio()
        dismiss(after: 3)
    }

    // MARK: Incoming (HALA calls you)

    func presentIncoming(_ ring: ServerRing, number: String, inBackground: Bool) {
        guard let state else { return }
        let api = state.api
        guard call == nil else {
            Task { await api.ackRing(id: ring.id, phone: number, status: "missed") }
            return
        }
        call = ActiveCall(
            incoming: true, phase: .ringing, opening: ring.opening, reason: ring.reason,
            language: ring.language, ringID: ring.id, number: number
        )
        SoundPlayer.shared.startRinging()
        Task { await api.ackRing(id: ring.id, phone: number, status: "delivered") }
        if inBackground {
            Notifier.shared.post(title: "HALA is calling", body: "Open HALA Phone to answer.", id: "ring-\(ring.id)")
        }
        let id = ring.id
        ringTimeout?.cancel()
        ringTimeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 40_000_000_000)
            guard !Task.isCancelled else { return }
            self?.ringTimedOut(id)
        }
    }

    private func ringTimedOut(_ ringID: String) {
        guard let c = call, c.ringID == ringID, c.phase == .ringing, let state else { return }
        SoundPlayer.shared.stopRinging()
        state.record(CallRecord(date: Date(), direction: .missed, duration: 0, number: HALA.displayNumber))
        let api = state.api
        let number = c.number
        Task { await api.ackRing(id: ringID, phone: number, status: "missed") }
        call = nil
    }

    func accept() {
        guard var c = call, c.phase == .ringing else { return }
        ringTimeout?.cancel()
        SoundPlayer.shared.stopRinging()
        Haptics.press()
        if let state, let id = c.ringID {
            let api = state.api
            let number = c.number
            Task { await api.ackRing(id: id, phone: number, status: "answered") }
        }
        c.phase = .connecting
        begin(c)
    }

    func decline() {
        guard let c = call, c.phase == .ringing, let state else { return }
        ringTimeout?.cancel()
        SoundPlayer.shared.stopRinging()
        Haptics.press()
        state.record(CallRecord(date: Date(), direction: .incoming, duration: 0, number: HALA.displayNumber))
        if let id = c.ringID {
            let api = state.api
            let number = c.number
            Task { await api.ackRing(id: id, phone: number, status: "declined") }
        }
        call = nil
    }

    // MARK: In call

    func hangUp() {
        Haptics.press()
        guard let c = call else { return }
        switch c.phase {
        case .ringing: decline()
        case .failed: call = nil
        default: finish()
        }
    }

    func toggleMute() {
        Haptics.tap()
        Task { try? await client.setMicMuted(!isMuted) }
    }

    func toggleSpeaker() {
        Haptics.tap()
        speakerOn.toggle()
        applySpeaker()
    }

    private func applySpeaker() {
        try? AVAudioSession.sharedInstance().overrideOutputAudioPort(speakerOn ? .speaker : .none)
    }

    private func finish() {
        guard var c = call, c.phase != .ended else { return }
        startTask?.cancel()
        timer?.invalidate()
        let duration = c.startedAt.map { Date().timeIntervalSince($0) } ?? 0
        state?.record(CallRecord(date: Date(), direction: c.incoming ? .incoming : .outgoing, duration: duration, number: HALA.displayNumber))
        c.phase = .ended
        call = c
        Haptics.tap()
        Task { await client.endConversation() }
        cleanUpAudio()
        dismiss(after: 0.9)
    }

    private func cleanUpAudio() {
        UIApplication.shared.isIdleTimerDisabled = false
        try? AVAudioSession.sharedInstance().overrideOutputAudioPort(.none)
        if let state, state.data.keepAlive { SoundPlayer.shared.setKeepAlive(true) }
    }

    private func dismiss(after seconds: Double) {
        let id = call?.id
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            if self?.call?.id == id { self?.call = nil }
        }
    }

    // MARK: Screenshot / demo support

    /// Shows a call screen in a fixed state without any network. Used by the simulator screenshots.
    func showDemo(_ phase: CallPhase, incoming: Bool = false) {
        call = ActiveCall(
            incoming: incoming, phase: phase,
            startedAt: phase == .connected ? Date().addingTimeInterval(-74) : nil,
            opening: nil, number: "+971501234567"
        )
        elapsed = 74
        if phase == .connected {
            captions = [
                CaptionLine(id: "1", mine: false, text: "Welcome to HALA. I'm an AI assistant, not a person. How can I help?"),
                CaptionLine(id: "2", mine: true, text: "My AC is broken, can someone come today?")
            ]
        }
    }
}
