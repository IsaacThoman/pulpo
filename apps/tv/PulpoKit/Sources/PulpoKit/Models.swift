import Foundation

// Swift mirrors of the `@pulpo/contracts` schemas the TV app uses. Fields that
// older servers may omit are optional so a self-hosted instance one release
// behind still decodes.

public struct User: Codable, Hashable, Sendable, Identifiable {
    public enum Role: String, Codable, Sendable {
        case pending, user, admin
    }

    public let id: String
    public var email: String
    public var name: String
    public var username: String
    public var profileColor: String?
    public var role: Role
    public var createdAt: Date?

    public init(
        id: String, email: String, name: String, username: String,
        profileColor: String? = nil, role: Role = .user, createdAt: Date? = nil
    ) {
        self.id = id
        self.email = email
        self.name = name
        self.username = username
        self.profileColor = profileColor
        self.role = role
        self.createdAt = createdAt
    }

    /// The first name, for greetings.
    public var firstName: String {
        name.split(separator: " ").first.map(String.init) ?? name
    }

    /// One or two initials for an avatar.
    public var initials: String {
        let words = name.split(whereSeparator: { $0.isWhitespace }).prefix(2)
        let letters = words.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? String(username.prefix(1)).uppercased() : letters
    }
}

public struct NativeSession: Codable, Hashable, Sendable {
    public let token: String
    public let expiresAt: Date?

    public init(token: String, expiresAt: Date?) {
        self.token = token
        self.expiresAt = expiresAt
    }
}

public struct NativeAuthResponse: Codable, Sendable {
    public let user: User
    public let session: NativeSession

    public init(user: User, session: NativeSession) {
        self.user = user
        self.session = session
    }
}

struct UserEnvelope: Codable, Sendable {
    let user: User
}

/// `GET /api/mobile/config`: public instance information read before sign-in.
public struct InstanceConfig: Codable, Hashable, Sendable {
    public struct Instance: Codable, Hashable, Sendable {
        public let name: String
        public let version: String?
        public let publicUrl: String?
    }

    public struct Auth: Codable, Hashable, Sendable {
        public let signupEnabled: Bool?
        public let pendingMessage: String?
        public let adminEmail: String?
    }

    public let instance: Instance
    public let setupRequired: Bool?
    public let auth: Auth?
}

/// A response's lifecycle state. Unknown future states decode rather than fail.
public struct ResponseStatus: RawRepresentable, Codable, Hashable, Sendable, CustomStringConvertible {
    public let rawValue: String
    public init(rawValue: String) { self.rawValue = rawValue }

    public static let queued = ResponseStatus(rawValue: "queued")
    public static let inProgress = ResponseStatus(rawValue: "in_progress")
    public static let completed = ResponseStatus(rawValue: "completed")
    public static let failed = ResponseStatus(rawValue: "failed")
    public static let cancelled = ResponseStatus(rawValue: "cancelled")
    public static let incomplete = ResponseStatus(rawValue: "incomplete")

    public var isActive: Bool { self == .queued || self == .inProgress }
    public var isTerminal: Bool { !isActive }
    public var description: String { rawValue }

    public init(from decoder: Decoder) throws {
        rawValue = try decoder.singleValueContainer().decode(String.self)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

public struct ResponseUsage: Codable, Hashable, Sendable {
    public let inputTokens: Int
    public let outputTokens: Int
    public let reasoningTokens: Int?
    public let totalTokens: Int
}

/// The authoritative state of one generation. `output` stays untyped JSON so
/// the event reducer can merge items exactly as the TypeScript clients do;
/// ``ResponseContent`` projects it for display.
public struct ResponseSnapshot: Codable, Hashable, Sendable {
    public var responseId: String
    public var status: ResponseStatus
    public var sequence: Int
    public var output: [JSONValue]
    public var usage: ResponseUsage?
    public var error: JSONValue?
    /// Kept as the server's ISO string; equal-sequence merges compare it exactly.
    public var updatedAt: String
    public var requestReceivedAt: String?
    public var firstReplyTextAt: String?

    public init(
        responseId: String, status: ResponseStatus, sequence: Int, output: [JSONValue] = [],
        usage: ResponseUsage? = nil, error: JSONValue? = nil, updatedAt: String,
        requestReceivedAt: String? = nil, firstReplyTextAt: String? = nil
    ) {
        self.responseId = responseId
        self.status = status
        self.sequence = sequence
        self.output = output
        self.usage = usage
        self.error = error
        self.updatedAt = updatedAt
        self.requestReceivedAt = requestReceivedAt
        self.firstReplyTextAt = firstReplyTextAt
    }

    /// The placeholder recorded before a send so events that beat the HTTP
    /// acknowledgement are not lost.
    public static func queued(_ responseId: String, at date: Date = Date()) -> ResponseSnapshot {
        ResponseSnapshot(responseId: responseId, status: .queued, sequence: 0, updatedAt: PulpoDate.format(date))
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        responseId = try container.decode(String.self, forKey: .responseId)
        status = try container.decode(ResponseStatus.self, forKey: .status)
        sequence = try container.decodeIfPresent(Int.self, forKey: .sequence) ?? 0
        output = try container.decodeIfPresent([JSONValue].self, forKey: .output) ?? []
        usage = try? container.decodeIfPresent(ResponseUsage.self, forKey: .usage)
        error = try container.decodeIfPresent(JSONValue.self, forKey: .error)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt) ?? ""
        requestReceivedAt = try container.decodeIfPresent(String.self, forKey: .requestReceivedAt)
        firstReplyTextAt = try container.decodeIfPresent(String.self, forKey: .firstReplyTextAt)
    }

    public var errorMessage: String? {
        guard let error, error != .null else { return nil }
        return error["message"]?.stringValue ?? "The response couldn’t be completed."
    }
}

public struct ResponseEvent: Codable, Hashable, Sendable {
    public let responseId: String
    public let sequence: Int
    public let type: String
    public let payload: JSONValue
    public let emittedAt: String
    public let requestReceivedAt: String?
    public let firstReplyTextAt: String?

    public init(
        responseId: String, sequence: Int, type: String, payload: JSONValue, emittedAt: String,
        requestReceivedAt: String? = nil, firstReplyTextAt: String? = nil
    ) {
        self.responseId = responseId
        self.sequence = sequence
        self.type = type
        self.payload = payload
        self.emittedAt = emittedAt
        self.requestReceivedAt = requestReceivedAt
        self.firstReplyTextAt = firstReplyTextAt
    }
}

/// One row of `GET /api/chats` or `GET /api/chats/search`.
public struct ChatSummary: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public var title: String
    public var modelId: String
    public var pinned: Bool
    public var folderId: String?
    public var sortOrder: Int
    public var temporary: Bool
    public var activeResponseId: String?
    public var activeBranchLeafId: String?
    public var createdAt: Date
    public var updatedAt: Date
    /// Responses still generating. Search results omit it.
    public var inFlightResponseIds: [String]

    public init(
        id: String, title: String, modelId: String, pinned: Bool = false, folderId: String? = nil,
        sortOrder: Int = 0, temporary: Bool = false, activeResponseId: String? = nil,
        activeBranchLeafId: String? = nil, createdAt: Date, updatedAt: Date, inFlightResponseIds: [String] = []
    ) {
        self.id = id
        self.title = title
        self.modelId = modelId
        self.pinned = pinned
        self.folderId = folderId
        self.sortOrder = sortOrder
        self.temporary = temporary
        self.activeResponseId = activeResponseId
        self.activeBranchLeafId = activeBranchLeafId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.inFlightResponseIds = inFlightResponseIds
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "New chat"
        modelId = try container.decodeIfPresent(String.self, forKey: .modelId) ?? ""
        pinned = try container.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        folderId = try container.decodeIfPresent(String.self, forKey: .folderId)
        sortOrder = try container.decodeIfPresent(Int.self, forKey: .sortOrder) ?? 0
        temporary = try container.decodeIfPresent(Bool.self, forKey: .temporary) ?? false
        activeResponseId = try container.decodeIfPresent(String.self, forKey: .activeResponseId)
        activeBranchLeafId = try container.decodeIfPresent(String.self, forKey: .activeBranchLeafId)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
        inFlightResponseIds = try container.decodeIfPresent([String].self, forKey: .inFlightResponseIds) ?? []
    }

    public var isGenerating: Bool { !inFlightResponseIds.isEmpty }
}

public struct Folder: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public var name: String
    public var pinned: Bool?
    public var sortOrder: Int?

    public init(id: String, name: String, pinned: Bool? = nil, sortOrder: Int? = nil) {
        self.id = id
        self.name = name
        self.pinned = pinned
        self.sortOrder = sortOrder
    }
}

public struct AttachmentSummary: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let originalName: String
    public let mimeType: String
    public let sizeBytes: Int?

    public var isImage: Bool { mimeType.hasPrefix("image/") }
}

/// Sibling navigation for a turn ("2 of 3").
public struct BranchSet: Codable, Hashable, Sendable {
    public struct Side: Codable, Hashable, Sendable {
        public let ids: [String]
        public let index: Int

        public init(ids: [String], index: Int) {
            self.ids = ids
            self.index = index
        }
    }

    public let user: Side?
    public let assistant: Side?

    public init(user: Side?, assistant: Side?) {
        self.user = user
        self.assistant = assistant
    }
}

/// One turn of a conversation: the user's message (`input`) and the
/// assistant's reply (`output`).
public struct ChatResponse: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public var parentResponseId: String?
    public var userMessageId: String?
    public var modelId: String
    public var displayModelId: String?
    public var status: ResponseStatus
    public var input: [JSONValue]
    public var output: [JSONValue]
    public var usage: ResponseUsage?
    public var error: JSONValue?
    public var createdAt: Date
    public var completedAt: Date?
    public var agentMode: Bool
    public var snapshot: ResponseSnapshot?
    public var branches: BranchSet?
    public var detailAvailable: Bool

    public init(
        id: String, parentResponseId: String?, modelId: String, status: ResponseStatus,
        input: [JSONValue], output: [JSONValue] = [], createdAt: Date, snapshot: ResponseSnapshot? = nil
    ) {
        self.id = id
        self.parentResponseId = parentResponseId
        self.userMessageId = nil
        self.modelId = modelId
        self.displayModelId = modelId
        self.status = status
        self.input = input
        self.output = output
        self.usage = nil
        self.error = nil
        self.createdAt = createdAt
        self.completedAt = nil
        self.agentMode = false
        self.snapshot = snapshot
        self.branches = nil
        self.detailAvailable = true
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        parentResponseId = try container.decodeIfPresent(String.self, forKey: .parentResponseId)
        userMessageId = try container.decodeIfPresent(String.self, forKey: .userMessageId)
        modelId = try container.decodeIfPresent(String.self, forKey: .modelId) ?? ""
        displayModelId = try container.decodeIfPresent(String.self, forKey: .displayModelId)
        status = try container.decodeIfPresent(ResponseStatus.self, forKey: .status) ?? .completed
        input = Self.items(try container.decodeIfPresent(JSONValue.self, forKey: .input))
        output = Self.items(try container.decodeIfPresent(JSONValue.self, forKey: .output))
        usage = try? container.decodeIfPresent(ResponseUsage.self, forKey: .usage)
        error = try container.decodeIfPresent(JSONValue.self, forKey: .error)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        completedAt = try container.decodeIfPresent(Date.self, forKey: .completedAt)
        agentMode = try container.decodeIfPresent(Bool.self, forKey: .agentMode) ?? false
        snapshot = try? container.decodeIfPresent(ResponseSnapshot.self, forKey: .snapshot)
        branches = try? container.decodeIfPresent(BranchSet.self, forKey: .branches)
        detailAvailable = try container.decodeIfPresent(Bool.self, forKey: .detailAvailable) ?? true
    }

    /// Imported chats may store `input` as a bare string.
    private static func items(_ value: JSONValue?) -> [JSONValue] {
        switch value {
        case .array(let items): return items
        case .string(let text): return [.object(["role": .string("user"), "content": .string(text)])]
        default: return []
        }
    }

    /// The model to show for this turn.
    public var shownModelId: String { displayModelId ?? modelId }

    /// The snapshot the realtime reducer continues from. Compact history embeds
    /// the snapshot without output; the turn's own output fills it back in.
    public var liveSnapshot: ResponseSnapshot {
        if var snapshot {
            if snapshot.output.isEmpty { snapshot.output = output }
            return snapshot
        }
        return ResponseSnapshot(
            responseId: id, status: status, sequence: 0, output: output, usage: usage, error: error,
            updatedAt: PulpoDate.format(completedAt ?? createdAt)
        )
    }
}

/// `GET /api/chats/:id`.
public struct ChatDetail: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public var title: String
    public var modelId: String
    public var pinned: Bool
    public var folderId: String?
    public var temporary: Bool
    public var activeResponseId: String?
    public var activeBranchLeafId: String?
    public var createdAt: Date
    public var updatedAt: Date
    public var deletedAt: Date?
    public var attachments: [AttachmentSummary]
    public var responses: [ChatResponse]

    public init(
        id: String, title: String, modelId: String, pinned: Bool = false, folderId: String? = nil,
        temporary: Bool = false, activeResponseId: String? = nil, activeBranchLeafId: String? = nil,
        createdAt: Date, updatedAt: Date, attachments: [AttachmentSummary] = [], responses: [ChatResponse] = []
    ) {
        self.id = id
        self.title = title
        self.modelId = modelId
        self.pinned = pinned
        self.folderId = folderId
        self.temporary = temporary
        self.activeResponseId = activeResponseId
        self.activeBranchLeafId = activeBranchLeafId
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.deletedAt = nil
        self.attachments = attachments
        self.responses = responses
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "New chat"
        modelId = try container.decodeIfPresent(String.self, forKey: .modelId) ?? ""
        pinned = try container.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
        folderId = try container.decodeIfPresent(String.self, forKey: .folderId)
        temporary = try container.decodeIfPresent(Bool.self, forKey: .temporary) ?? false
        activeResponseId = try container.decodeIfPresent(String.self, forKey: .activeResponseId)
        activeBranchLeafId = try container.decodeIfPresent(String.self, forKey: .activeBranchLeafId)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
        deletedAt = try container.decodeIfPresent(Date.self, forKey: .deletedAt)
        attachments = try container.decodeIfPresent([AttachmentSummary].self, forKey: .attachments) ?? []
        responses = try container.decodeIfPresent([ChatResponse].self, forKey: .responses) ?? []
    }

    public var summary: ChatSummary {
        ChatSummary(
            id: id, title: title, modelId: modelId, pinned: pinned, folderId: folderId, temporary: temporary,
            activeResponseId: activeResponseId, activeBranchLeafId: activeBranchLeafId,
            createdAt: createdAt, updatedAt: updatedAt,
            inFlightResponseIds: responses.filter { $0.status.isActive }.map(\.id)
        )
    }
}

/// A model from `GET /api/models`.
public struct AIModel: Codable, Hashable, Sendable, Identifiable {
    public struct Lab: Codable, Hashable, Sendable {
        public let id: String?
        public let name: String
        public let logo: String?

        public init(id: String?, name: String, logo: String?) {
            self.id = id
            self.name = name
            self.logo = logo
        }
    }

    public struct Provider: Codable, Hashable, Sendable {
        public let id: String?
        public let name: String

        public init(id: String?, name: String) {
            self.id = id
            self.name = name
        }
    }

    public let id: String
    public var name: String
    public var description: String?
    public var logo: String?
    public var tags: [String]
    public var lab: Lab?
    public var provider: Provider?

    public init(
        id: String, name: String, description: String? = nil, logo: String? = nil, tags: [String] = [],
        lab: Lab? = nil, provider: Provider? = nil
    ) {
        self.id = id
        self.name = name
        self.description = description
        self.logo = logo
        self.tags = tags
        self.lab = lab
        self.provider = provider
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        name = try container.decodeIfPresent(String.self, forKey: .name) ?? id
        description = try container.decodeIfPresent(String.self, forKey: .description)
        logo = try container.decodeIfPresent(String.self, forKey: .logo)
        tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
        lab = try? container.decodeIfPresent(Lab.self, forKey: .lab)
        provider = try? container.decodeIfPresent(Provider.self, forKey: .provider)
    }

    /// The logo key used to pick an icon: the model's own, else its lab's.
    public var logoKey: String? { logo ?? lab?.logo }

    /// "OpenAI · Pulpo Baby", or whichever parts are known.
    public var subtitle: String {
        [lab?.name, provider?.name].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

public struct ModelCatalog: Codable, Sendable {
    public let data: [AIModel]
}

/// The subset of `GET /api/settings` the TV app reads.
public struct AccountSettings: Sendable, Hashable {
    public var defaultModelId: String?
    public var favoriteModelIds: [String]
    public var chatSortMode: String
    public var showPromptSuggestions: Bool

    public init(
        defaultModelId: String? = nil, favoriteModelIds: [String] = [], chatSortMode: String = "default",
        showPromptSuggestions: Bool = true
    ) {
        self.defaultModelId = defaultModelId
        self.favoriteModelIds = favoriteModelIds
        self.chatSortMode = chatSortMode
        self.showPromptSuggestions = showPromptSuggestions
    }
}

extension AccountSettings: Decodable {
    private struct Envelope: Decodable {
        struct Values: Decodable {
            let defaultModelId: String?
            let favoriteModelIds: [String]?
            let chatSortMode: String?
            let showPromptSuggestions: Bool?
        }
        let values: Values
    }

    public init(from decoder: Decoder) throws {
        let values = try Envelope(from: decoder).values
        self.init(
            defaultModelId: values.defaultModelId,
            favoriteModelIds: values.favoriteModelIds ?? [],
            chatSortMode: values.chatSortMode ?? "default",
            showPromptSuggestions: values.showPromptSuggestions ?? true
        )
    }
}

public struct SuggestedPrompt: Codable, Hashable, Sendable, Identifiable {
    public let id: String
    public let label: String
    public let message: String
}

struct SuggestedPromptsResponse: Codable, Sendable {
    let enabled: Bool?
    let prompts: [SuggestedPrompt]
}

struct DataEnvelope<Item: Decodable & Sendable>: Decodable, Sendable {
    let data: [Item]
}
