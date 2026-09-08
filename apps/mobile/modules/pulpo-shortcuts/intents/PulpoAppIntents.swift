import AppIntents
import Foundation
internal import PulpoShortcuts

struct PulpoModelEntity: AppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Pulpo Model")
  static let defaultQuery = PulpoModelQuery()
  var id: String
  @Property(title: "Name") var name: String
  @Property(title: "Provider") var provider: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)", subtitle: "\(provider)") }
  init(_ model: ShortcutModel, session: ShortcutSession) {
    id = session.entityID(model.id); name = model.name; provider = model.provider.name
  }
}
struct PulpoModelQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [PulpoModelEntity] {
    let api = try ShortcutsAPI.current(access: .basicAutomation)
    for id in identifiers { _ = try api.session.resourceID(id) }
    let models = try await api.models().map { PulpoModelEntity($0, session: api.session) }
    return identifiers.compactMap { id in models.first { $0.id == id } }
  }
  func suggestedEntities() async throws -> [PulpoModelEntity] {
    let api = try ShortcutsAPI.current(access: .basicAutomation)
    return try await api.models().map { PulpoModelEntity($0, session: api.session) }
  }
  func entities(matching string: String) async throws -> [PulpoModelEntity] {
    try await suggestedEntities().filter { $0.name.localizedCaseInsensitiveContains(string) || $0.provider.localizedCaseInsensitiveContains(string) }
  }
}

struct PulpoChatEntity: AppEntity {
  static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Pulpo Chat")
  static let defaultQuery = PulpoChatQuery()
  var id: String
  @Property(title: "Title") var title: String
  var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)", image: .init(systemName: "bubble.left.and.bubble.right")) }
  init(_ chat: ShortcutChat, session: ShortcutSession) { id = session.entityID(chat.id); title = chat.title }
}
struct PulpoChatQuery: EntityStringQuery {
  func entities(for identifiers: [String]) async throws -> [PulpoChatEntity] {
    let api = try ShortcutsAPI.current()
    var result: [PulpoChatEntity] = []
    for id in identifiers { result.append(PulpoChatEntity(try await api.chat(id), session: api.session)) }
    return result
  }
  func suggestedEntities() async throws -> [PulpoChatEntity] {
    let api = try ShortcutsAPI.current()
    return try await api.chats().map { PulpoChatEntity($0, session: api.session) }
  }
  func entities(matching string: String) async throws -> [PulpoChatEntity] {
    let api = try ShortcutsAPI.current()
    return try await api.chats(query: string, limit: 50).map { PulpoChatEntity($0, session: api.session) }
  }
}

struct AskPulpoIntent: AppIntent {
  static let title: LocalizedStringResource = "Ask Pulpo"
  static let description = IntentDescription("Send a prompt to a selected model and return the text reply. Uses your signed-in Pulpo account and normal model billing. For slow models, use Start Chat followed later by Get Reply. Works while locked after the first unlock following a restart. Agent Mode requires an unlocked device. Requires an internet connection.", categoryName: "Chat", resultValueName: "Reply")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  @Parameter(title: "Prompt", description: "Text from typing, dictation, the clipboard, a share sheet, or a previous action.", inputOptions: String.IntentInputOptions(multiline: true)) var prompt: String
  @Parameter(title: "Model") var model: PulpoModelEntity
  @Parameter(title: "Temporary Chat", description: "Exclude this conversation from saved history, search, and recall. The server's temporary-chat expiration still applies.", default: false) var temporary: Bool
  @Parameter(title: "Agent Mode", description: "Use agent tools when supported by your server and model. Agent tasks can take longer; use Start Chat and Open Chat for long-running work.", default: false) var agentMode: Bool
  static var parameterSummary: some ParameterSummary { Summary("Ask \(\.$model) about \(\.$prompt)") { \.$temporary; \.$agentMode } }
  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let api = try ShortcutsAPI.current(access: agentMode ? .unlocked : .basicAutomation)
    let (_, snapshot) = try await api.start(prompt: prompt, modelEntityID: model.id, temporary: temporary, agentMode: agentMode)
    let reply = try await api.waitForReply(snapshot)
    return .result(value: reply, dialog: "\(reply)")
  }
}

struct StartPulpoChatIntent: AppIntent {
  static let title: LocalizedStringResource = "Start Chat in Pulpo"
  static let description = IntentDescription("Send a prompt and immediately return the new saved chat, while its reply continues on the server. Connect this to Open Chat, or use Get Reply later. Uses normal model billing. Works while locked after the first unlock following a restart. Agent Mode requires an unlocked device.", categoryName: "Chat", resultValueName: "Chat")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  @Parameter(title: "Prompt", inputOptions: String.IntentInputOptions(multiline: true)) var prompt: String
  @Parameter(title: "Model") var model: PulpoModelEntity
  @Parameter(title: "Agent Mode", description: "Use agent tools when supported by your server and model. Agent tasks can take longer; use Start Chat and Open Chat for long-running work.", default: false) var agentMode: Bool
  static var parameterSummary: some ParameterSummary { Summary("Start a chat with \(\.$model) about \(\.$prompt)") { \.$agentMode } }
  func perform() async throws -> some IntentResult & ReturnsValue<PulpoChatEntity> {
    let api = try ShortcutsAPI.current(access: agentMode ? .unlocked : .basicAutomation)
    let (chat, _) = try await api.start(prompt: prompt, modelEntityID: model.id, agentMode: agentMode)
    return .result(value: PulpoChatEntity(chat, session: api.session))
  }
}

struct ContinuePulpoChatIntent: AppIntent {
  static let title: LocalizedStringResource = "Continue Chat in Pulpo"
  static let description = IntentDescription("Send a follow-up on the chat's active branch using its model and return the text reply. Wait for existing replies and queued messages to finish first. Uses normal model billing.", categoryName: "Chat", resultValueName: "Reply")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Chat") var chat: PulpoChatEntity
  @Parameter(title: "Prompt", inputOptions: String.IntentInputOptions(multiline: true)) var prompt: String
  @Parameter(title: "Agent Mode", description: "Use agent tools when supported by your server and model. Agent tasks can take longer; use Start Chat and Open Chat for long-running work.", default: false) var agentMode: Bool
  static var parameterSummary: some ParameterSummary { Summary("Send \(\.$prompt) to \(\.$chat)") { \.$agentMode } }
  func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
    let api = try ShortcutsAPI.current()
    let snapshot = try await api.continueChat(chat.id, prompt: prompt, agentMode: agentMode)
    let reply = try await api.waitForReply(snapshot)
    return .result(value: reply, dialog: "\(reply)")
  }
}

struct GetPulpoReplyIntent: AppIntent {
  static let title: LocalizedStringResource = "Get Reply from Pulpo"
  static let description = IntentDescription("Return the completed text reply on a chat's active branch. Does not send a prompt. If the reply is still running, try again later.", categoryName: "Chat", resultValueName: "Reply")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Chat") var chat: PulpoChatEntity
  static var parameterSummary: some ParameterSummary { Summary("Get the reply from \(\.$chat)") }
  func perform() async throws -> some IntentResult & ReturnsValue<String> {
    .result(value: try await ShortcutsAPI.current().latestReply(chat.id))
  }
}

struct FindPulpoChatsIntent: AppIntent {
  static let title: LocalizedStringResource = "Find Chats in Pulpo"
  static let description = IntentDescription("Search saved chat titles and contents on your current server. Leave Search empty for recent chats. Temporary and deleted chats are excluded.", categoryName: "Find", resultValueName: "Chats")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Search", default: "") var search: String
  @Parameter(title: "Limit", default: 20, inclusiveRange: (1, 50)) var limit: Int
  static var parameterSummary: some ParameterSummary { Summary("Find chats matching \(\.$search)") { \.$limit } }
  func perform() async throws -> some IntentResult & ReturnsValue<[PulpoChatEntity]> {
    let api = try ShortcutsAPI.current()
    return .result(value: try await api.chats(query: search, limit: limit).map { PulpoChatEntity($0, session: api.session) })
  }
}

struct GetPulpoModelsIntent: AppIntent {
  static let title: LocalizedStringResource = "Get Models from Pulpo"
  static let description = IntentDescription("Return the models available to your signed-in account. Use Choose from List to select a model for Ask Pulpo or Start Chat.", categoryName: "Find", resultValueName: "Models")
  static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed
  func perform() async throws -> some IntentResult & ReturnsValue<[PulpoModelEntity]> {
    .result(value: try await PulpoModelQuery().suggestedEntities())
  }
}

struct OpenPulpoChatIntent: AppIntent {
  static let supportedModes: IntentModes = .foreground(.immediate)
  static let title: LocalizedStringResource = "Open Chat in Pulpo"
  static let description = IntentDescription("Open a saved chat in Pulpo without sending a message.", categoryName: "Open")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Chat") var chat: PulpoChatEntity
  static var parameterSummary: some ParameterSummary { Summary("Open \(\.$chat)") }
  @MainActor func perform() async throws -> some IntentResult {
    let api = try ShortcutsAPI.current()
    let selected = try await api.chat(chat.id)
    var url = URLComponents(string: "pulpo://shortcuts")!
    url.queryItems = [URLQueryItem(name: "action", value: "open-chat"), URLQueryItem(name: "scope", value: api.session.scope), URLQueryItem(name: "chatId", value: selected.id), URLQueryItem(name: "requestId", value: UUID().uuidString)]
    ShortcutNavigationInbox.enqueue(url.url!.absoluteString)
    return .result()
  }
}

struct NewPulpoChatIntent: AppIntent {
  static let supportedModes: IntentModes = .foreground(.immediate)
  static let title: LocalizedStringResource = "New Chat in Pulpo"
  static let description = IntentDescription("Open the new-chat composer. Existing drafts are preserved. Nothing is sent until you tap Send.", categoryName: "Open")
  static let authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication
  @Parameter(title: "Temporary Chat", default: false) var temporary: Bool
  static var parameterSummary: some ParameterSummary { Summary("Open a new Pulpo chat") { \.$temporary } }
  @MainActor func perform() async throws -> some IntentResult {
    let session = try ShortcutSessionStore.load()
    var url = URLComponents(string: "pulpo://shortcuts")!
    url.queryItems = [URLQueryItem(name: "action", value: temporary ? "temporary-chat" : "new-chat"), URLQueryItem(name: "scope", value: session.scope), URLQueryItem(name: "requestId", value: UUID().uuidString)]
    ShortcutNavigationInbox.enqueue(url.url!.absoluteString)
    return .result()
  }
}

struct PulpoAppShortcuts: AppShortcutsProvider {
  static let shortcutTileColor: ShortcutTileColor = .teal
  static var appShortcuts: [AppShortcut] {
    AppShortcut(intent: AskPulpoIntent(), phrases: ["Ask \(.applicationName)"], shortTitle: "Ask Pulpo", systemImageName: "bubble.left.and.text.bubble.right")
    AppShortcut(intent: NewPulpoChatIntent(), phrases: ["New chat in \(.applicationName)"], shortTitle: "New Chat", systemImageName: "square.and.pencil")
    AppShortcut(intent: FindPulpoChatsIntent(), phrases: ["Find chats in \(.applicationName)"], shortTitle: "Find Chats", systemImageName: "magnifyingglass")
    AppShortcut(intent: OpenPulpoChatIntent(), phrases: ["Open a chat in \(.applicationName)"], shortTitle: "Open Chat", systemImageName: "bubble.left.and.bubble.right")
  }
}
