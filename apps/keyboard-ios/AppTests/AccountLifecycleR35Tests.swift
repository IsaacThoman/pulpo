import Foundation
import KeyboardCore
import PulpoServices
import XCTest
@testable import PulpoKeyboard

/// Real URLSession/PulpoClient encoding and decoding, with explicitly released HTTP responses.
nonisolated final class AccountHTTPGate: @unchecked Sendable {
  struct Pending: @unchecked Sendable {
    let transport: AccountURLProtocol
    let request: URLRequest
  }
  private let lock = NSLock()
  private var pending: [Pending] = []
  private var history: [String] = []
  private struct Record {
    let transport: AccountURLProtocol
    let method: String
    let host: String
    let path: String
    var reserved = false
    var released = false
    var cancelled = false
  }
  private var records: [ObjectIdentifier: Record] = [:]
  private var order: [ObjectIdentifier] = []
  func enqueue(_ transport: AccountURLProtocol) {
    lock.lock(); defer { lock.unlock() }
    pending.append(Pending(transport: transport, request: transport.request))
    let key = ObjectIdentifier(transport)
    records[key] = Record(transport: transport, method: transport.request.httpMethod ?? "?", host: transport.request.url!.host()!, path: transport.request.url!.path)
    order.append(key)
    history.append("request \(transport.request.httpMethod ?? "?") \(transport.request.url!.host()!)\(transport.request.url!.path)")
  }
  func take(host: String, path: String) -> Pending? {
    lock.lock(); defer { lock.unlock() }
    guard let i = pending.firstIndex(where: { $0.request.url?.host() == host && $0.request.url?.path == path }) else { return nil }
    let value = pending.remove(at: i)
    records[ObjectIdentifier(value.transport)]?.reserved = true
    return value
  }
  func reset() { lock.lock(); defer { lock.unlock() }; pending.removeAll(); history.removeAll(); records.removeAll(); order.removeAll() }
  func cancelled(_ transport: AccountURLProtocol) {
    lock.lock(); defer { lock.unlock() }; records[ObjectIdentifier(transport)]?.cancelled = true
  }
  func released(_ transport: AccountURLProtocol) {
    lock.lock(); defer { lock.unlock() }; records[ObjectIdentifier(transport)]?.released = true
  }
  var dispositions: [[String: Any]] {
    lock.lock(); defer { lock.unlock() }
    return order.enumerated().map { index, key in
      let r = records[key]!
      return ["sequence": index, "method": r.method, "host": r.host, "path": r.path,
              "reserved": r.reserved, "released": r.released, "cancelled": r.cancelled]
    }
  }
  var counts: [String: Int] {
    lock.lock(); defer { lock.unlock() }
    return records.values.reduce(into: [:]) { $0["HTTP \($1.method) \($1.path)", default: 0] += 1 }
  }
  var unaccountedCount: Int {
    lock.lock(); defer { lock.unlock() }; return records.values.filter { !$0.released && !$0.cancelled }.count
  }
  var trace: [String] { lock.lock(); defer { lock.unlock() }; return history }
}

nonisolated final class AccountURLProtocol: URLProtocol, @unchecked Sendable {
  static let gate = AccountHTTPGate()
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { Self.gate.enqueue(self) }
  private let stateLock = NSLock()
  private var stopped = false
  override func stopLoading() { stateLock.lock(); stopped = true; stateLock.unlock(); Self.gate.cancelled(self) }
  var isStopped: Bool { stateLock.lock(); defer { stateLock.unlock() }; return stopped }
  func respond(status: Int, body: String) {
    Self.gate.released(self)
    guard !isStopped else { return }
    client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data(body.utf8))
    client?.urlProtocolDidFinishLoading(self)
  }
}

@MainActor
final class AccountLifecycleR35Tests: XCTestCase {
  private let config = #"{"instance":{"name":"R35 fake"},"capabilities":{"dictation":true}}"#
  private func auth(_ name: String) -> String {
    #"{"user":{"id":"\#(name)","name":"\#(name)","email":"fake@example.invalid"},"session":{"token":"fake-\#(name)","expiresAt":"2099-01-01"}}"#
  }
  private func request(_ host: String, _ path: String) async throws -> AccountHTTPGate.Pending {
    for _ in 0..<2000 {
      if let request = AccountURLProtocol.gate.take(host: host, path: path) { return request }
      try await Task.sleep(for: .milliseconds(1))
    }
    throw NSError(domain: "R35 missing request \(host)\(path)", code: 1)
  }
  private func response(_ host: String, _ path: String, status: Int = 200, body: String) async throws {
    for _ in 0..<2000 {
      if let request = AccountURLProtocol.gate.take(host: host, path: path) {
        request.transport.respond(status: status, body: body)
        return
      }
      try await Task.sleep(for: .milliseconds(1))
    }
    throw NSError(domain: "R35 missing request \(host)\(path)", code: 1)
  }
  private func model() -> (AppModel, SessionStore, UserDefaults, URLSession) {
    let id = "r35.\(UUID().uuidString)"
    let store = SessionStore(service: id)
    let defaults = UserDefaults(suiteName: id)!
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [AccountURLProtocol.self]
    let network = URLSession(configuration: configuration)
    return (AppModel(sessionStore: store, accountDefaults: defaults, accountURLSession: network), store, defaults, network)
  }
  private func login(_ model: AppModel, host: String, name: String) async throws {
    let task = Task { try await model.signIn(instance: "https://\(host)", email: "fake@example.invalid", password: "fake-password", twoFactorCode: nil) }
    try await response(host, "/api/mobile/config", body: config)
    try await response(host, "/api/mobile/auth/login", body: auth(name))
    try await task.value
  }

  private func settle(_ predicate: () -> Bool) async throws {
    for _ in 0..<2000 {
      if predicate() { return }
      try await Task.sleep(for: .milliseconds(1))
    }
    XCTFail("Presentation did not settle")
  }

  #if !R35_BASELINE
  func testDevelopmentPresentationCancellationBeforeTaskStartThenRetry() async throws {
    let (model, store, defaults, network) = model()
    defer { store.clear(); defaults.removeObject(forKey: "accountSnapshot"); network.invalidateAndCancel() }
    let flow = SignInAttempt()
    flow.instance = "https://prestart-old.r35.invalid"
    flow.email = "fake@example.invalid"; flow.password = "fake-password"
    var successes = 0
    flow.submit(using: model) { successes += 1 }
    flow.cancel()
    flow.instance = "https://prestart-new.r35.invalid"
    flow.submit(using: model) { successes += 1 }
    try await response("prestart-new.r35.invalid", "/api/mobile/config", body: config)
    try await response("prestart-new.r35.invalid", "/api/mobile/auth/login", body: auth("Retry"))
    try await settle { !flow.working }
    XCTAssertEqual(successes, 1)
    XCTAssertNil(flow.error)
    XCTAssertEqual(store.load()?.user.name, "Retry")
    XCTAssertEqual(AccountSnapshot.load(defaults: defaults).displayName, "Retry")
    XCTAssertFalse(AccountURLProtocol.gate.trace.contains { $0.contains("prestart-old.r35.invalid") })
  }

  func testDevelopmentTwoFactorBackAndCredentialEditResetChallenge() async throws {
    let (model, store, defaults, network) = model()
    defer { store.clear(); defaults.removeObject(forKey: "accountSnapshot"); network.invalidateAndCancel() }
    let flow = SignInAttempt()
    flow.instance = "https://twofactor.r35.invalid"
    flow.email = "fake@example.invalid"; flow.password = "fake-password"
    let challenge = #"{"error":{"code":"two_factor_required","message":"Enter fake code"}}"#
    flow.submit(using: model) { XCTFail("Challenge is not a login success") }
    try await response("twofactor.r35.invalid", "/api/mobile/config", body: config)
    try await response("twofactor.r35.invalid", "/api/mobile/auth/login", status: 401, body: challenge)
    try await settle { !flow.working }
    XCTAssertTrue(flow.needsCode)
    XCTAssertNil(flow.error)
    flow.code = "bad-fake-code"
    flow.submit(using: model) { XCTFail("Invalid code is not a login success") }
    try await response("twofactor.r35.invalid", "/api/mobile/config", body: config)
    try await response("twofactor.r35.invalid", "/api/mobile/auth/login", status: 401, body: challenge)
    try await settle { !flow.working }
    XCTAssertEqual(flow.error, "Enter fake code")
    flow.backToCredentials()
    XCTAssertFalse(flow.needsCode); XCTAssertEqual(flow.code, ""); XCTAssertNil(flow.error)
    flow.submit(using: model) { XCTFail("Challenge is not a login success") }
    try await response("twofactor.r35.invalid", "/api/mobile/config", body: config)
    try await response("twofactor.r35.invalid", "/api/mobile/auth/login", status: 401, body: challenge)
    try await settle { !flow.working }
    flow.code = "fake-code"
    flow.instance = "https://edited.r35.invalid"
    XCTAssertFalse(flow.needsCode); XCTAssertEqual(flow.code, ""); XCTAssertNil(flow.error)
    var succeeded = false
    flow.submit(using: model) { succeeded = true }
    try await response("edited.r35.invalid", "/api/mobile/config", body: config)
    try await response("edited.r35.invalid", "/api/mobile/auth/login", body: auth("Edited"))
    try await settle { !flow.working }
    XCTAssertTrue(succeeded)
    XCTAssertEqual(store.load()?.instance.host(), "edited.r35.invalid")
  }

  func testDevelopmentSignOutSuppressesLatePresentationError() async throws {
    let (model, store, defaults, network) = model()
    defer { store.clear(); defaults.removeObject(forKey: "accountSnapshot"); network.invalidateAndCancel() }
    let flow = SignInAttempt()
    flow.instance = "https://late-error.r35.invalid"
    flow.email = "fake@example.invalid"; flow.password = "fake-password"
    flow.submit(using: model) { XCTFail("Revoked login cannot dismiss a newer presentation") }
    try await response("late-error.r35.invalid", "/api/mobile/config", body: config)
    let pending = try await request("late-error.r35.invalid", "/api/mobile/auth/login")
    model.signOut(remote: false)
    pending.transport.respond(status: 401, body: #"{"error":{"code":"two_factor_required","message":"Late fake challenge"}}"#)
    try await settle { !flow.working }
    XCTAssertFalse(flow.needsCode)
    XCTAssertNil(flow.error)
    XCTAssertNil(store.load())
    XCTAssertEqual(AccountSnapshot.load(defaults: defaults), .signedOut)
  }
  #endif

  func testDevelopmentSignOutWhileLoginPending() async throws {
    let (model, store, defaults, network) = model()
    defer { store.clear(); defaults.removeObject(forKey: "accountSnapshot"); network.invalidateAndCancel() }
    let task = Task { try await model.signIn(instance: "https://signout.r35.invalid", email: "fake@example.invalid", password: "fake-password", twoFactorCode: nil) }
    try await response("signout.r35.invalid", "/api/mobile/config", body: config)
    let pending = try await request("signout.r35.invalid", "/api/mobile/auth/login")
    // The login request has been issued; explicit sign-out revokes its local authority.
    model.signOut(remote: false)
    pending.transport.respond(status: 200, body: auth("Abandoned"))
    _ = try? await task.value
    XCTAssertNil(model.session)
    XCTAssertNil(store.load())
    XCTAssertEqual(AccountSnapshot.load(defaults: defaults), .signedOut)
  }

  func testDevelopmentLateRefreshCannotResurrectSignedOutAccount() async throws {
    let (model, store, defaults, network) = model()
    defer { store.clear(); defaults.removeObject(forKey: "accountSnapshot"); network.invalidateAndCancel() }
    try await login(model, host: "refresh.r35.invalid", name: "Old")
    let refresh = Task { await model.refreshAccount() }
    try await response("refresh.r35.invalid", "/api/mobile/config", body: config)
    model.signOut(remote: false)
    try await response("refresh.r35.invalid", "/api/mobile/me", body: #"{"user":{"id":"Old","name":"Refreshed"}}"#)
    await refresh.value
    XCTAssertNil(model.session)
    XCTAssertNil(store.load())
    XCTAssertEqual(AccountSnapshot.load(defaults: defaults), .signedOut)
  }

  func testDevelopmentLateUnauthorizedRefreshCannotSignOutReplacement() async throws {
    let (model, store, defaults, network) = model()
    defer { store.clear(); defaults.removeObject(forKey: "accountSnapshot"); network.invalidateAndCancel() }
    try await login(model, host: "old.r35.invalid", name: "Old")
    let refresh = Task { await model.refreshAccount() }
    try await response("old.r35.invalid", "/api/mobile/config", body: config)
    try await login(model, host: "new.r35.invalid", name: "New")
    try await response("old.r35.invalid", "/api/mobile/me", status: 401, body: #"{"error":{"code":"unauthorized","message":"Fake expired session"}}"#)
    await refresh.value
    XCTAssertEqual(model.session?.user.name, "New")
    XCTAssertEqual(store.load()?.user.name, "New")
    XCTAssertEqual(AccountSnapshot.load(defaults: defaults).displayName, "New")
  }
}
