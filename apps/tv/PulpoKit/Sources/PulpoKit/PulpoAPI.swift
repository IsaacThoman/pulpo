import Foundation

/// The Pulpo endpoints the TV app uses. Every method throws ``APIError``.
public struct PulpoAPI: Sendable {
    public let http: HTTPClient

    public init(_ http: HTTPClient) {
        self.http = http
    }

    public var server: ServerAddress { http.server }

    // MARK: Session

    public func instanceConfig() async throws -> InstanceConfig {
        try await http.get("/api/mobile/config")
    }

    public struct LoginRequest: Encodable, Sendable {
        public let email: String
        public let password: String
        public let twoFactorCode: String?
        public let deviceLabel: String
        // The server has no tvOS app type; TV sessions are listed with the
        // other native Apple clients under their device name.
        public let appType = "mobile"
        public let platform = "ios"

        public init(email: String, password: String, twoFactorCode: String?, deviceLabel: String) {
            self.email = email
            self.password = password
            self.twoFactorCode = twoFactorCode
            self.deviceLabel = deviceLabel
        }
    }

    public func login(_ request: LoginRequest) async throws -> NativeAuthResponse {
        try await http.send(.post, "/api/mobile/auth/login", body: request)
    }

    /// The signed-in user. Unlike `/api/me`, this succeeds for pending accounts.
    public func currentUser() async throws -> User {
        let envelope: UserEnvelope = try await http.get("/api/mobile/me")
        return envelope.user
    }

    public func logout() async throws {
        try await http.request(.post, "/api/mobile/auth/logout")
    }

    // MARK: Library

    public func chats() async throws -> [ChatSummary] {
        let envelope: DataEnvelope<ChatSummary> = try await http.get("/api/chats")
        return envelope.data
    }

    public func searchChats(_ query: String) async throws -> [ChatSummary] {
        let trimmed = String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !trimmed.isEmpty else { return [] }
        let envelope: DataEnvelope<ChatSummary> = try await http.get(
            "/api/chats/search", query: [URLQueryItem(name: "q", value: trimmed)]
        )
        return envelope.data
    }

    public func folders() async throws -> [Folder] {
        let envelope: DataEnvelope<Folder> = try await http.get("/api/folders")
        return envelope.data
    }

    public func models() async throws -> [AIModel] {
        let catalog: ModelCatalog = try await http.get("/api/models")
        return catalog.data
    }

    public func settings() async throws -> AccountSettings {
        try await http.get("/api/settings")
    }

    /// Makes `modelId` the account's default for new chats on every device.
    public func setDefaultModel(_ modelId: String) async throws {
        struct Patch: Encodable { let defaultModelId: String }
        try await http.request(.patch, "/api/settings", body: try JSONEncoder.pulpo.encode(Patch(defaultModelId: modelId)))
    }

    public func suggestedPrompts() async throws -> [SuggestedPrompt] {
        let response: SuggestedPromptsResponse = try await http.get("/api/interface/suggested-prompts")
        return response.enabled == false ? [] : response.prompts
    }

    // MARK: Chats

    public func chat(_ id: String) async throws -> ChatDetail {
        try await http.get(
            "/api/chats/\(Self.segment(id))",
            query: [URLQueryItem(name: "format", value: "compact"), URLQueryItem(name: "scope", value: "active")]
        )
    }

    public struct ChatPatch: Encodable, Sendable {
        public var title: String?
        public var pinned: Bool?
        public var modelId: String?

        public init(title: String? = nil, pinned: Bool? = nil, modelId: String? = nil) {
            self.title = title
            self.pinned = pinned
            self.modelId = modelId
        }
    }

    @discardableResult
    public func updateChat(_ id: String, _ patch: ChatPatch) async throws -> ChatSummary {
        try await http.send(.patch, "/api/chats/\(Self.segment(id))", body: patch)
    }

    public func deleteChat(_ id: String) async throws {
        try await http.request(.delete, "/api/chats/\(Self.segment(id))")
    }

    // MARK: Generation

    public struct NewResponse: Encodable, Sendable {
        public let clientId: String
        public let input: String
        public let modelId: String
        public let timeZone: String
        public let presetSelections: [String: String]
        public let attachmentIds: [String]

        public init(clientId: String, input: String, modelId: String, timeZone: String = TimeZone.current.identifier) {
            self.clientId = clientId
            self.input = input
            self.modelId = modelId
            self.timeZone = timeZone
            self.presetSelections = [:]
            self.attachmentIds = []
        }
    }

    public struct StartChat: Encodable, Sendable {
        public struct Chat: Encodable, Sendable {
            public let clientId: String
            public let modelId: String
            public let title: String
        }

        public let chat: Chat
        public let response: NewResponse

        public init(chatId: String, title: String, response: NewResponse) {
            // The server replaces this placeholder with a generated title.
            let placeholder = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
            chat = Chat(clientId: chatId, modelId: response.modelId, title: placeholder.isEmpty ? "New chat" : placeholder)
            self.response = response
        }
    }

    public struct StartedChat: Decodable, Sendable {
        public let chat: ChatSummary
        public let response: ResponseSnapshot
    }

    struct ResponseEnvelope: Decodable, Sendable {
        let response: ResponseSnapshot
    }

    /// Creates a chat and its first message. The response's `clientId` doubles
    /// as the idempotency key, so a retried request never sends twice.
    public func startChat(_ request: StartChat) async throws -> StartedChat {
        try await http.send(.post, "/api/chats/start", body: request, idempotencyKey: request.response.clientId)
    }

    /// Sends a follow-up on the chat's active branch.
    public func respond(in chatId: String, _ request: NewResponse) async throws -> ResponseSnapshot {
        let envelope: ResponseEnvelope = try await http.send(
            .post, "/api/chats/\(Self.segment(chatId))/responses", body: request, idempotencyKey: request.clientId
        )
        return envelope.response
    }

    public struct Regenerate: Encodable, Sendable {
        public let clientId: String
        public let modelId: String?
        public let timeZone: String

        public init(clientId: String, modelId: String?, timeZone: String = TimeZone.current.identifier) {
            self.clientId = clientId
            self.modelId = modelId
            self.timeZone = timeZone
        }
    }

    public func regenerate(_ responseId: String, _ request: Regenerate) async throws -> ResponseSnapshot {
        let envelope: ResponseEnvelope = try await http.send(
            .post, "/api/messages/\(Self.segment(responseId))/regenerate", body: request, idempotencyKey: request.clientId
        )
        return envelope.response
    }

    public struct EditMessage: Encodable, Sendable {
        public let content: String
        public let clientId: String
        public let modelId: String?
        public let timeZone: String

        public init(content: String, clientId: String, modelId: String?, timeZone: String = TimeZone.current.identifier) {
            self.content = content
            self.clientId = clientId
            self.modelId = modelId
            self.timeZone = timeZone
        }
    }

    /// Replaces the user's message in `responseId` with new text, as a new
    /// version beside the original, and generates a reply to it.
    public func editMessage(_ responseId: String, _ request: EditMessage) async throws -> ResponseSnapshot {
        let envelope: ResponseEnvelope = try await http.send(
            .patch, "/api/messages/\(Self.segment(responseId)):input", body: request, idempotencyKey: request.clientId
        )
        return envelope.response
    }

    public func cancel(_ responseId: String) async throws -> ResponseSnapshot {
        let data = try await http.request(.post, "/api/responses/\(Self.segment(responseId))/cancel")
        do {
            return try JSONDecoder.pulpo.decode(ResponseSnapshot.self, from: data)
        } catch {
            throw APIError.invalidResponse
        }
    }

    /// Switches the chat to the branch ending at `responseId`'s newest descendant.
    public func activate(_ responseId: String) async throws {
        try await http.request(.post, "/api/messages/\(Self.segment(responseId))/activate")
    }

    // MARK: Files

    public func attachmentThumbnailURL(_ id: String) -> URL {
        server.endpoint("/api/attachments/\(Self.segment(id))/thumbnail")
    }

    struct DownloadLink: Decodable, Sendable {
        let url: String
    }

    /// Fetches an attachment's bytes through its short-lived download link.
    public func attachmentData(_ id: String) async throws -> Data {
        let link: DownloadLink = try await http.get("/api/attachments/\(Self.segment(id))/download")
        guard let url = URL(string: link.url, relativeTo: server.url)?.absoluteURL else { throw APIError.invalidResponse }
        return try await http.download(url)
    }

    public func thumbnailData(_ id: String) async throws -> Data {
        try await http.download(attachmentThumbnailURL(id))
    }

    /// Percent-encodes an identifier for use as one path segment.
    static func segment(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~:"))) ?? id
    }
}
