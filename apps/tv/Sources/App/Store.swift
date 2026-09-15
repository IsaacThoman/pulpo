import SwiftUI
import SocketIO

@MainActor @Observable final class Store {
    var session: Session?
    var user: JSON = .null
    var config: JSON = .null
    var settings: JSON = [:]
    var chats: [Chat] = []
    var folders: [JSON] = []
    var models: [JSON] = []
    var agentAvailable = false
    var selected: Chat?
    var selectedID: String?
    var modelID = ""
    var presets: JSON = [:]
    var agent = false
    var temporary = false
    var loading = true
    var chatLoading = false
    var working = false
    var requiresTwoFactor = false
    var error: String?
    var offline = false
    var server = UserDefaults.standard.string(forKey: "server") ?? "https://pulpo.baby"
    var search = ""
    var searchResults: [Chat] = []
    var searching = false
    var draft = ""
    var pending: Submission?
    private var drafts: [String: Draft] = [:]
    private var cache: DraftCache?
    private var epoch = UUID()
    private var socketManager: SocketManager?
    private var refreshTask: Task<Void, Never>?
    private var saveTask: Task<Void, Never>?
    private var selectionVersion = UUID()
    private var detailRequestVersion = UUID()
    private var pendingResponseIDs = Set<String>()
    private var active = true
    private var refreshing = false
    private var refreshLibrary = false
    var api: API? { session.map { API(origin: $0.origin, token: $0.token) } }
    var currentModel: JSON { models.first { $0.id == modelID } ?? .null }
    var canSend: Bool { !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && draft.count <= 100_000 && models.contains(where: { $0.id == modelID }) && !working && !chatLoading && pending == nil }
    var draftKey: String { selectedID ?? "new" }

    func bootstrap() async {
        do {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-UITesting") {
                let args = ProcessInfo.processInfo.arguments
                let argument = args.firstIndex(of: "-TestServer").flatMap { args.indices.contains($0 + 1) ? args[$0 + 1] : nil }
                guard let origin = argument ?? ProcessInfo.processInfo.environment["PULPO_TV_TEST_SERVER"],
                      let url = URL(string: origin), ["127.0.0.1", "localhost"].contains(url.host ?? "") else {
                    throw APIError(status: 0, code: "test_configuration", message: "Set a loopback test server.")
                }
                if let saved = try SessionVault.load() { DraftCache(scope: saved.scope).clear() }
                server = origin
                UserDefaults.standard.removeObject(forKey: "tv-large-text")
                try SessionVault.save(nil)
            }
            #endif
            session = try SessionVault.load()
            if let session {
                server = session.origin.absoluteString
                cache = DraftCache(scope: session.scope)
                drafts = cache?.load() ?? [:]; restoreDraft()
                try await refresh()
                connect()
            } else {
                await loadConfig()
            }
        } catch { fail(error) }
        loading = false
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-UITestingAutologin"),
           ["127.0.0.1", "localhost"].contains(URL(string: server)?.host ?? "") {
            await authenticate(email: "tv@example.test", password: "test-password", code: "", name: "", username: "", signup: false)
        }
        #endif
    }

    func loadConfig() async {
        do {
            let origin = try API.origin(server)
            let value = try await API(origin: origin).request("/api/mobile/config")
            guard value["mobileApiVersion"].int == 1 else { throw APIError(status: 0, code: "version", message: "This server needs a newer version of Pulpo.") }
            config = value; error = nil
        } catch { self.error = error.localizedDescription }
    }

    func authenticate(email: String, password: String, code: String, name: String, username: String, signup: Bool) async {
        guard !working else { return }
        working = true; error = nil
        defer { working = false }
        do {
            let origin = try API.origin(server)
            var body: JSON = ["email": .string(email.trimmingCharacters(in: .whitespacesAndNewlines)), "password": .string(password),
                "deviceLabel": "Apple TV", "appType": "mobile", "platform": "unknown"]
            if !code.isEmpty { body["twoFactorCode"] = .string(code) }
            if signup { body["name"] = .string(name); body["username"] = .string(username) }
            let result = try await API(origin: origin).request("/api/mobile/auth/\(signup ? "signup" : "login")", method: "POST", body: body)
            guard let token = result["session"]["token"].optionalString, !token.isEmpty, !result["user"].id.isEmpty else {
                throw APIError(status: 0, code: "invalid_session", message: "The server returned an invalid session.")
            }
            let next = Session(origin: origin, token: token, userID: result["user"].id)
            try SessionVault.save(next)
            epoch = UUID(); session = next; server = origin.absoluteString; user = result["user"]
            UserDefaults.standard.set(origin.absoluteString, forKey: "server")
            cache = DraftCache(scope: next.scope); drafts = cache?.load() ?? [:]; restoreDraft()
            try await refresh(); connect()
        } catch {
            requiresTwoFactor = requiresTwoFactor || (error as? APIError)?.code == "two_factor_required"
            self.error = error.localizedDescription
        }
    }

    func refresh() async throws {
        guard let api, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let owner = epoch
        let me = try await api.request("/api/mobile/me")
        guard epoch == owner else { return }
        user = me["user"]
        guard user["role"].string != "pending" else { return }
        async let chatList = api.request("/api/chats")
        async let folderList = api.request("/api/folders")
        async let catalog = api.request("/api/models")
        async let preferences = api.request("/api/settings")
        let (c, f, m, p) = try await (chatList, folderList, catalog, preferences)
        guard epoch == owner else { return }
        chats = c["data"].array.map(Chat.init); folders = f["data"].array
        models = m["data"].array; agentAvailable = m["agentAvailable"].bool; settings = p["values"]
        if modelID.isEmpty || !models.contains(where: { $0.id == modelID }) {
            let preferred = settings["defaultModelId"].string
            chooseModel(models.first(where: { $0.id == preferred })?.id ?? models.first?.id ?? "")
        }
        offline = false
    }
    func reload() async { do { try await refresh(); await refreshSelected() } catch { fail(error) } }

    func select(_ chat: Chat?) async {
        saveDraft()
        selectionVersion = UUID()
        let version = selectionVersion
        if let old = selectedID { socketManager?.defaultSocket.emit("chat.unsubscribe", ["chatId": old]) }
        pendingResponseIDs = []
        selected = nil; selectedID = chat?.id; temporary = chat?.temporary ?? false
        restoreDraft(); error = nil
        if let chat {
            chatLoading = true
            socketManager?.defaultSocket.emit("chat.subscribe", ["chatId": chat.id])
            await refreshSelected()
            guard selectionVersion == version else { return }
            chatLoading = false
            if let selected { chooseModel(selected.modelID) }
        } else {
            chatLoading = false
            chooseModel(settings["defaultModelId"].optionalString ?? models.first?.id ?? "")
        }
    }
    func refreshSelected() async {
        guard let api, let id = selectedID else { return }
        let owner = epoch, version = selectionVersion, requestVersion = UUID()
        detailRequestVersion = requestVersion
        do {
            let value = try await api.request("/api/chats/\(API.resource(id))?format=compact&scope=active")
            guard owner == epoch, version == selectionVersion, detailRequestVersion == requestVersion, selectedID == id else { return }
            selected = Chat(value: value); offline = false
        } catch {
            guard owner == epoch, version == selectionVersion, detailRequestVersion == requestVersion else { return }
            if let e = error as? APIError, [404, 410].contains(e.status) {
                selected = nil; selectedID = nil; temporary = false; restoreDraft()
            }
            fail(error)
        }
    }
    func chooseModel(_ id: String) {
        modelID = id; presets = settings["generation"][id]
        if presets == .null { presets = [:] }
        agent = agentAvailable && currentModel["agentEnabled"].bool && settings["agentModes"][id] != .bool(false)
    }
    func updateDraft(_ text: String) {
        draft = text
        saveTask?.cancel()
        saveTask = Task { try? await Task.sleep(for: .milliseconds(350)); if !Task.isCancelled { saveDraft() } }
    }
    func setTemporary(_ value: Bool) {
        saveDraft(); temporary = value; pending = nil; draft = ""
        if !value { restoreDraft() }
    }
    private func saveDraft() {
        guard !temporary else { return }
        drafts[draftKey] = Draft(text: draft, pending: pending)
        drafts = drafts.filter { !$0.value.text.isEmpty || $0.value.pending != nil }
        do { try cache?.save(drafts) } catch { self.error = "Could not save the draft." }
    }
    private func restoreDraft() {
        let saved = temporary ? Draft() : drafts[draftKey] ?? Draft()
        draft = saved.text; pending = saved.pending
    }
    func discardPending() { pending = nil; saveDraft() }
    func send() async {
        guard canSend else { return }
        pending = Submission.make(chat: selected, text: draft.trimmingCharacters(in: .whitespacesAndNewlines), modelID: modelID,
            presets: presets, agent: agent, temporary: temporary, autoExpire: settings["newChatAutoExpire"].bool)
        saveDraft()
        await retrySend()
    }
    func retrySend() async {
        guard let submission = pending, let api, !working else { return }
        working = true; error = nil
        let owner = epoch, version = selectionVersion, key = draftKey
        defer { working = false }
        do {
            _ = try await api.request(submission.path, method: "POST", body: submission.body, key: submission.key)
            guard owner == epoch else { return }
            drafts.removeValue(forKey: key)
            try cache?.save(drafts)
            if version == selectionVersion {
                draft = ""; pending = nil; selectedID = submission.chatID
                socketManager?.defaultSocket.emit("chat.subscribe", ["chatId": submission.chatID])
                await refreshSelected()
            }
            try await refresh()
        } catch {
            guard owner == epoch else { return }
            if let failure = error as? APIError, (400..<500).contains(failure.status), failure.status != 408 {
                if version == selectionVersion { pending = nil; saveDraft() }
            }
            fail(error)
        }
    }
    @discardableResult func mutate(_ path: String, method: String = "POST", body: JSON? = nil, idempotent: Bool = false) async -> JSON? {
        guard let api, !working else { return nil }
        working = true; error = nil
        let owner = epoch
        defer { working = false }
        do {
            let value = try await api.request(path, method: method, body: body, key: idempotent ? UUID().uuidString.lowercased() : nil)
            guard owner == epoch else { return nil }
            await reload()
            return value
        } catch { if owner == epoch { fail(error) }; return nil }
    }
    func patchChat(_ values: JSON) async {
        guard let id = selectedID else { return }
        _ = await mutate("/api/chats/\(API.resource(id))", method: "PATCH", body: values)
    }
    func stop() async {
        guard let turn = selected?.turns.last(where: { $0.busy }) else { return }
        _ = await mutate("/api/responses/\(API.resource(turn.id))/cancel")
    }
    func regenerate(_ turn: Turn) async {
        let id = UUID().uuidString.lowercased()
        _ = await mutate("/api/messages/\(API.resource(turn.id))/regenerate", body: ["clientId": .string(id),
            "modelId": .string(modelID), "presetSelections": presets, "agentMode": .bool(agent), "timeZone": .string(TimeZone.current.identifier)])
    }
    func updateSettings(_ patch: JSON) async {
        if let result = await mutate("/api/settings", method: "PATCH", body: patch) { settings = result["values"] }
    }
    func runSearch() async {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines), owner = epoch
        guard let api else { return }
        if query.isEmpty { searchResults = []; return }
        searching = true
        do {
            let result = try await api.request(API.searchPath(query))
            guard owner == epoch, query == search.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
            searchResults = result["data"].array.map(Chat.init)
        } catch { if owner == epoch { fail(error) } }
        searching = false
    }
    func signOut() async {
        guard let api else { return }
        clearSession(); error = nil
        // Local access ends immediately, even when the server is unreachable.
        _ = try? await api.request("/api/mobile/auth/logout", method: "POST")
    }
    func securityRequest(_ path: String, method: String, body: JSON, endsSession: Bool = false) async -> Bool {
        guard let api, !working else { return false }
        let owner = epoch
        working = true; error = nil
        defer { working = false }
        do {
            _ = try await api.request(path, method: method, body: body)
            guard owner == epoch else { return false }
            if endsSession { clearSession() }
            return true
        } catch {
            guard owner == epoch else { return false }
            // A wrong current password also returns 401. Verify the session
            // before treating a security-form error as a revoked bearer token.
            if (error as? APIError)?.status == 401 {
                do { _ = try await api.request("/api/mobile/me") }
                catch let verification as APIError where verification.status == 401 { fail(verification); return false }
                catch { }
            }
            self.error = error.localizedDescription
            return false
        }
    }
    private func clearSession() {
        socketManager?.disconnect(); socketManager = nil
        refreshTask?.cancel(); saveTask?.cancel(); epoch = UUID(); selectionVersion = UUID()
        do { try SessionVault.save(nil) } catch { self.error = error.localizedDescription }
        cache?.clear(); cache = nil; drafts = [:]; pendingResponseIDs = []; refreshLibrary = false
        session = nil; user = .null; chats = []; folders = []; models = []; settings = [:]; requiresTwoFactor = false
        selected = nil; selectedID = nil; draft = ""; pending = nil; temporary = false
        searchResults = []; search = ""; modelID = ""; chatLoading = false
    }
    func fail(_ error: Error) {
        if error is CancellationError { return }
        if let e = error as? APIError, e.status == 401 { clearSession(); self.error = "Sign in again."; return }
        offline = error is URLError
        self.error = offline ? "Couldn’t connect. Try again." : error.localizedDescription
    }
    func foreground(_ isActive: Bool) async {
        active = isActive
        if isActive { if session != nil { await reload(); connect() } }
        else { saveDraft(); refreshTask?.cancel(); socketManager?.disconnect() }
    }
    func poll() async {
        var count = 0
        while !Task.isCancelled {
            do { try await Task.sleep(for: .seconds(2)) } catch { return }
            guard active, session != nil else { continue }
            if selected?.busy == true || count % 5 == 0 { await refreshSelected() }
            if count % 15 == 0 { do { try await refresh() } catch { fail(error) } }
            count += 1
        }
    }
    private func connect() {
        guard active, let session else { return }
        if let manager = socketManager { manager.defaultSocket.connect(withPayload: ["sessionToken": session.token, "composerSyncEnabled": false]); return }
        let manager = SocketManager(socketURL: session.origin, config: [.forceWebsockets(true), .log(false), .reconnects(true), .reconnectWait(2), .reconnectWaitMax(15)])
        socketManager = manager
        let socket = manager.defaultSocket
        socket.on(clientEvent: .connect) { [weak self] _, _ in
            guard let self else { return }
            if let id = self.selectedID { socket.emit("chat.subscribe", ["chatId": id]) }
            self.scheduleRefresh()
        }
        socket.on("response.event") { [weak self] data, _ in
            guard let self, let event = data.first as? [String: Any], let id = event["responseId"] as? String,
                  self.selected?.value["responses"].array.contains(where: { $0.id == id }) == true else { return }
            self.pendingResponseIDs.insert(id)
            self.scheduleRefresh(library: false)
        }
        socket.on("response.snapshot") { [weak self] data, _ in
            guard let object = data.first, JSONSerialization.isValidJSONObject(object),
                  let bytes = try? JSONSerialization.data(withJSONObject: object), let snapshot = try? JSON.parse(bytes) else { return }
            self?.receive(snapshot)
        }
        for event in ["response.completed", "chat.changed", "chat.started", "account.revision"] {
            socket.on(event) { [weak self] _, _ in self?.scheduleRefresh() }
        }
        socket.on("session.revoked") { [weak self] _, _ in self?.clearSession() }
        socket.connect(withPayload: ["sessionToken": session.token, "composerSyncEnabled": false])
    }
    private func receive(_ snapshot: JSON) {
        guard var chat = selected else { return }
        var rows = chat.value["responses"].array
        guard let index = rows.firstIndex(where: { $0.id == snapshot["responseId"].string }),
              snapshot["sequence"].int >= rows[index]["snapshot"]["sequence"].int else { return }
        rows[index]["snapshot"] = snapshot
        rows[index]["status"] = snapshot["status"]
        chat.value["responses"] = .array(rows)
        selected = chat
    }
    private func scheduleRefresh(library: Bool = true) {
        refreshLibrary = refreshLibrary || library
        guard refreshTask == nil else { return }
        refreshTask = Task {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { refreshTask = nil; return }
            let library = refreshLibrary; refreshLibrary = false
            let ids = pendingResponseIDs; pendingResponseIDs = []
            let owner = epoch, version = selectionVersion
            if library {
                do { try await refresh() } catch { fail(error) }
                await refreshSelected()
            } else if let api {
                for id in ids {
                    do {
                        let snapshot = try await api.request("/api/responses/\(API.resource(id))")
                        if epoch == owner, selectionVersion == version { receive(snapshot) }
                    } catch { if epoch == owner { fail(error) } }
                }
            }
            refreshTask = nil
            if refreshLibrary || !pendingResponseIDs.isEmpty { scheduleRefresh(library: false) }
        }
    }
}
