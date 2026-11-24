import Foundation

// MARK: - Lines (the dummy phone numbers)

/// One "SIM": a made-up number with a name. Switching the active line is how the demo shows HALA
/// dealing with different people. Nothing here is verified; it is a label the server trusts.
struct Line: Codable, Identifiable, Equatable, Hashable {
    var id = UUID()
    var name: String
    /// What the user typed, e.g. "+971 50 123 4567".
    var number: String
    /// "en" or "ar": the language HALA uses first with this person.
    var language: String = "en"

    /// "+971501234567". What the server keys everything on.
    var e164: String { Line.normalize(number) }

    static func normalize(_ raw: String) -> String {
        let digits = raw.filter { $0.isNumber }
        let stripped = digits.hasPrefix("00") ? String(digits.dropFirst(2)) : digits
        return "+" + stripped
    }

    static func isPlausible(_ raw: String) -> Bool {
        let n = raw.filter { $0.isNumber }.count
        return n >= 7 && n <= 15
    }

    static let samples: [Line] = [
        Line(name: "Sara Al Mansoori", number: "+971 50 123 4567", language: "en"),
        Line(name: "Omar Haddad", number: "+971 55 987 6543", language: "ar")
    ]
}

// MARK: - Messages

enum MessageKind: String, Codable { case text, voice }
enum DeliveryState: String, Codable { case sending, sent, failed }

struct ChatMessage: Codable, Identifiable, Equatable {
    var id: String
    /// Server cursor. Nil while a message is still only local.
    var seq: Int?
    var fromMe: Bool
    var kind: MessageKind = .text
    /// For a voice message this is the transcript.
    var text: String
    /// Path on the server, e.g. "/api/phone/audio/<id>".
    var audioPath: String?
    var durationSec: Int?
    var date: Date
    var state: DeliveryState = .sent
}

// MARK: - Calls

enum CallDirection: String, Codable { case outgoing, incoming, missed }

struct CallRecord: Codable, Identifiable, Equatable {
    var id = UUID()
    var date: Date
    var direction: CallDirection
    var duration: TimeInterval
    var number: String
}

// MARK: - Server JSON

struct ServerMessage: Decodable {
    let id: String
    let seq: Int
    let from: String
    let kind: String
    let text: String
    let audioUrl: String?
    let durationSec: Int?
    let ts: Date

    func asChat() -> ChatMessage {
        ChatMessage(
            id: id, seq: seq, fromMe: from == "user", kind: kind == "voice" ? .voice : .text,
            text: text, audioPath: audioUrl, durationSec: durationSec, date: ts, state: .sent
        )
    }
}

struct ServerRing: Decodable, Identifiable, Equatable {
    let id: String
    let seq: Int
    let reason: String
    let opening: String
    let language: String
    let status: String
    let createdAt: Date
}

struct InboxResponse: Decodable {
    let messages: [ServerMessage]
    let rings: [ServerRing]
    let cursor: Int
}

struct SmsResponse: Decodable {
    let message: ServerMessage
    let replies: [ServerMessage]
    let linked: Bool?
}

struct TokenResponse: Decodable {
    let token: String
}

struct ServerError: Decodable { let error: String? }

// MARK: - The one number HALA answers on

enum HALA {
    /// 800-HALA on a keypad. Dialled digits are compared without spaces.
    static let dialNumber = "8004252"
    static let displayNumber = "800 4252"
    static let name = "HALA Concierge"
    static let shortName = "HALA"
    static let scheme = "halaphone"
}
