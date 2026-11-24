import SwiftUI
import UIKit

enum AppTab: Int, Hashable {
    case recents, contacts, keypad, messages, lines
}

/// Everything that survives a relaunch. Small, so one JSON blob in UserDefaults is plenty.
struct PersistedState: Codable {
    var lines: [Line] = Line.samples
    var activeLineID: UUID?
    var server: String = ""
    var adminKey: String = ""
    var voiceReplies = false
    var speakerDefault = true
    var keepAlive = false
    var messages: [String: [ChatMessage]] = [:]
    var cursors: [String: Int] = [:]
    var unread: [String: Int] = [:]
    var recents: [CallRecord] = []
    var seenRings: [String] = []
}

@MainActor
final class AppState: ObservableObject {
    // MARK: Persisted
    @Published var data: PersistedState {
        didSet { save() }
    }

    // MARK: Session only
    @Published var tab: AppTab = .keypad
    @Published var messagesPath: [String] = []
    @Published var draft = ""
    @Published var focusComposer = false
    @Published var typing: [String: Bool] = [:]
    @Published var toast: String?
    @Published var serverReachable: Bool?
    var demoMode = false

    weak var calls: CallCoordinator?
    private var poller: Task<Void, Never>?
    private static let key = "hala.state.v1"

    init() {
        if let raw = UserDefaults.standard.data(forKey: AppState.key),
           let decoded = try? JSONDecoder().decode(PersistedState.self, from: raw) {
            data = decoded
        } else {
            data = PersistedState()
        }
        if data.activeLineID == nil || !data.lines.contains(where: { $0.id == data.activeLineID }) {
            data.activeLineID = data.lines.first?.id
        }
        if data.server.isEmpty,
           let baked = Bundle.main.object(forInfoDictionaryKey: "HALAServer") as? String, !baked.isEmpty {
            data.server = baked
        }
        if DemoData.isRequested {
            demoMode = true
            data = DemoData.make()
            tab = DemoData.initialTab
            if tab == .messages && DemoData.openThread { messagesPath = [activeLine.e164] }
        }
    }

    private func save() {
        guard !demoMode, let raw = try? JSONEncoder().encode(data) else { return }
        UserDefaults.standard.set(raw, forKey: AppState.key)
    }

    // MARK: Convenience

    var api: HalaAPI { HalaAPI(server: data.server) }

    var activeLine: Line {
        data.lines.first(where: { $0.id == data.activeLineID }) ?? data.lines.first ?? Line.samples[0]
    }

    func messages(for key: String) -> [ChatMessage] { data.messages[key] ?? [] }

    var unreadForActive: Int { data.unread[activeLine.e164] ?? 0 }

    func showToast(_ text: String) {
        toast = text
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if self?.toast == text { self?.toast = nil }
        }
    }

    // MARK: Lines

    func selectLine(_ id: UUID) {
        guard id != data.activeLineID else { return }
        data.activeLineID = id
        messagesPath = []
        Haptics.select()
        announceLine()
        Task { await pollOnce() }
    }

    func addLine(name: String, number: String, language: String) {
        let line = Line(name: name.trimmingCharacters(in: .whitespaces), number: number.trimmingCharacters(in: .whitespaces), language: language)
        data.lines.append(line)
        selectLine(line.id)
    }

    func removeLine(_ id: UUID) {
        guard data.lines.count > 1 else { return }
        data.lines.removeAll { $0.id == id }
        if data.activeLineID == id { data.activeLineID = data.lines.first?.id; messagesPath = [] }
    }

    func updateLine(_ line: Line) {
        guard let i = data.lines.firstIndex(where: { $0.id == line.id }) else { return }
        data.lines[i] = line
        if line.id == data.activeLineID { announceLine() }
    }

    /// Tell the server who this number belongs to, so HALA can greet them by name.
    func announceLine() {
        guard !demoMode else { return }
        let line = activeLine
        let api = self.api
        Task { await api.setProfile(phone: line.e164, name: line.name, language: line.language) }
    }

    // MARK: Deep link (the robot's QR code)

    func handle(url: URL) {
        guard url.scheme == HALA.scheme else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        func query(_ name: String) -> String? { comps?.queryItems?.first(where: { $0.name == name })?.value }
        guard url.host == "link" || url.host == "sms" else { return }
        if let server = query("server"), !server.isEmpty { data.server = server }
        tab = .messages
        messagesPath = [activeLine.e164]
        if let code = query("code"), !code.isEmpty {
            draft = "HALA \(code.uppercased())"
            focusComposer = true
        }
        announceLine()
        Task { await pollOnce() }
    }

    // MARK: Sending a text

    func send(_ raw: String) {
        let body = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        let key = activeLine.e164
        let local = ChatMessage(id: "local-\(UUID().uuidString)", seq: nil, fromMe: true, text: body, date: Date(), state: .sending)
        append([local], to: key)
        SoundPlayer.shared.messageSent()
        deliver(local, key: key)
    }

    func resend(_ id: String) {
        let key = activeLine.e164
        guard let i = data.messages[key]?.firstIndex(where: { $0.id == id }), var m = data.messages[key]?[i] else { return }
        m.state = .sending
        data.messages[key]?[i] = m
        deliver(m, key: key)
    }

    private func deliver(_ local: ChatMessage, key: String) {
        typing[key] = true
        let api = self.api
        let voice = data.voiceReplies
        Task {
            do {
                let res = try await api.sendText(from: key, body: local.text, voice: voice)
                var sent = res.message.asChat()
                sent.state = .sent
                replace(local.id, with: sent, key: key)
                if res.linked == true {
                    Haptics.success()
                    showToast("Linked. HALA now knows this number.")
                }
                for reply in res.replies {
                    try? await Task.sleep(nanoseconds: 450_000_000)
                    append([reply.asChat()], to: key)
                    SoundPlayer.shared.messageReceived()
                    Haptics.tap()
                }
                bump(cursor: max(res.message.seq, res.replies.map(\.seq).max() ?? 0), key: key)
            } catch {
                mark(local.id, as: .failed, key: key)
                Haptics.warning()
                showToast((error as? LocalizedError)?.errorDescription ?? "Not delivered.")
            }
            typing[key] = false
        }
    }

    // MARK: Message store helpers

    private func append(_ new: [ChatMessage], to key: String) {
        var list = data.messages[key] ?? []
        for m in new where !list.contains(where: { $0.id == m.id }) { list.append(m) }
        data.messages[key] = list
    }

    private func replace(_ id: String, with message: ChatMessage, key: String) {
        var list = data.messages[key] ?? []
        if list.contains(where: { $0.id == message.id }) {
            list.removeAll { $0.id == id }
        } else if let i = list.firstIndex(where: { $0.id == id }) {
            list[i] = message
        } else {
            list.append(message)
        }
        data.messages[key] = list
    }

    private func mark(_ id: String, as state: DeliveryState, key: String) {
        guard let i = data.messages[key]?.firstIndex(where: { $0.id == id }) else { return }
        data.messages[key]?[i].state = state
    }

    private func bump(cursor: Int, key: String) {
        data.cursors[key] = max(data.cursors[key] ?? 0, cursor)
    }

    func markRead() {
        let key = activeLine.e164
        if (data.unread[key] ?? 0) != 0 { data.unread[key] = 0 }
        Notifier.shared.clearBadge()
    }

    var isThreadOpen: Bool { tab == .messages && messagesPath.last == activeLine.e164 }

    // MARK: Polling the server for calls and texts

    func startPolling() {
        guard !demoMode else { return }
        poller?.cancel()
        poller = Task { [weak self] in
            while !Task.isCancelled {
                await self?.pollOnce()
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }

    func stopPolling() {
        poller?.cancel()
        poller = nil
    }

    func pollOnce() async {
        guard !demoMode, data.server.isEmpty == false else { return }
        let key = activeLine.e164
        do {
            let inbox = try await api.inbox(phone: key, since: data.cursors[key] ?? 0)
            serverReachable = true
            apply(inbox, key: key)
        } catch {
            serverReachable = false
        }
    }

    private func apply(_ inbox: InboxResponse, key: String) {
        let background = UIApplication.shared.applicationState != .active
        let fresh = inbox.messages.filter { m in !(data.messages[key] ?? []).contains(where: { $0.id == m.id }) }
        if !fresh.isEmpty {
            append(fresh.map { $0.asChat() }, to: key)
            let incoming = fresh.filter { $0.from == "agent" }
            if !incoming.isEmpty {
                if !isThreadOpen { data.unread[key, default: 0] += incoming.count }
                if background, let last = incoming.last {
                    Notifier.shared.post(title: "HALA", body: last.kind == "voice" ? "Voice message" : last.text)
                } else {
                    SoundPlayer.shared.messageReceived()
                }
            }
        }
        bump(cursor: inbox.cursor, key: key)

        for ring in inbox.rings where !data.seenRings.contains(ring.id) {
            data.seenRings.append(ring.id)
            if data.seenRings.count > 100 { data.seenRings.removeFirst(data.seenRings.count - 100) }
            let age = Date().timeIntervalSince(ring.createdAt)
            if ring.status == "pending" && age < 80 {
                calls?.presentIncoming(ring, number: key, inBackground: background)
            } else if ring.status == "missed" {
                data.recents.insert(CallRecord(date: ring.createdAt, direction: .missed, duration: 0, number: HALA.displayNumber), at: 0)
            }
        }
    }

    // MARK: Recents

    func record(_ call: CallRecord) {
        data.recents.insert(call, at: 0)
        if data.recents.count > 200 { data.recents.removeLast(data.recents.count - 200) }
    }

    func clearConversation() {
        let key = activeLine.e164
        data.messages[key] = []
        data.unread[key] = 0
    }
}
