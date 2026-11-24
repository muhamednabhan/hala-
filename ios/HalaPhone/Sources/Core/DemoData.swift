import Foundation

/// Sample content for screenshots and design review, switched on with launch arguments
/// (`-HALA_DEMO 1 -HALA_TAB 3 -HALA_THREAD 1`, `-HALA_CALL connected|incoming|failed`).
/// Never used in a normal launch, and never touches the network or saved data.
enum DemoData {
    private static var defaults: UserDefaults { .standard }

    static var isRequested: Bool { defaults.bool(forKey: "HALA_DEMO") }
    static var initialTab: AppTab { AppTab(rawValue: defaults.integer(forKey: "HALA_TAB")) ?? .keypad }
    static var openThread: Bool { defaults.bool(forKey: "HALA_THREAD") }
    static var callMode: String? { defaults.string(forKey: "HALA_CALL") }

    static func make() -> PersistedState {
        var s = PersistedState()
        let line = s.lines[0]
        s.activeLineID = line.id
        s.server = "https://hala-demo.example.com"
        let now = Date()
        func ago(_ minutes: Double) -> Date { now.addingTimeInterval(-minutes * 60) }

        s.messages[line.e164] = [
            ChatMessage(id: "d1", seq: 1, fromMe: true, text: "Hi, the AC in my unit stopped working", date: ago(42)),
            ChatMessage(
                id: "d2", seq: 2, fromMe: false,
                text: "Welcome to HALA. I'm an AI assistant, not a person. How can I help?", date: ago(42)
            ),
            ChatMessage(
                id: "d3", seq: 3, fromMe: false,
                text: "I can log a maintenance request for you. Which unit is it, and what's the problem?", date: ago(41)
            ),
            ChatMessage(id: "d4", seq: 4, fromMe: true, text: "Unit 204, it blows warm air", date: ago(40)),
            ChatMessage(
                id: "d5", seq: 5, fromMe: false, kind: .voice,
                text: "Done. I've logged request REQ 1 0 0 1. The DSO team will follow up. Anything else?",
                audioPath: "/api/phone/audio/demo", durationSec: 9, date: ago(39)
            ),
            ChatMessage(id: "d6", seq: 6, fromMe: true, text: "Thanks! Can you text me what I need for an access card?", date: ago(3)),
            ChatMessage(
                id: "d7", seq: 7, fromMe: false,
                text: "Sure. For an access card you need a passport copy and your tenancy contract. The fee shown is a demo value.",
                date: ago(2)
            )
        ]
        s.unread[line.e164] = 0
        s.recents = [
            CallRecord(date: ago(18), direction: .outgoing, duration: 94, number: HALA.displayNumber),
            CallRecord(date: ago(190), direction: .missed, duration: 0, number: HALA.displayNumber),
            CallRecord(date: ago(60 * 26), direction: .incoming, duration: 41, number: HALA.displayNumber),
            CallRecord(date: ago(60 * 24 * 3), direction: .outgoing, duration: 206, number: HALA.displayNumber)
        ]
        return s
    }
}
