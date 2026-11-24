import Foundation

enum APIError: LocalizedError {
    case noServer
    case badURL
    case http(Int, String?)
    case offline

    var errorDescription: String? {
        switch self {
        case .noServer: return "No HALA server is set. Open Lines and enter the server address, or scan the QR code on the robot."
        case .badURL: return "The server address looks wrong."
        case .http(let code, let message): return message ?? "The server answered with an error (\(code))."
        case .offline: return "Can't reach the HALA server."
        }
    }
}

/// Thin client for the HALA server's /api/phone/* routes. A value type, so it is safe to hand to
/// background tasks; make a fresh one whenever the server address changes.
struct HalaAPI: Sendable {
    let base: URL?

    init(server: String) {
        self.base = HalaAPI.normalize(server)
    }

    /// Accepts "abc.trycloudflare.com", "192.168.1.5:3005", "https://host/" and returns a clean origin.
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") {
            let local = s.hasPrefix("localhost") || s.hasPrefix("127.") || s.hasPrefix("192.168.") || s.hasPrefix("10.") || s.hasPrefix("172.")
            s = (local ? "http://" : "https://") + s
        }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host != nil else { return nil }
        return url
    }

    private func url(_ path: String, _ query: [String: String] = [:]) throws -> URL {
        guard let base else { throw APIError.noServer }
        guard var parts = URLComponents(url: base, resolvingAgainstBaseURL: false) else { throw APIError.badURL }
        parts.path = (parts.path.isEmpty ? "" : parts.path) + path
        if !query.isEmpty { parts.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) } }
        guard let out = parts.url else { throw APIError.badURL }
        return out
    }

    /// An absolute URL for something the server hands out as a path (voice messages).
    func absolute(_ path: String) -> URL? {
        if path.hasPrefix("http") { return URL(string: path) }
        return try? url(path)
    }

    static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: raw) ?? plain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "bad date \(raw)"))
        }
        return d
    }()

    private func send<T: Decodable>(_ req: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.offline }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error
            throw APIError.http(http.statusCode, message)
        }
        return try HalaAPI.decoder.decode(T.self, from: data)
    }

    private func get<T: Decodable>(_ path: String, _ query: [String: String] = [:], as type: T.Type, timeout: TimeInterval = 15) async throws -> T {
        var req = URLRequest(url: try url(path, query))
        req.timeoutInterval = timeout
        return try await send(req, as: type)
    }

    private func post<T: Decodable>(_ path: String, _ body: [String: Any], headers: [String: String] = [:], as type: T.Type, timeout: TimeInterval = 15) async throws -> T {
        var req = URLRequest(url: try url(path))
        req.httpMethod = "POST"
        req.timeoutInterval = timeout
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await send(req, as: type)
    }

    private struct Ok: Decodable { let ok: Bool? }

    // MARK: Calls

    /// Short-lived WebRTC token for the phone agent. The ElevenLabs key never leaves the server.
    func voiceToken() async throws -> String {
        try await get("/api/token", ["channel": "phone"], as: TokenResponse.self).token
    }

    func bindCall(phone: String, conversationId: String) async {
        _ = try? await post("/api/phone/calls", ["phone": phone, "conversation_id": conversationId], as: Ok.self)
    }

    func ackRing(id: String, phone: String, status: String) async {
        _ = try? await post("/api/phone/ring/\(id)", ["phone": phone, "status": status], as: Ok.self)
    }

    /// One-tap demo: HALA calls this phone. `reminder` books an appointment if there is none and rings about it.
    func demoCall(phone: String, kind: String) async throws {
        _ = try await post("/api/phone/demo", ["phone": phone, "kind": kind], as: Ok.self, timeout: 40)
    }

    // MARK: Texts

    func sendText(from phone: String, body: String, voice: Bool) async throws -> SmsResponse {
        try await post("/api/phone/sms", ["from": phone, "body": body, "voice": voice], as: SmsResponse.self, timeout: 75)
    }

    func inbox(phone: String, since: Int) async throws -> InboxResponse {
        try await get("/api/phone/inbox", ["phone": phone, "since": String(since)], as: InboxResponse.self, timeout: 10)
    }

    func setProfile(phone: String, name: String, language: String) async {
        _ = try? await post("/api/phone/profile", ["phone": phone, "name": name, "language": language], as: Ok.self)
    }

    struct Status: Decodable {
        let ok: Bool
        let store: String?
        let hackClubAi: Bool?
        let missing: [String]?
    }

    /// What is ready on the server. Nil when the address does not answer like a HALA server.
    func status() async -> Status? {
        try? await get("/api/phone/status", as: Status.self, timeout: 8)
    }
}
