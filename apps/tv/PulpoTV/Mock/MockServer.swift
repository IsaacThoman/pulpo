#if DEBUG
import Foundation
import PulpoKit

/// An in-process Pulpo server for UI tests, previews, and screenshots.
/// Launch with `-PulpoMock` (add `-PulpoSignedIn` to skip signing in).
///
/// Accounts (password `pulpo-tv`): `ada@pulpo.test` signs straight in,
/// `grace@pulpo.test` asks for the two-factor code `123456`, and
/// `pat@pulpo.test` is awaiting an administrator's approval.
final class MockServer: @unchecked Sendable {
    static let shared = MockServer(host: "mock.pulpo.test")
    static let token = "mock-session-token-0123456789abcdefghijklmnop"

    /// Servers by host, so tests can each run against their own instance.
    private static let registryLock = NSLock()
    nonisolated(unsafe) private static var registry: [String: MockServer] = [:]

    static func server(for host: String?) -> MockServer? {
        registryLock.withLock { host.flatMap { registry[$0] } }
    }

    let address: ServerAddress
    let realtime = MockRealtime()
    /// Delay between streamed words. UI tests shorten it with `-PulpoMockFast`.
    var wordDelay: Duration = ProcessInfo.processInfo.arguments.contains("-PulpoMockFast") ? .milliseconds(8) : .milliseconds(45)

    private let lock = NSLock()
    private var chats: [String: ChatDetail] = [:]
    private var defaultModelId = "gpt-5.6-luna"
    private var revision = 0
    private var cancelled: Set<String> = []
    /// Text streamed so far for each running response, kept for cancellation.
    private var partial: [String: (text: String, sequence: Int)] = [:]

    let user = User(
        id: "00000000-0000-4000-8000-0000000000a1", email: "ada@pulpo.test", name: "Ada Lovelace",
        username: "ada", profileColor: "#7C5CFF", role: .user
    )

    static let models: [AIModel] = [
        AIModel(id: "gpt-5.6-luna", name: "GPT-5.6 Luna", description: "Fast, thoughtful, and great at everyday questions.",
                logo: "openai", tags: ["Reasoning"], lab: .init(id: "openai", name: "OpenAI", logo: "openai"),
                provider: .init(id: "p1", name: "Pulpo Baby")),
        AIModel(id: "claude-opus", name: "Claude Opus", description: "Careful writing and deep analysis.",
                logo: "claude-color", tags: ["Writing"], lab: .init(id: "anthropic", name: "Anthropic", logo: "anthropic"),
                provider: .init(id: "p2", name: "Anthropic")),
        AIModel(id: "gemini-pro", name: "Gemini Pro", description: "Long context and multimodal reasoning.",
                logo: "gemini-color", tags: ["Long context"], lab: .init(id: "google", name: "Google", logo: "google"),
                provider: .init(id: "p3", name: "Google")),
    ]

    init(host: String = "mock-\(UUID().uuidString.lowercased()).pulpo.test") {
        address = try! ServerAddress("https://\(host)")
        Self.registryLock.withLock { Self.registry[host] = self }
    }

    @MainActor
    static func environment(signedIn: Bool) -> AppEnvironment {
        UserDefaults.standard.removeObject(forKey: "lastServer")
        UserDefaults.standard.removeObject(forKey: "lastEmail")
        return shared.environment(signedIn: signedIn)
    }

    /// An app environment whose requests and realtime messages go to this server.
    func environment(signedIn: Bool, store: SessionStore? = nil) -> AppEnvironment {
        seed()
        let store = store ?? MemorySessionStore(signedIn ? StoredSession(server: address, token: Self.token, user: user) : nil)
        return AppEnvironment(
            defaultServer: address,
            sessionStore: store,
            allowLocalHTTP: true,
            makeHTTPClient: { server, token in
                let configuration = URLSessionConfiguration.ephemeral
                configuration.protocolClasses = [MockURLProtocol.self]
                return HTTPClient(server: server, token: token, configuration: configuration)
            },
            makeRealtime: { [realtime] _, _ in realtime },
            deviceLabel: "Apple TV"
        )
    }

    private var requestLog: [String] = []

    /// Requests received so far as "METHOD /path", for assertions.
    var requests: [String] { lock.withLock { requestLog } }

    /// Makes the next requests matching `path` fail with `status`.
    func failNext(_ path: String, status: Int, code: String, message: String) {
        lock.withLock { failures[path] = (status, code, message) }
    }

    private var failures: [String: (Int, String, String)] = [:]

    /// Delays the next response for `path`, simulating a slow network. With
    /// `afterHandling`, the request is processed first and its reply arrives late.
    func delayNext(_ path: String, by delay: TimeInterval, afterHandling: Bool = false) {
        lock.withLock { delays[path] = (delay, afterHandling) }
    }

    private var delays: [String: (TimeInterval, Bool)] = [:]

    /// Changes account settings as another device would, notifying this one.
    func changeSettingsElsewhere(defaultModelId id: String) {
        lock.withLock { defaultModelId = id }
        realtime.emit(.accountRevision(scopes: []))
    }

    /// Ends the session server-side, so the next request gets a 401.
    func revokeSessions() {
        lock.withLock { revoked = true }
    }

    private var revoked = false
    private var currentUser: User?

    // MARK: Seed data

    func seed() {
        lock.withLock {
            chats = [:]
            let now = Date()
            func add(
                _ title: String, model: String, hoursAgo: Double, pinned: Bool = false, folder: String? = nil,
                files: [JSONValue] = [], turns: [(String, String, String?)]
            ) {
                let id = UUID().uuidString.lowercased()
                let created = now.addingTimeInterval(-hoursAgo * 3_600)
                var detail = ChatDetail(id: id, title: title, modelId: model, pinned: pinned, folderId: folder, createdAt: created, updatedAt: created)
                var parent: String?
                for (index, turn) in turns.enumerated() {
                    let responseId = UUID().uuidString.lowercased()
                    var output: [JSONValue] = []
                    if let reasoning = turn.2 {
                        output.append(["type": "reasoning", "status": "completed", "durationMs": 6_000, "summary": [["type": "summary_text", "text": .string(reasoning)]]])
                    }
                    output.append(Self.message(turn.1, status: "completed"))
                    if index == turns.count - 1 { output += files }
                    var response = ChatResponse(
                        id: responseId, parentResponseId: parent, modelId: model, status: .completed,
                        input: Self.input(turn.0), output: output,
                        createdAt: created.addingTimeInterval(Double(index) * 60)
                    )
                    response.completedAt = response.createdAt.addingTimeInterval(8)
                    response.snapshot = ResponseSnapshot(
                        responseId: responseId, status: .completed, sequence: 40, output: [],
                        updatedAt: PulpoDate.format(response.completedAt!),
                        requestReceivedAt: PulpoDate.format(response.createdAt),
                        firstReplyTextAt: PulpoDate.format(response.createdAt.addingTimeInterval(turn.2 == nil ? 1 : 6))
                    )
                    detail.responses.append(response)
                    parent = responseId
                }
                detail.activeBranchLeafId = parent
                detail.activeResponseId = parent
                chats[id] = detail
            }
            add("🚀 Launch Checklist for Pulpo TV", model: "gpt-5.6-luna", hoursAgo: 0.4, pinned: true, turns: [
                ("What should I double-check before shipping an Apple TV app?", Self.checklistReply, "The user wants a practical pre-launch list. Cover focus, layout, performance, and review requirements."),
            ])
            add("🍜 Weeknight Ramen", model: "claude-opus", hoursAgo: 2, folder: "folder-kitchen", turns: [
                ("Give me a quick ramen recipe for tonight", Self.ramenReply, nil),
            ])
            add("🧠 How KV Caching Works", model: "gpt-5.6-luna", hoursAgo: 26, turns: [
                ("Explain how KV caching speeds up decoding", Self.kvReply, "Explain attention cost with and without a cache, then show the complexity difference."),
            ])
            add("🌌 Why Is the Sky Dark at Night?", model: "gemini-pro", hoursAgo: 75, turns: [
                ("Why is the night sky dark if the universe is infinite?", "That’s **Olbers’ paradox**. The short answer: the universe isn’t infinitely old, and it’s expanding, so light from the most distant stars hasn’t reached us and the rest is stretched far into the infrared.", nil),
            ])
            add("📈 Compare Index Funds", model: "claude-opus", hoursAgo: 24 * 12, folder: "folder-money", turns: [
                ("Compare total-market and S&P 500 index funds", Self.tableReply, nil),
            ])
            add("🐙 Octopus Movie Poster", model: "gemini-pro", hoursAgo: 30, files: [
                ["type": "pulpo_attachment", "attachment_id": "poster-1", "name": "octopus-poster.png", "mime_type": "image/png", "status": "completed"],
                ["type": "pulpo_attachment", "attachment_id": "poster-2", "name": "octopus-poster-alt.png", "mime_type": "image/png", "status": "completed"],
            ], turns: [
                ("Design a retro movie poster starring a friendly octopus", "Here are two takes on **Eight Arms of Glory** — one warm sunset palette, one deep-sea blue. Select one to see it full screen.", nil),
            ])
            add("🎸 Learning Barre Chords", model: "gpt-5.6-luna", hoursAgo: 24 * 40, turns: [
                ("Tips for learning barre chords?", "- Press with the **bony side** of your index finger.\n- Keep your thumb behind the neck, near the middle.\n- Practice the F shape for a minute a day; strength builds fast.", nil),
            ])
        }
    }

    // MARK: Routing

    func handle(_ request: URLRequest, body: Data?) -> (Int, Data) {
        let path = request.url?.path ?? ""
        let delay = lock.withLock { delays.removeValue(forKey: path) }
        if let (seconds, afterHandling) = delay {
            if !afterHandling { Thread.sleep(forTimeInterval: seconds) }
            let reply = route(request, body: body)
            if afterHandling { Thread.sleep(forTimeInterval: seconds) }
            return reply
        }
        return route(request, body: body)
    }

    private func route(_ request: URLRequest, body: Data?) -> (Int, Data) {
        let path = request.url?.path ?? ""
        let method = request.httpMethod ?? "GET"
        let failure: (Int, String, String)? = lock.withLock {
            requestLog.append("\(method) \(path)")
            return failures.removeValue(forKey: path)
        }
        if let (status, code, message) = failure { return error(status, code, message) }
        let json = body.flatMap { try? JSONDecoder.pulpo.decode(JSONValue.self, from: $0) } ?? .null
        let segments = path.split(separator: "/").map(String.init)

        if path == "/api/mobile/config" {
            return ok(#"{"mobileApiVersion":1,"instance":{"name":"Pulpo","version":"0.1.0","publicUrl":"https://mock.pulpo.test"},"setupRequired":false,"auth":{"signupEnabled":false,"pendingMessage":"Your account is pending approval."},"capabilities":{"realtime":true,"twoFactorAuth":true}}"#)
        }
        if path == "/api/mobile/auth/login", method == "POST" { return login(json) }
        if request.value(forHTTPHeaderField: "Authorization") != "Bearer \(Self.token)" || lock.withLock({ revoked }) {
            return error(401, "unauthorized", "Authentication required")
        }
        switch (method, path) {
        case ("GET", "/api/mobile/me"): return encode(["user": lock.withLock { currentUser ?? user }])
        case ("POST", "/api/mobile/auth/logout"): return (204, Data())
        case ("GET", "/api/chats"): return encode(["data": summaries()])
        case ("GET", "/api/chats/search"): return encode(["data": search(request.url)])
        case ("GET", "/api/folders"):
            return ok(#"{"data":[{"id":"folder-kitchen","name":"Kitchen","pinned":false,"sortOrder":0},{"id":"folder-money","name":"Money","pinned":false,"sortOrder":1}]}"#)
        case ("GET", "/api/models"): return encode(["data": Self.models])
        case ("GET", "/api/settings"):
            return ok(#"{"values":{"defaultModelId":"\#(lock.withLock { defaultModelId })","favoriteModelIds":["gpt-5.6-luna"],"chatSortMode":"default"}}"#)
        case ("PATCH", "/api/settings"):
            if let id = json["defaultModelId"]?.stringValue { lock.withLock { defaultModelId = id } }
            // Like the server: an account-level revision without scopes.
            realtime.emit(.accountRevision(scopes: []))
            return ok("{}")
        case ("GET", "/api/interface/suggested-prompts"):
            return ok(#"{"enabled":true,"prompts":[{"id":"1","label":"Plan a cozy movie night","message":"Plan a cozy movie night for four"},{"id":"2","label":"Explain how KV caching speeds up decoding","message":"Explain how KV caching speeds up decoding"},{"id":"3","label":"Write a haiku about octopuses","message":"Write a haiku about octopuses"},{"id":"4","label":"Compare three sci-fi classics","message":"Compare three sci-fi classics in a table"}]}"#)
        case ("POST", "/api/chats/start"): return start(json)
        default: break
        }
        if segments.count == 4, segments[1] == "attachments" {
            let id = segments[2]
            if segments[3] == "thumbnail" { return (200, Self.poster(id)) }
            if segments[3] == "download" { return encode(["url": "\(address.url.absoluteString)/api/attachments/\(id)/thumbnail"]) }
        }
        if segments.count == 3, segments[1] == "chats" {
            let id = segments[2]
            switch method {
            case "GET": return detail(id).map { encode($0) } ?? error(404, "not_found", "Chat not found")
            case "PATCH": return update(id, json)
            case "DELETE":
                lock.withLock { _ = chats.removeValue(forKey: id) }
                bump()
                return (204, Data())
            default: break
            }
        }
        if segments.count == 4, segments[1] == "chats", segments[3] == "responses", method == "POST" {
            return respond(chatId: segments[2], json)
        }
        if segments.count == 4, segments[1] == "messages" {
            let target = segments[2]
            if segments[3] == "regenerate" { return branch(from: target, text: nil, clientId: json["clientId"]?.stringValue) }
            if segments[3] == "activate" { return activate(target) }
        }
        if segments.count == 3, segments[1] == "messages", segments[2].hasSuffix(":input"), method == "PATCH" {
            return branch(from: String(segments[2].dropLast(6)), text: json["content"]?.stringValue, clientId: json["clientId"]?.stringValue)
        }
        if segments.count == 4, segments[1] == "responses", segments[3] == "cancel" { return cancel(segments[2]) }
        return error(404, "not_found", "No mock route for \(method) \(path)")
    }

    // MARK: Handlers

    private func login(_ json: JSONValue) -> (Int, Data) {
        let email = json["email"]?.stringValue?.lowercased() ?? ""
        let password = json["password"]?.stringValue ?? ""
        guard ["ada@pulpo.test", "grace@pulpo.test", "pat@pulpo.test"].contains(email), password == "pulpo-tv" else {
            return error(401, "unauthorized", "Invalid email or password")
        }
        if email == "pat@pulpo.test" {
            let pending = User(id: "00000000-0000-4000-8000-0000000000a2", email: email, name: "Pat Pending", username: "pat", role: .pending)
            lock.withLock { currentUser = pending }
            return encode(NativeAuthResponse(user: pending, session: NativeSession(token: Self.token, expiresAt: nil)))
        }
        lock.withLock { currentUser = user }
        if email == "grace@pulpo.test" {
            guard let code = json["twoFactorCode"]?.stringValue else {
                return error(401, "two_factor_required", "Two-factor authentication is required")
            }
            guard code == "123456" else { return error(401, "two_factor_code_invalid", "Invalid two-factor code") }
        }
        lock.withLock { revoked = false }
        return encode(NativeAuthResponse(user: user, session: NativeSession(token: Self.token, expiresAt: Date().addingTimeInterval(86_400 * 30))))
    }

    private func summaries() -> [ChatSummary] {
        lock.withLock { chats.values.map(\.summary).sorted { $0.updatedAt > $1.updatedAt } }
    }

    private func search(_ url: URL?) -> [ChatSummary] {
        let query = URLComponents(url: url!, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "q" }?.value?.lowercased() ?? ""
        return lock.withLock {
            chats.values.filter { chat in
                chat.title.lowercased().contains(query) || chat.responses.contains {
                    Transcript.inputText($0.input).lowercased().contains(query)
                        || ResponseContent(output: $0.output).text.lowercased().contains(query)
                }
            }.map(\.summary)
        }
    }

    private func detail(_ id: String) -> ChatDetail? {
        lock.withLock {
            guard var detail = chats[id] else { return nil }
            // Mirror the server's compact, active-branch format.
            let lineage = Set(Transcript.lineage(detail.responses, leafId: Transcript.leafId(of: detail)).map(\.id))
            detail.responses = detail.responses.map { response in
                var response = response
                let siblings = detail.responses.filter { $0.parentResponseId == response.parentResponseId }.map(\.id)
                response.branches = BranchSet(
                    user: .init(ids: [response.id], index: 0),
                    assistant: .init(ids: siblings, index: siblings.firstIndex(of: response.id) ?? 0)
                )
                if !lineage.contains(response.id) {
                    response.detailAvailable = false
                    response.input = []
                    response.output = []
                }
                return response
            }
            return detail
        }
    }

    private func update(_ id: String, _ json: JSONValue) -> (Int, Data) {
        let summary: ChatSummary? = lock.withLock {
            guard var chat = chats[id] else { return nil }
            if let title = json["title"]?.stringValue { chat.title = title }
            if case .bool(let pinned) = json["pinned"] { chat.pinned = pinned }
            if let model = json["modelId"]?.stringValue { chat.modelId = model }
            chats[id] = chat
            return chat.summary
        }
        guard let summary else { return error(404, "not_found", "Chat not found") }
        bump()
        return encode(summary)
    }

    private func start(_ json: JSONValue) -> (Int, Data) {
        guard let chatId = json["chat"]?["clientId"]?.stringValue,
              let request = json["response"], let responseId = request["clientId"]?.stringValue,
              let text = request["input"]?.stringValue else { return error(400, "validation_error", "Invalid body") }
        let model = request["modelId"]?.stringValue ?? defaultModelId
        let now = Date()
        var detail = ChatDetail(id: chatId, title: json["chat"]?["title"]?.stringValue ?? "New chat", modelId: model, createdAt: now, updatedAt: now)
        detail.responses = [queued(responseId, parent: nil, model: model, text: text)]
        detail.activeBranchLeafId = responseId
        lock.withLock { chats[chatId] = detail }
        generate(chatId: chatId, responseId: responseId, prompt: text, nameChat: true)
        return encode(["chat": AnyEncodable(detail.summary), "response": AnyEncodable(ResponseSnapshot.queued(responseId))], status: 202)
    }

    private func respond(chatId: String, _ json: JSONValue) -> (Int, Data) {
        guard let responseId = json["clientId"]?.stringValue, let text = json["input"]?.stringValue else {
            return error(400, "validation_error", "Invalid body")
        }
        let model = json["modelId"]?.stringValue ?? defaultModelId
        let found: Bool = lock.withLock {
            guard var chat = chats[chatId] else { return false }
            chat.responses.append(queued(responseId, parent: Transcript.leafId(of: chat), model: model, text: text))
            chat.activeBranchLeafId = responseId
            chat.updatedAt = Date()
            chats[chatId] = chat
            return true
        }
        guard found else { return error(404, "not_found", "Chat not found") }
        generate(chatId: chatId, responseId: responseId, prompt: text, nameChat: false)
        return encode(["response": ResponseSnapshot.queued(responseId)], status: 202)
    }

    private func branch(from responseId: String, text: String?, clientId: String?) -> (Int, Data) {
        let newId = clientId ?? UUID().uuidString.lowercased()
        let result: (String, String)? = lock.withLock {
            guard let (chatId, chat) = chats.first(where: { $0.value.responses.contains { $0.id == responseId } }),
                  let original = chat.responses.first(where: { $0.id == responseId }) else { return nil }
            var updated = chat
            let prompt = text ?? Transcript.inputText(original.input)
            updated.responses.append(queued(newId, parent: original.parentResponseId, model: original.modelId, text: prompt))
            updated.activeBranchLeafId = newId
            chats[chatId] = updated
            return (chatId, prompt)
        }
        guard let (chatId, prompt) = result else { return error(404, "not_found", "Message not found") }
        generate(chatId: chatId, responseId: newId, prompt: prompt, nameChat: false)
        return encode(["response": ResponseSnapshot.queued(newId)], status: 202)
    }

    private func activate(_ responseId: String) -> (Int, Data) {
        let leaf: String? = lock.withLock {
            guard let (chatId, chat) = chats.first(where: { $0.value.responses.contains { $0.id == responseId } }) else { return nil }
            var updated = chat
            updated.activeBranchLeafId = Transcript.newestDescendant(of: responseId, in: chat.responses)
            chats[chatId] = updated
            return updated.activeBranchLeafId
        }
        guard let leaf else { return error(404, "not_found", "Message not found") }
        return encode(["activeBranchLeafId": leaf])
    }

    private func cancel(_ responseId: String) -> (Int, Data) {
        let exists = lock.withLock { chats.values.contains { $0.responses.contains { $0.id == responseId } } }
        guard exists else { return error(404, "not_found", "Response not found") }
        let progress = lock.withLock {
            _ = cancelled.insert(responseId)
            return partial[responseId]
        }
        let snapshot = finish(
            responseId, status: .cancelled,
            output: progress.map { [Self.message($0.text, status: "incomplete", id: "msg_1")] },
            sequence: progress.map { $0.sequence + 1 }, error: ["message": "Generation cancelled"]
        )
        if let snapshot { realtime.emit(.responseSnapshot(snapshot)) }
        return encode(snapshot ?? ResponseSnapshot.queued(responseId))
    }

    // MARK: Generation

    private func queued(_ id: String, parent: String?, model: String, text: String) -> ChatResponse {
        ChatResponse(id: id, parentResponseId: parent, modelId: model, status: .queued, input: Self.input(text), createdAt: Date(), snapshot: .queued(id))
    }

    /// Streams a canned reply word by word, like a model would.
    private func generate(chatId: String, responseId: String, prompt: String, nameChat: Bool) {
        let reply = Self.reply(to: prompt)
        let delay = wordDelay
        Task.detached { [self] in
            var sequence = 0
            func emit(_ type: String, _ payload: JSONValue) {
                sequence += 1
                realtime.emit(.responseEvent(ResponseEvent(
                    responseId: responseId, sequence: sequence, type: type, payload: payload, emittedAt: PulpoDate.format(Date())
                )))
            }
            try? await Task.sleep(for: delay * 4)
            emit("response.created", ["response": ["status": "in_progress", "output": []]])
            if let reasoning = reply.reasoning {
                for word in reasoning.split(separator: " ", omittingEmptySubsequences: false) {
                    if self.isCancelled(responseId) { return }
                    emit("response.reasoning_summary_text.delta", ["item_id": "rs_1", "delta": .string(word + " ")])
                    try? await Task.sleep(for: delay)
                }
            }
            let words = reply.text.split(separator: " ", omittingEmptySubsequences: false)
            var streamed = ""
            for (index, word) in words.enumerated() {
                if self.isCancelled(responseId) { return }
                let delta = (index == 0 ? "" : " ") + word
                streamed += delta
                emit("response.output_text.delta", ["item_id": "msg_1", "content_index": 0, "delta": .string(delta)])
                self.recordProgress(responseId, text: streamed, sequence: sequence)
                try? await Task.sleep(for: delay)
            }
            if self.isCancelled(responseId) { return }
            emit("response.completed", ["response": ["status": "completed"]])
            var output: [JSONValue] = []
            if let reasoning = reply.reasoning {
                output.append(["id": "rs_1", "type": "reasoning", "status": "completed", "summary": [["type": "summary_text", "text": .string(reasoning + " ")]]])
            }
            output.append(Self.message(reply.text, status: "completed", id: "msg_1"))
            if let snapshot = self.finish(responseId, status: .completed, output: output, sequence: sequence) {
                if nameChat { self.rename(chatId, prompt: prompt) }
                self.realtime.emit(.responseSnapshot(snapshot))
            }
        }
    }

    private func recordProgress(_ responseId: String, text: String, sequence: Int) {
        lock.withLock { partial[responseId] = (text, sequence) }
    }

    private func isCancelled(_ responseId: String) -> Bool {
        lock.withLock { cancelled.contains(responseId) }
    }

    @discardableResult
    private func finish(_ responseId: String, status: ResponseStatus, output: [JSONValue]? = nil, sequence: Int? = nil, error: JSONValue? = nil) -> ResponseSnapshot? {
        let snapshot: ResponseSnapshot? = lock.withLock {
            guard let (chatId, chat) = chats.first(where: { $0.value.responses.contains { $0.id == responseId } }),
                  let index = chat.responses.firstIndex(where: { $0.id == responseId }),
                  chat.responses[index].status.isActive else { return nil }
            var updated = chat
            var response = updated.responses[index]
            let now = Date()
            response.status = status
            if let output { response.output = output }
            response.error = error
            response.completedAt = now
            let snapshot = ResponseSnapshot(
                responseId: responseId, status: status, sequence: sequence ?? (response.snapshot?.sequence ?? 0),
                output: response.output, error: error, updatedAt: PulpoDate.format(now),
                requestReceivedAt: PulpoDate.format(response.createdAt), firstReplyTextAt: PulpoDate.format(response.createdAt.addingTimeInterval(1))
            )
            var embedded = snapshot
            embedded.output = []
            response.snapshot = embedded
            updated.responses[index] = response
            updated.updatedAt = now
            chats[chatId] = updated
            return snapshot
        }
        bump()
        return snapshot
    }

    private func rename(_ chatId: String, prompt: String) {
        let words = prompt.split(separator: " ").prefix(4).map { $0.prefix(1).uppercased() + $0.dropFirst() }
        lock.withLock { chats[chatId]?.title = "✨ " + words.joined(separator: " ") }
        bump()
    }

    private func bump() {
        realtime.emit(.accountRevision(scopes: ["chats"]))
    }

    // MARK: Encoding

    private func ok(_ json: String) -> (Int, Data) { (200, Data(json.utf8)) }

    private func encode(_ value: some Encodable, status: Int = 200) -> (Int, Data) {
        (status, (try? JSONEncoder.pulpo.encode(value)) ?? Data())
    }

    private func error(_ status: Int, _ code: String, _ message: String) -> (Int, Data) {
        encode(["error": ["message": message, "type": "invalid_request_error", "code": code]], status: status)
    }

    static func input(_ text: String) -> [JSONValue] {
        [["role": "user", "content": [["type": "input_text", "text": .string(text)]]]]
    }

    static func message(_ text: String, status: String, id: String = "msg_seed") -> JSONValue {
        ["id": .string(id), "type": "message", "role": "assistant", "status": .string(status), "content": [["type": "output_text", "text": .string(text)]]]
    }
}

/// Type-erases heterogeneous values for JSON encoding.
private struct AnyEncodable: Encodable {
    let value: any Encodable
    init(_ value: any Encodable) { self.value = value }
    func encode(to encoder: Encoder) throws { try value.encode(to: encoder) }
}

/// Realtime messages emitted by ``MockServer``.
final class MockRealtime: RealtimeChannel, @unchecked Sendable {
    let messages: AsyncStream<RealtimeMessage>
    private let continuation: AsyncStream<RealtimeMessage>.Continuation
    /// Simulates a proxy that blocks websockets: replies are never pushed.
    nonisolated(unsafe) var dropsResponses = false

    init() {
        (messages, continuation) = AsyncStream.makeStream(of: RealtimeMessage.self, bufferingPolicy: .unbounded)
    }

    func emit(_ message: RealtimeMessage) {
        switch message {
        case .responseEvent where dropsResponses, .responseSnapshot where dropsResponses: return
        default: continuation.yield(message)
        }
    }
    func start() async { continuation.yield(.connected) }
    func stop() async {}
    func subscribe(responseId: String, afterSequence: Int) async {}
    func unsubscribe(responseId: String) async {}
}

/// Routes the app's HTTP requests to ``MockServer``.
final class MockURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        guard let server = MockServer.server(for: request.url?.host) else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        let (status, data) = server.handle(request, body: body)
        let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
#endif
