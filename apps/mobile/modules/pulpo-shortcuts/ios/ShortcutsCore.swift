import Foundation
import Security
import CryptoKit

public struct ShortcutFailure: LocalizedError {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var errorDescription: String? { message }
}

// Foreground intents may execute before React Native installs its URL listener.
// Retain only navigation URLs in this process until the bridge consumes them.
public enum ShortcutNavigationInbox {
  public static let changed = Notification.Name("PulpoShortcutNavigationChanged")
  private static let lock = NSLock()
  private static var pending: [String] = []
  public static func enqueue(_ url: String) {
    lock.lock()
    if !pending.contains(url) { pending.append(url) }
    pending = Array(pending.suffix(16))
    lock.unlock()
    NotificationCenter.default.post(name: changed, object: nil)
  }
  public static func takePending() -> [String] {
    lock.lock(); defer { lock.unlock() }
    let urls = pending
    pending.removeAll()
    return urls
  }
}

public struct ShortcutSession: Codable, Equatable, Sendable {
  public let origin: String
  public let userID: String
  public let token: String
  public init(origin: String, userID: String, token: String) throws {
    guard let url = URL(string: origin), url.host != nil, url.user == nil, url.password == nil,
          url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else {
      throw ShortcutFailure("Open Pulpo and select a valid server.")
    }
    var allowed = url.scheme == "https"
    #if DEBUG
    allowed = allowed || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(url.host!))
    #endif
    guard allowed, !userID.isEmpty, !token.isEmpty else { throw ShortcutFailure("Open Pulpo and sign in again.") }
    self.origin = origin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    self.userID = userID
    self.token = token
  }
  public var scope: String {
    SHA256.hash(data: Data("\(origin)|\(userID)".utf8)).map { String(format: "%02x", $0) }.joined()
  }
  public func entityID(_ id: String) -> String { "\(scope):\(id)" }
  public func resourceID(_ entityID: String) throws -> String {
    let parts = entityID.split(separator: ":", maxSplits: 1)
    guard parts.count == 2, parts[0] == scope, !parts[1].isEmpty, parts[1].count <= 120 else {
      throw ShortcutFailure("This item belongs to another account or server. Open Pulpo, sign in to its account, and select the item again.")
    }
    return String(parts[1])
  }
}

// The app and intents run in the same application sandbox. Credentials never go
// into defaults, entities, URLs, or an App Group. Locking serializes JS sign-out
// with native credential reads; every network request revalidates its session.
public enum ShortcutSessionStore {
  private static let lock = NSLock()
  private static var unavailable = false
  private static let key: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "com.isaacthoman.pulpo.shortcuts",
    kSecAttrAccount as String: "active-session",
  ]
  public static var enabled: Bool { !UserDefaults.standard.bool(forKey: "pulpo.shortcuts.disabled") }
  public static func setEnabled(_ enabled: Bool) { UserDefaults.standard.set(!enabled, forKey: "pulpo.shortcuts.disabled") }
  public static func save(_ session: ShortcutSession?) throws {
    lock.lock(); defer { lock.unlock() }
    unavailable = true
    UserDefaults.standard.set(true, forKey: "pulpo.shortcuts.sessionUnavailable")
    if let session {
      let data = try JSONEncoder().encode(session)
      let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
      var status = SecItemUpdate(key as CFDictionary, attributes as CFDictionary)
      if status == errSecItemNotFound {
        status = SecItemAdd(key.merging(attributes) { _, new in new } as CFDictionary, nil)
      }
      guard status == errSecSuccess else { throw ShortcutFailure("Unlock your device and reopen Pulpo to enable Shortcuts.") }
    } else {
      let status = SecItemDelete(key as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw ShortcutFailure("Could not clear the Shortcuts session. Unlock your device and try again.") }
    }
    unavailable = false
    UserDefaults.standard.set(false, forKey: "pulpo.shortcuts.sessionUnavailable")
  }
  public static func load() throws -> ShortcutSession {
    lock.lock(); defer { lock.unlock() }
    guard enabled else { throw ShortcutFailure("Enable Apple Shortcuts in Pulpo Settings first.") }
    guard !unavailable, !UserDefaults.standard.bool(forKey: "pulpo.shortcuts.sessionUnavailable") else { throw ShortcutFailure("Open Pulpo and sign in again.") }
    var result: CFTypeRef?
    let query = key.merging([kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]) { _, new in new }
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data, let session = try? JSONDecoder().decode(ShortcutSession.self, from: data) else {
      throw ShortcutFailure("Unlock your device, open Pulpo, and sign in before running this shortcut.")
    }
    // Revalidate decoded origins, including the release-build HTTPS requirement.
    return try ShortcutSession(origin: session.origin, userID: session.userID, token: session.token)
  }
  public static func assertCurrent(_ session: ShortcutSession) throws {
    guard try load() == session else { throw ShortcutFailure("Your Pulpo account changed. Run the shortcut again.") }
  }
}

public struct ShortcutModel: Decodable, Sendable {
  public let id: String
  public let name: String
  public let provider: Provider
  public struct Provider: Decodable, Sendable { public let name: String }
}
public struct ShortcutChat: Decodable, Sendable {
  public let id: String
  public let title: String
  public let modelId: String
  public let temporary: Bool
  public let activeResponseId: String?
  public let activeBranchLeafId: String?
  public let responses: [Turn]?
  public let queuedMessages: [Queued]?
  public struct Turn: Decodable, Sendable { public let id: String; public let status: String }
  public struct Queued: Decodable, Sendable { public let id: String }
  public var busy: Bool { !(queuedMessages ?? []).isEmpty || (responses ?? []).contains { ["queued", "in_progress"].contains($0.status) } }
}
public struct ShortcutSnapshot: Decodable, Sendable {
  public let responseId: String
  public let status: String
  public let output: [Output]
  public let error: Failure?
  public struct Failure: Decodable, Sendable { public let message: String? }
  public struct Output: Decodable, Sendable {
    public let type: String
    public let content: [Part]?
    private enum CodingKeys: String, CodingKey { case type, content }
    public init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      type = try container.decode(String.self, forKey: .type)
      content = type == "message" ? try container.decodeIfPresent([Part].self, forKey: .content) : nil
    }
    public struct Part: Decodable, Sendable {
      public let type: String
      public let text: String?
      public let refusal: String?
    }
  }
  public func reply() throws -> String {
    guard status == "completed" else {
      if ["queued", "in_progress"].contains(status) { throw ShortcutFailure("The reply is still running. Use Get Reply later or open Pulpo.") }
      throw ShortcutFailure(error?.message ?? "The response \(status). Open Pulpo to review it.")
    }
    let text = output.filter { $0.type == "message" }.flatMap { $0.content ?? [] }.compactMap { part -> String? in
      switch part.type { case "output_text": return part.text; case "refusal": return part.refusal; default: return nil }
    }.joined(separator: "\n")
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw ShortcutFailure("This response has no text reply. Open Pulpo to view its output.") }
    return text
  }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

public final class ShortcutsAPI: Sendable {
  public let session: ShortcutSession
  private let transport: URLSession
  private let assertCurrent: @Sendable (ShortcutSession) throws -> Void
  public init(session: ShortcutSession, transport: URLSession? = nil, assertCurrent: @escaping @Sendable (ShortcutSession) throws -> Void = { try ShortcutSessionStore.assertCurrent($0) }) {
    self.session = session
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 20
    config.httpShouldSetCookies = false
    self.transport = transport ?? URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    self.assertCurrent = assertCurrent
  }
  deinit { transport.invalidateAndCancel() }
  public static func current() throws -> ShortcutsAPI { try ShortcutsAPI(session: ShortcutSessionStore.load()) }
  private struct List<T: Decodable>: Decodable { let data: [T] }
  private struct Response: Decodable { let response: ShortcutSnapshot }
  private struct Settings: Decodable {
    let values: Values
    struct Values: Decodable { let newChatAutoExpire: Bool? }
  }
  private struct Started: Decodable { let chat: ShortcutChat; let response: ShortcutSnapshot }
  private struct APIError: Decodable { let error: ShortcutSnapshot.Failure? }
  public func request<T: Decodable>(_ path: String, body: [String: Any]? = nil, idempotencyKey: String? = nil) async throws -> T {
    try Task.checkCancellation()
    try assertCurrent(session)
    guard path.hasPrefix("/api/"), let url = URL(string: session.origin + path) else { throw ShortcutFailure("Invalid Pulpo request.") }
    var request = URLRequest(url: url)
    request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if let body {
      request.httpMethod = "POST"
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
    }
    let data: Data
    let response: URLResponse
    do { (data, response) = try await transport.data(for: request) }
    catch {
      if body != nil, !Task.isCancelled {
        throw ShortcutFailure("The connection was interrupted. Your prompt may already be running in Pulpo. Check the app before sending it again.")
      }
      throw error
    }
    try assertCurrent(session)
    guard let http = response as? HTTPURLResponse else { throw ShortcutFailure("The Pulpo server returned an invalid response.") }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 401 { throw ShortcutFailure("Your Pulpo session expired. Open Pulpo and sign in again.") }
      if [404, 410].contains(http.statusCode) { throw ShortcutFailure("This chat or model is no longer available. Select another item in your shortcut.") }
      throw ShortcutFailure((try? JSONDecoder().decode(APIError.self, from: data).error?.message) ?? "Pulpo could not complete the request (\(http.statusCode)).")
    }
    return try JSONDecoder().decode(T.self, from: data)
  }
  public func models() async throws -> [ShortcutModel] {
    let result: List<ShortcutModel> = try await request("/api/models")
    return result.data
  }
  public func chats(query: String = "", limit: Int = 20) async throws -> [ShortcutChat] {
    let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
    var components = URLComponents()
    components.queryItems = [URLQueryItem(name: "q", value: String(trimmed.prefix(200)))]
    let encodedQuery = components.percentEncodedQuery!.replacingOccurrences(of: "+", with: "%2B")
    let path = trimmed.isEmpty ? "/api/chats" : "/api/chats/search?\(encodedQuery)"
    let result: List<ShortcutChat> = try await request(path)
    return Array(result.data.filter { !$0.temporary }.prefix(max(1, min(limit, 50))))
  }
  public func chat(_ entityID: String) async throws -> ShortcutChat {
    let id = try session.resourceID(entityID)
    guard UUID(uuidString: id) != nil else { throw ShortcutFailure("This chat is no longer available. Select another chat.") }
    let result: ShortcutChat = try await request("/api/chats/\(id)?format=compact&scope=active")
    guard !result.temporary else { throw ShortcutFailure("Temporary chats are not available as saved Shortcuts items.") }
    return result
  }
  public func start(prompt: String, modelEntityID: String, temporary: Bool = false) async throws -> (ShortcutChat, ShortcutSnapshot) {
    let text = try Self.prompt(prompt)
    let modelID = try session.resourceID(modelEntityID)
    guard try await models().contains(where: { $0.id == modelID }) else { throw ShortcutFailure("This model is no longer available. Select another model.") }
    let autoExpire: Bool
    if temporary { autoExpire = false }
    else {
      let settings: Settings = try await request("/api/settings")
      autoExpire = settings.values.newChatAutoExpire ?? false
    }
    let responseID = UUID().uuidString.lowercased()
    let result: Started = try await request("/api/chats/start", body: [
      "chat": ["clientId": UUID().uuidString.lowercased(), "modelId": modelID, "title": String(text.prefix(80)), "temporary": temporary, "autoExpire": autoExpire],
      "response": ["clientId": responseID, "input": text, "modelId": modelID, "parentResponseId": NSNull(), "agentMode": false, "attachmentIds": [], "presetSelections": [:]]
    ], idempotencyKey: responseID)
    return (result.chat, result.response)
  }
  public func continueChat(_ entityID: String, prompt: String) async throws -> ShortcutSnapshot {
    let text = try Self.prompt(prompt)
    let selected = try await chat(entityID)
    guard !selected.busy else { throw ShortcutFailure("This chat is still responding or has queued messages. Wait for it to finish before continuing.") }
    let responseID = UUID().uuidString.lowercased()
    let result: Response = try await request("/api/chats/\(selected.id)/responses", body: [
      "clientId": responseID, "input": text, "modelId": selected.modelId,
      "parentResponseId": (selected.activeBranchLeafId ?? selected.activeResponseId) as Any? ?? NSNull(),
      "agentMode": false, "attachmentIds": [], "presetSelections": [:]
    ], idempotencyKey: responseID)
    return result.response
  }
  public func latestReply(_ entityID: String) async throws -> String {
    let selected = try await chat(entityID)
    guard let id = selected.activeBranchLeafId ?? selected.activeResponseId else { throw ShortcutFailure("This chat has no reply yet.") }
    let snapshot: ShortcutSnapshot = try await request("/api/responses/\(id)")
    return try snapshot.reply()
  }
  public func waitForReply(_ initial: ShortcutSnapshot, timeout: TimeInterval = 50, pollNanoseconds: UInt64 = 1_000_000_000) async throws -> String {
    try Task.checkCancellation()
    try assertCurrent(session)
    let deadline = Date().addingTimeInterval(timeout)
    var snapshot = initial
    while ["queued", "in_progress"].contains(snapshot.status) {
      guard Date() < deadline else { throw ShortcutFailure("The reply is still running in Pulpo. Open the chat or use Get Reply later. Running Ask again starts another chat.") }
      try await Task.sleep(nanoseconds: pollNanoseconds)
      snapshot = try await request("/api/responses/\(initial.responseId)")
    }
    try Task.checkCancellation()
    try assertCurrent(session)
    return try snapshot.reply()
  }
  public static func prompt(_ value: String) throws -> String {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { throw ShortcutFailure("Enter a prompt or pass text from a previous Shortcuts action.") }
    guard trimmed.count <= 100_000 else { throw ShortcutFailure("The prompt is too long. Use 100,000 characters or fewer.") }
    return trimmed
  }
}
