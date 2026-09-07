import XCTest
@testable import PulpoShortcutsCore

private final class StubProtocol: URLProtocol {
  static var handler: ((URLRequest) throws -> (Int, Data))?
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() {
    do {
      let (status, data) = try Self.handler!(request)
      client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch { client?.urlProtocol(self, didFailWithError: error) }
  }
  override func stopLoading() {}
}

final class ShortcutsCoreTests: XCTestCase {
  func testNavigationRetainsEarlyRequestsAndDrainsOnce() {
    _ = ShortcutNavigationInbox.takePending()
    for n in 0..<20 { ShortcutNavigationInbox.enqueue("pulpo://shortcuts?requestId=\(n)") }
    ShortcutNavigationInbox.enqueue("pulpo://shortcuts?requestId=19")
    let pending = ShortcutNavigationInbox.takePending()
    XCTAssertEqual(pending.count, 16)
    XCTAssertEqual(pending.first, "pulpo://shortcuts?requestId=4")
    XCTAssertEqual(pending.last, "pulpo://shortcuts?requestId=19")
    XCTAssertTrue(ShortcutNavigationInbox.takePending().isEmpty)
  }
  let model = "provider/model:version"
  let chat = "00000000-0000-4000-8000-000000000002"
  let response = "00000000-0000-4000-8000-000000000003"
  func session(_ user: String = "user") throws -> ShortcutSession { try ShortcutSession(origin: "https://pulpo.test", userID: user, token: "test-token") }
  func api(assertCurrent: @escaping @Sendable (ShortcutSession) throws -> Void = { _ in }) throws -> ShortcutsAPI {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubProtocol.self]
    return try ShortcutsAPI(session: session(), transport: URLSession(configuration: config), assertCurrent: assertCurrent)
  }
  func data(_ value: String) -> Data { Data(value.utf8) }
  func snapshot(_ status: String = "completed", output: String = #"[{"type":"message","content":[{"type":"output_text","text":"Hello"}]}]"#) throws -> ShortcutSnapshot {
    try JSONDecoder().decode(ShortcutSnapshot.self, from: data("{\"responseId\":\"\(response)\",\"status\":\"\(status)\",\"output\":\(output)}"))
  }
  func chatJSON(busy: Bool = false, temporary: Bool = false) -> String {
    "{\"id\":\"\(chat)\",\"title\":\"Test\",\"modelId\":\"\(model)\",\"temporary\":\(temporary),\"activeBranchLeafId\":\"\(response)\",\"responses\":[{\"id\":\"\(response)\",\"status\":\"\(busy ? "in_progress" : "completed")\"}]}"
  }
  func body(_ request: URLRequest) throws -> [String: Any] {
    if let data = request.httpBody { return try JSONSerialization.jsonObject(with: data) as! [String: Any] }
    let stream = request.httpBodyStream!; stream.open(); defer { stream.close() }
    var bytes = Data(); var buffer = [UInt8](repeating: 0, count: 4096)
    while stream.hasBytesAvailable { let n = stream.read(&buffer, maxLength: buffer.count); if n <= 0 { break }; bytes.append(buffer, count: n) }
    return try JSONSerialization.jsonObject(with: bytes) as! [String: Any]
  }
  func testOriginValidationAndAccountBinding() throws {
    for origin in ["https://user:secret@pulpo.test", "file:///tmp", "https://pulpo.test/path", "https://pulpo.test?token=secret"] {
      XCTAssertThrowsError(try ShortcutSession(origin: origin, userID: "u", token: "t"))
    }
    let current = try session()
    XCTAssertEqual(try current.resourceID(current.entityID(chat)), chat)
    XCTAssertThrowsError(try session("other").resourceID(current.entityID(chat)))
    XCTAssertThrowsError(try current.resourceID("invalid"))
    XCTAssertEqual(try current.resourceID(current.entityID(model)), model)
    XCTAssertFalse(current.scope.contains("user"))
  }
  func testPromptValidation() throws {
    XCTAssertEqual(try ShortcutsAPI.prompt("  hello\n"), "hello")
    XCTAssertThrowsError(try ShortcutsAPI.prompt(" \n"))
    XCTAssertThrowsError(try ShortcutsAPI.prompt(String(repeating: "a", count: 100_001)))
  }
  func testExtractsOnlyReplyTextAndRefusals() throws {
    let result = try snapshot(output: #"[{"type":"reasoning","content":[{"type":"output_text","text":"secret reasoning"}]},{"type":"message","content":[{"type":"output_text","text":"First"},{"type":"refusal","refusal":"Cannot do that"},{"type":"image","text":"skip"}]},{"type":"message","content":[{"type":"output_text","text":"Last"}]}]"#)
    XCTAssertEqual(try result.reply(), "First\nCannot do that\nLast")
    for status in ["queued", "in_progress", "failed", "cancelled", "incomplete"] { XCTAssertThrowsError(try snapshot(status).reply()) }
    XCTAssertThrowsError(try snapshot(output: "[]").reply())
  }
  func testStartUsesAtomicEndpointAndIdempotency() async throws {
    var posts = 0
    StubProtocol.handler = { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer test-token")
      if request.url!.path == "/api/models" { return (200, self.data("{\"data\":[{\"id\":\"\(self.model)\",\"name\":\"Model\",\"provider\":{\"name\":\"Provider\"}}]}")) }
      XCTAssertEqual(request.url!.path, "/api/chats/start")
      let body = try self.body(request)
      let response = body["response"] as! [String: Any]
      XCTAssertEqual(response["input"] as? String, "Hello")
      XCTAssertEqual(response["clientId"] as? String, request.value(forHTTPHeaderField: "Idempotency-Key"))
      XCTAssertEqual(response["agentMode"] as? Bool, false)
      XCTAssertEqual((body["chat"] as! [String: Any])["temporary"] as? Bool, true)
      posts += 1
      return (202, self.data("{\"chat\":\(self.chatJSON()),\"response\":{\"responseId\":\"\(self.response)\",\"status\":\"queued\",\"output\":[]}}"))
    }
    _ = try await api().start(prompt: " Hello ", modelEntityID: session().entityID(model), temporary: true)
    XCTAssertEqual(posts, 1)
  }
  func testSavedChatsHonorAccountExpirationPreference() async throws {
    StubProtocol.handler = { request in
      switch request.url!.path {
      case "/api/models": return (200, self.data("{\"data\":[{\"id\":\"\(self.model)\",\"name\":\"Model\",\"provider\":{\"name\":\"Provider\"}}]}"))
      case "/api/settings": return (200, self.data(#"{"values":{"newChatAutoExpire":true}}"#))
      default:
        let body = try self.body(request)
        XCTAssertEqual((body["chat"] as! [String: Any])["autoExpire"] as? Bool, true)
        return (202, self.data("{\"chat\":\(self.chatJSON()),\"response\":{\"responseId\":\"\(self.response)\",\"status\":\"queued\",\"output\":[]}}"))
      }
    }
    _ = try await api().start(prompt: "Hello", modelEntityID: session().entityID(model))
  }
  func testContinueUsesActiveBranchAndChatModel() async throws {
    StubProtocol.handler = { request in
      if request.httpMethod != "POST" { return (200, self.data(self.chatJSON())) }
      let body = try self.body(request)
      XCTAssertEqual(body["parentResponseId"] as? String, self.response)
      XCTAssertEqual(body["modelId"] as? String, self.model)
      XCTAssertEqual(request.url!.path, "/api/chats/\(self.chat)/responses")
      return (202, self.data("{\"response\":{\"responseId\":\"\(self.response)\",\"status\":\"queued\",\"output\":[]}}"))
    }
    _ = try await api().continueChat(session().entityID(chat), prompt: "Follow up")
  }
  func testRejectsBusyAndTemporaryChatsBeforeSending() async throws {
    for temporary in [false, true] {
      StubProtocol.handler = { request in
        XCTAssertEqual(request.httpMethod, "GET")
        return (200, self.data(self.chatJSON(busy: !temporary, temporary: temporary)))
      }
      do { _ = try await api().continueChat(session().entityID(chat), prompt: "Follow up"); XCTFail("Must not send") }
      catch { XCTAssertTrue(error is ShortcutFailure) }
    }
  }
  func testPollingCompletesWithoutResubmitting() async throws {
    var calls = 0
    StubProtocol.handler = { request in
      calls += 1
      XCTAssertEqual(request.httpMethod, "GET")
      XCTAssertEqual(request.url!.path, "/api/responses/\(self.response)")
      return (200, self.data("{\"responseId\":\"\(self.response)\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Done\"}]}]}"))
    }
    let reply = try await api().waitForReply(snapshot("queued"), pollNanoseconds: 1)
    XCTAssertEqual(reply, "Done"); XCTAssertEqual(calls, 1)
  }
  func testTimeoutDoesNotResubmitOrCancel() async throws {
    StubProtocol.handler = { _ in XCTFail("No request expected"); return (500, Data()) }
    do { _ = try await api().waitForReply(snapshot("queued"), timeout: 0); XCTFail("Expected timeout") }
    catch { XCTAssertTrue(error.localizedDescription.contains("still running")) }
  }
  func testExpiredSessionAndMissingChatErrors() async throws {
    for status in [401, 404, 410, 429] {
      StubProtocol.handler = { _ in (status, self.data(#"{"error":{"message":"Rate limited"}}"#)) }
      do { _ = try await api().chat(session().entityID(chat)); XCTFail("Expected failure") }
      catch { XCTAssertTrue(error is ShortcutFailure) }
    }
  }
  func testSessionChangePreventsNetworkAccess() async throws {
    StubProtocol.handler = { _ in XCTFail("No request expected"); return (500, Data()) }
    do { _ = try await api(assertCurrent: { _ in throw ShortcutFailure("Account changed") }).models(); XCTFail("Expected failure") }
    catch { XCTAssertEqual(error.localizedDescription, "Account changed") }
  }
  func testUnknownToolContentDoesNotBreakTextDecoding() throws {
    let result = try snapshot(output: #"[{"type":"function_call_output","content":"opaque tool output"},{"type":"message","content":[{"type":"output_text","text":"Answer"}]}]"#)
    XCTAssertEqual(try result.reply(), "Answer")
  }
  func testAccountChangesDiscardAnInFlightResult() async throws {
    final class State: @unchecked Sendable { var changed = false }
    let state = State()
    StubProtocol.handler = { _ in
      state.changed = true
      return (200, self.data("{\"data\":[]}"))
    }
    do {
      _ = try await api(assertCurrent: { _ in if state.changed { throw ShortcutFailure("Account changed") } }).models()
      XCTFail("The old account result must not be returned")
    } catch { XCTAssertEqual(error.localizedDescription, "Account changed") }
  }
  func testTransportFailureDoesNotRetryAPost() async throws {
    var posts = 0
    StubProtocol.handler = { request in
      if request.httpMethod == "POST" { posts += 1; throw URLError(.networkConnectionLost) }
      return (200, self.data(self.chatJSON()))
    }
    do { _ = try await api().continueChat(session().entityID(chat), prompt: "Follow up"); XCTFail("Expected network error") }
    catch { XCTAssertEqual(posts, 1) }
  }
  func testSearchEncodesInputAndExcludesTemporaryChats() async throws {
    StubProtocol.handler = { request in
      XCTAssertEqual(URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value, "C++ notes & plans")
      XCTAssertTrue(request.url!.absoluteString.contains("C%2B%2B"))
      return (200, self.data("{\"data\":[\(self.chatJSON()),\(self.chatJSON(temporary: true))]}"))
    }
    let results = try await api().chats(query: "C++ notes & plans", limit: 50)
    XCTAssertEqual(results.count, 1)
  }
}
