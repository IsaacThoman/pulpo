import XCTest
@testable import Pulpo

final class CoreTests: XCTestCase {
    func testOriginValidation() throws {
        XCTAssertEqual(try API.origin(" pulpo.baby/ ").absoluteString, "https://pulpo.baby")
        XCTAssertEqual(try API.origin("http://127.0.0.1:8371").port, 8371)
        for value in ["http://example.com", "https://name:password@example.com", "https://example.com/api", "https://example.com?q=secret", "https://example.com#token", "file:///tmp/test"] {
            XCTAssertThrowsError(try API.origin(value), value)
        }
    }
    func testSearchEscapesSeparators() {
        let path = API.searchPath("cats + dogs & q=secret#value")
        let components = URLComponents(string: path)!
        XCTAssertEqual(components.queryItems?.count, 1)
        XCTAssertEqual(components.queryItems?.first?.value, "cats + dogs & q=secret#value")
        XCTAssertTrue(path.contains("%2B"))
        XCTAssertEqual(API.resource("abc:input"), "abc%3Ainput")
    }
    func testSessionIsolation() throws {
        let a = Session(origin: try API.origin("one.test"), token: "secret", userID: "a")
        let b = Session(origin: try API.origin("two.test"), token: "secret", userID: "a")
        let c = Session(origin: a.origin, token: "secret", userID: "b")
        XCTAssertNotEqual(a.scope, b.scope); XCTAssertNotEqual(a.scope, c.scope)
        XCTAssertFalse(a.scope.contains("secret"))
    }
    func testResponseDecodingToleratesUnknownToolShapes() throws {
        let value = try JSON.parse(Data(#"{"id":"r","input":[{"role":"user","content":"Hello"}],"output":[{"type":"reasoning","summary":[{"text":"Thinking"}]},{"type":"pulpo_tool","content":"arbitrary shape"},{"type":"message","content":[{"type":"output_text","text":"Answer"},{"type":"refusal","refusal":"Refusal"}]}],"snapshot":{"status":"completed"}}"#.utf8))
        let turn = Turn(value: value)
        XCTAssertEqual(turn.prompt, "Hello"); XCTAssertEqual(turn.text, "AnswerRefusal")
        XCTAssertEqual(turn.reasoning, "Thinking"); XCTAssertEqual(turn.activities.count, 1)
        XCTAssertFalse(turn.busy)
        XCTAssertEqual(try JSON.parse(JSONEncoder().encode(value)), value)
    }
    func testInactiveBranchStubsAreNotRendered() {
        let chat = Chat(value: ["id": "chat", "activeBranchLeafId": "selected", "responses": [
            ["id": "root", "parentResponseId": nil, "detailAvailable": true],
            ["id": "old", "parentResponseId": "root", "detailAvailable": false],
            ["id": "selected", "parentResponseId": "root", "detailAvailable": true]]])
        XCTAssertEqual(chat.turns.map(\.id), ["root", "selected"])
        let cycle = Chat(value: ["activeBranchLeafId": "a", "responses": [["id": "a", "parentResponseId": "b"], ["id": "b", "parentResponseId": "a"]]])
        XCTAssertEqual(cycle.turns.count, 2)
    }
    func testFullSnapshotOverridesEmbeddedOutput() {
        let turn = Turn(value: ["id": "r", "status": "in_progress", "output": [["type": "message", "content": [["text": "old"]]]], "snapshot": ["status": "completed", "output": [["type": "message", "content": [["text": "new"]]]]]])
        XCTAssertEqual(turn.text, "new"); XCTAssertFalse(turn.busy)
    }
    func testStartAndRetryKeepExactIdentity() throws {
        let request = Submission.make(chat: nil, text: "Hello", modelID: "model", presets: ["effort": "high"], agent: true, temporary: true, autoExpire: true)
        XCTAssertEqual(request.path, "/api/chats/start")
        XCTAssertEqual(request.body["response"]["clientId"].string, request.key)
        XCTAssertEqual(request.body["chat"]["clientId"].string, request.chatID)
        XCTAssertTrue(request.body["chat"]["temporary"].bool)
        XCTAssertFalse(request.body["chat"]["autoExpire"].bool)
        XCTAssertEqual(request.body["response"]["presetSelections"]["effort"], "high")
        XCTAssertEqual(try JSONDecoder().decode(Submission.self, from: JSONEncoder().encode(request)), request)
    }
    func testFollowupUsesActiveBranchAndQueuesDuringGeneration() {
        var value: JSON = ["id": "chat", "activeBranchLeafId": "branch", "activeResponseId": "old", "responses": [["id": "r", "status": "completed"]]]
        func request() -> Submission { Submission.make(chat: Chat(value: value), text: "Hello", modelID: "m", presets: [:], agent: false, temporary: false, autoExpire: false) }
        XCTAssertEqual(request().path, "/api/chats/chat/responses")
        XCTAssertEqual(request().body["parentResponseId"], "branch")
        value["queuedMessages"] = [["id": "q"]]
        XCTAssertEqual(request().path, "/api/chats/chat/queued-messages")
        value["queuedMessages"] = []; value["responses"] = [["id": "r", "status": "in_progress"]]
        XCTAssertEqual(request().path, "/api/chats/chat/queued-messages")
    }
    func testDraftCacheRoundTripAndClear() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = DraftCache(scope: "test", directory: directory)
        let request = Submission.make(chat: nil, text: "Keep me", modelID: "m", presets: [:], agent: false, temporary: false, autoExpire: false)
        try cache.save(["new": Draft(text: "Keep me", pending: request)])
        XCTAssertEqual(cache.load()["new"]?.pending, request)
        XCTAssertEqual(cache.load()["new"]?.text, "Keep me")
        cache.clear(); XCTAssertTrue(cache.load().isEmpty)
    }
    func testLongMarkdownCanBeNavigatedInScreenSizedChunks() {
        let blocks = MarkdownBlock.parse("# Heading\n\n" + String(repeating: "word ", count: 1000) + "\n```swift\nlet value = 1\n```")
        XCTAssertTrue(blocks.count > 5)
        XCTAssertTrue(blocks.allSatisfy { $0.text.count <= 600 })
        XCTAssertEqual(blocks.last, MarkdownBlock(text: "let value = 1", code: true))
    }
    func testAPIRejectsCrossOriginBeforeSendingCredentials() async throws {
        let api = API(origin: try API.origin("https://one.test"), token: "private-token")
        do { _ = try await api.request("https://two.test/private"); XCTFail("Must reject") }
        catch { XCTAssertEqual((error as? APIError)?.code, "invalid_url") }
    }
}

@MainActor final class IntegrationTests: XCTestCase {
    let origin = URL(string: "http://127.0.0.1:8371")!
    func control(_ body: JSON = [:]) async throws -> JSON { try await API(origin: origin).request("/__control", method: "POST", body: body) }
    func signedIn() async throws -> Store {
        _ = try await control(["reset": true])
        if let session = try SessionVault.load() { DraftCache(scope: session.scope).clear() }
        let store = Store(); store.server = origin.absoluteString
        await store.authenticate(email: "tv@example.test", password: "test-password", code: "", name: "", username: "", signup: false)
        XCTAssertNotNil(store.session, store.error ?? "")
        XCTAssertEqual(store.chats.count, 1); XCTAssertEqual(store.models.count, 2)
        return store
    }
    func testLoginFailureAndTwoFactor() async throws {
        _ = try await control(["reset": true, "twoFactor": true])
        let store = Store(); store.server = origin.absoluteString
        await store.authenticate(email: "tv@example.test", password: "wrong", code: "", name: "", username: "", signup: false)
        XCTAssertNil(store.session); XCTAssertEqual(store.error, "Invalid email or password")
        await store.authenticate(email: "tv@example.test", password: "test-password", code: "", name: "", username: "", signup: false)
        XCTAssertNil(store.session); XCTAssertTrue(store.error?.contains("authenticator") == true)
        await store.authenticate(email: "tv@example.test", password: "test-password", code: "123456", name: "", username: "", signup: false)
        XCTAssertNotNil(store.session)
        await store.signOut(); XCTAssertNil(store.session)
    }
    func testSendStreamFollowupAndModelSelection() async throws {
        let store = try await signedIn()
        store.chooseModel("second-model"); XCTAssertFalse(store.agent)
        store.updateDraft("A new conversation"); await store.send()
        XCTAssertNil(store.pending); XCTAssertEqual(store.draft, ""); XCTAssertNotNil(store.selected)
        try await Task.sleep(for: .seconds(3)); await store.refreshSelected()
        XCTAssertEqual(store.selected?.turns.last?.status, "completed")
        XCTAssertTrue(store.selected?.turns.last?.text.contains("A new conversation") == true)
        store.updateDraft("Continue this"); await store.send()
        XCTAssertEqual(store.selected?.turns.count, 2)
        let calls = try await control()["calls"].array
        XCTAssertEqual(calls.first { $0["path"] == "/api/chats/start" }?["body"]["response"]["modelId"], "second-model")
        await store.signOut()
    }
    func testDroppedAcknowledgementRetriesWithoutDuplicate() async throws {
        let store = try await signedIn(); _ = try await control(["mode": "drop-after-accept"])
        store.updateDraft("Only once"); await store.send()
        let pending = try XCTUnwrap(store.pending)
        XCTAssertEqual(store.draft, "Only once")
        await store.retrySend()
        XCTAssertNil(store.pending); XCTAssertEqual(store.selectedID, pending.chatID)
        let result = try await control()
        XCTAssertEqual(result["chats"].array.filter { $0["title"] == "Only once" }.count, 1)
        let sends = result["calls"].array.filter { $0["path"] == "/api/chats/start" }
        XCTAssertGreaterThanOrEqual(sends.count, 2)
        XCTAssertTrue(sends.allSatisfy { $0["key"].string == pending.key })
        await store.signOut()
    }
    func testDraftSwitchingAndTemporaryIsolation() async throws {
        let store = try await signedIn()
        store.updateDraft("New draft"); await store.select(store.chats[0]); store.updateDraft("Saved chat draft")
        await store.select(nil); XCTAssertEqual(store.draft, "New draft")
        store.setTemporary(true); store.updateDraft("Private draft")
        await store.select(store.chats[0]); XCTAssertEqual(store.draft, "Saved chat draft")
        await store.select(nil); XCTAssertEqual(store.draft, "New draft")
        let cache = DraftCache(scope: try XCTUnwrap(store.session).scope)
        XCTAssertFalse(cache.load().values.contains { $0.text == "Private draft" })
        await store.signOut(); XCTAssertTrue(cache.load().isEmpty)
    }
    func testQueueStopAndRemove() async throws {
        let store = try await signedIn(); _ = try await control(["mode": "slow"])
        store.updateDraft("First"); await store.send(); XCTAssertEqual(store.selected?.turns.last?.status, "in_progress")
        store.updateDraft("Later"); await store.send(); XCTAssertEqual(store.selected?.queue.count, 1)
        let chat = try XCTUnwrap(store.selected), queued = try XCTUnwrap(chat.queue.first)
        _ = await store.mutate("/api/chats/\(chat.id)/queued-messages/\(queued.id)", method: "DELETE")
        XCTAssertEqual(store.selected?.queue.count, 0)
        await store.stop(); XCTAssertEqual(store.selected?.turns.last?.status, "cancelled")
        await store.signOut()
    }
    func testLibrarySearchMutationsAndTrash() async throws {
        let store = try await signedIn(); let chat = store.chats[0]
        store.search = "coast"; await store.runSearch(); XCTAssertEqual(store.searchResults.count, 1)
        await store.select(chat)
        await store.patchChat(["title": "Renamed", "pinned": true, "folderId": "22222222-2222-4222-8222-222222222222"])
        XCTAssertEqual(store.selected?.title, "Renamed"); XCTAssertTrue(store.selected?.pinned == true)
        XCTAssertNotNil(store.selected?.folderID)
        let copy = await store.mutate("/api/chats/\(chat.id)/duplicate", idempotent: true)
        XCTAssertEqual(copy?["title"], "Renamed copy")
        await store.select(nil)
        _ = await store.mutate("/api/chats/\(chat.id)", method: "DELETE")
        XCTAssertFalse(store.chats.contains { $0.id == chat.id })
        _ = await store.mutate("/api/chats/\(chat.id)/recover")
        XCTAssertTrue(store.chats.contains { $0.id == chat.id })
        await store.signOut()
    }
    func testRealtimeUpdatesAndSessionRevocation() async throws {
        let store = try await signedIn()
        try await Task.sleep(for: .seconds(1))
        _ = try await control(["externalTitle": "Updated on iPad"])
        try await Task.sleep(for: .seconds(2))
        XCTAssertEqual(store.chats.first?.title, "Updated on iPad")
        _ = try await control(["expire": true])
        await store.reload()
        XCTAssertNil(store.session); XCTAssertTrue(store.chats.isEmpty)
        XCTAssertEqual(store.error, "Sign in again.")
    }
    func testRegenerationAndBranchActivation() async throws {
        let store = try await signedIn(); await store.select(store.chats[0])
        let original = try XCTUnwrap(store.selected?.turns[0])
        await store.regenerate(original)
        XCTAssertEqual(store.selected?.turns.count, 1)
        XCTAssertNotEqual(store.selected?.turns[0].id, original.id)
        XCTAssertEqual(store.selected?.turns[0].branches.count, 2)
        _ = await store.mutate("/api/messages/\(original.id)/activate")
        XCTAssertEqual(store.selected?.turns[0].id, original.id)
        await store.signOut()
    }
    func testFolderSettingsProfileAndSharingContracts() async throws {
        let store = try await signedIn()
        let id = UUID().uuidString.lowercased()
        _ = await store.mutate("/api/folders", body: ["clientId": .string(id), "name": "Trips"])
        XCTAssertTrue(store.folders.contains { $0.id == id })
        _ = await store.mutate("/api/folders/\(id)", method: "PATCH", body: ["name": "Journeys"])
        XCTAssertEqual(store.folders.first { $0.id == id }?["name"], "Journeys")
        await store.select(store.chats[0]); await store.patchChat(["folderId": .string(id)])
        _ = await store.mutate("/api/folders/\(id)", method: "DELETE")
        XCTAssertNil(store.selected?.folderID)
        await store.updateSettings(["theme": "light", "showReasoning": false])
        XCTAssertEqual(store.settings["theme"], "light"); XCTAssertFalse(store.settings["showReasoning"].bool)
        let link = await store.mutate("/api/chat-shares", body: ["chatId": .string(store.chats[0].id), "expiresAt": nil], idempotent: true)
        XCTAssertEqual(link?["token"], "fixture-public-share")
        await store.signOut()
    }
    func testEditUsesInputResourceAndPreservesOtherTurns() async throws {
        let store = try await signedIn(); await store.select(store.chats[0])
        let original = try XCTUnwrap(store.selected?.turns[0])
        _ = await store.mutate("/api/messages/\(API.resource(original.id + ":input"))", method: "PATCH", body: ["clientId": .string(UUID().uuidString.lowercased()), "content": "Edited prompt", "modelId": .string(store.modelID), "presetSelections": [:], "agentMode": false, "timeZone": "America/New_York"])
        XCTAssertEqual(store.selected?.turns.last?.prompt, "Edited prompt")
        XCTAssertEqual(store.selected?.turns.count, 1)
        await store.signOut()
    }
    func testSlowChatCannotOverwriteNewChat() async throws {
        let store = try await signedIn(); _ = try await control(["mode": "slow-read"])
        let loading = Task { await store.select(store.chats[0]) }
        try await Task.sleep(for: .milliseconds(40))
        await store.select(nil)
        await loading.value
        XCTAssertNil(store.selected); XCTAssertNil(store.selectedID); XCTAssertFalse(store.chatLoading)
        await store.signOut()
    }
    func testFailedResponseAndOfflineSignOut() async throws {
        let store = try await signedIn(); _ = try await control(["mode": "response-failure"])
        store.updateDraft("Fail this response"); await store.send()
        try await Task.sleep(for: .seconds(3)); await store.refreshSelected()
        XCTAssertEqual(store.selected?.turns.last?.status, "failed")
        XCTAssertEqual(store.selected?.turns.last?.failure, "The model could not respond.")
        _ = try await control(["mode": "offline"])
        await store.signOut()
        XCTAssertNil(store.session); XCTAssertTrue(store.chats.isEmpty); XCTAssertNil(try SessionVault.load())
    }

    func testSecurityFailureKeepsValidSessionAndDeletionClearsIt() async throws {
        let store = try await signedIn()
        let changed = await store.securityRequest("/api/me/password", method: "POST", body: ["currentPassword": "wrong", "newPassword": "new-password"])
        XCTAssertFalse(changed); XCTAssertNotNil(store.session); XCTAssertEqual(store.error, "Incorrect password")
        let deleted = await store.securityRequest("/api/me", method: "DELETE", body: ["currentPassword": "test-password"], endsSession: true)
        XCTAssertTrue(deleted); XCTAssertNil(store.session); XCTAssertNil(try SessionVault.load())
    }

}
