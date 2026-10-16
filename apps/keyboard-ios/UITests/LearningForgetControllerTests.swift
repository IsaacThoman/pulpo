import UIKit
import XCTest
import SQLite3
@testable import KeyboardUI

/// EXPOSED integration through the real controller and canonical persistence.
/// Uses the existing harness, not a source copy or replacement forget callback.
@MainActor
final class LearningForgetControllerTests: XCTestCase {
  private final class Host: KeyboardHost {
    let proxy = SimulatedProxy(text: "I want beau")
    lazy var document: TextDocument = ProxyDocument(proxy: proxy)
    var inputTraits = InputTraits()
    let hasFullAccess = true
    let needsInputModeSwitchKey = false
    let isInsideApp = true
    func advanceToNextInputMode() {}
    func handleInputModeList(from view: UIView, with event: UIEvent) {}
    func adjustTextPosition(byCharacterOffset offset: Int) { proxy.adjustTextPosition(byCharacterOffset: offset) }
    func openApp(_ url: URL) {}
  }
  private func notice(_ bar: SuggestionBarView) throws -> UIView {
    try XCTUnwrap(bar.subviews.first { $0.accessibilityIdentifier == "notice" })
  }
  private func button(_ id: String, in view: UIView) throws -> UIButton {
    try XCTUnwrap(view.subviews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == id })
  }

  func testRealCanonicalSQLiteBusyShowsNoticeAndExplicitRetryConfirmsRemoval() throws {
    KeyboardResources.directory = ControllerHarness.languageData
    let host = Host()
    let bridgeDirectory = FileManager.default.temporaryDirectory.appendingPathComponent("r41-bridge-\(UUID())")
    let suite = "R41ForgetBridge.\(UUID())"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    let bridge = try XCTUnwrap(DictationBridge(containerURL: bridgeDirectory, defaults: defaults))
    defer { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: bridgeDirectory) }
    let controller = KeyboardController(host: host, dictationBridge: bridge)
    controller.hostWillAppear()
    defer { controller.hostDidDisappear() }
    controller.rootView.frame = CGRect(x: 0, y: 0, width: 402, height: controller.preferredHeight)
    let personal = try XCTUnwrap(controller.stack?.personal)
    XCTAssertTrue(personal.clear(), "Reset this owned fixture, including any previous explicit block")
    controller.engine.refreshSuggestions()
    controller.documentDidChange()
    RunLoop.main.run(until: Date().addingTimeInterval(0.03))
    let bar = controller.rootView.bar
    let suggestion = try XCTUnwrap(bar.suggestions.first { $0.text == "beautiful" })
    XCTAssertTrue(personal.pin(suggestion.text))
    XCTAssertTrue(personal.save())
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    let url = try XCTUnwrap(AppGroup.personalDictionaryURL(fallback: support))
    // Verify this is the controller's actual authority before locking anything.
    XCTAssertEqual(PersonalDictionary(url: url).count(of: suggestion.text), 1)
    let database = LearnedDataPersistence.storageURL(for: url)
    XCTAssertTrue(database.lastPathComponent == "PersonalDictionary.json.learning-v2.sqlite")
    var connection: OpaquePointer?
    XCTAssertEqual(sqlite3_open(database.path, &connection), SQLITE_OK)
    let db = try XCTUnwrap(connection)
    defer { sqlite3_close(db) }
    XCTAssertEqual(sqlite3_exec(db, "BEGIN IMMEDIATE", nil, nil, nil), SQLITE_OK)
    var locked = true
    defer { if locked { sqlite3_exec(db, "ROLLBACK", nil, nil, nil) } }

    let originalDocument = host.proxy.host
    let originalReported = host.proxy.reported
    let originalEdits = host.proxy.sentEdits
    let originalSuggestions = bar.suggestions
    let panel = controller.rootView.dictation
    let state = DictationPanelState.message(title: "Transcript ready", detail: "café 👩🏽‍💻", action: "Insert Here")
    panel.set(state)
    var actions = 0, cancels = 0, stops = 0
    panel.onAction = { actions += 1 }
    panel.onCancel = { cancels += 1 }
    panel.onStop = { stops += 1 }
    let mode = controller.rootView.mode
    let priorPending = bridge.pendingRequest
    let pending = UUID()
    bridge.pendingRequest = pending
    defer { bridge.pendingRequest = priorPending }

    bar.offerToForget(suggestion)
    let message = try notice(bar)
    try button("notice-action", in: message).sendActions(for: .touchUpInside)
    XCTAssertEqual(personal.persistenceResult, .busy, "Exercise an actual false forget, not a callback substitute")
    XCTAssertTrue(bar.isShowingNotice)
    XCTAssertEqual(message.subviews.compactMap { $0 as? UILabel }.first?.text, "Couldn't confirm removal. Try again.")
    XCTAssertTrue(try button("notice-action", in: message).isHidden)
    XCTAssertEqual(bar.suggestions, originalSuggestions)
    XCTAssertEqual(host.proxy.host, originalDocument)
    XCTAssertEqual(host.proxy.reported, originalReported)
    XCTAssertEqual(host.proxy.sentEdits, originalEdits)
    XCTAssertTrue(host.proxy.outbox.isEmpty)
    XCTAssertEqual(panel.state, state)
    XCTAssertEqual(controller.rootView.mode, mode)
    XCTAssertEqual(bridge.pendingRequest, pending)
    panel.onAction?(); panel.onCancel?(); panel.onStop?()
    XCTAssertEqual(actions, 1); XCTAssertEqual(cancels, 1); XCTAssertEqual(stops, 1)
    let dismiss = try button("notice-dismiss", in: message)
    XCTAssertEqual(dismiss.accessibilityLabel, "Dismiss")
    // Native AX visibility/hittability is checked in LearningForgetResultUITests.
    dismiss.sendActions(for: .touchUpInside)
    XCTAssertFalse(bar.isShowingNotice)
    XCTAssertEqual(personal.persistenceResult, .busy, "Dismiss must not retry")

    XCTAssertEqual(sqlite3_exec(db, "ROLLBACK", nil, nil, nil), SQLITE_OK)
    locked = false
    bar.offerToForget(suggestion)
    try button("notice-action", in: message).sendActions(for: .touchUpInside)
    XCTAssertEqual(personal.persistenceResult, .ok)
    XCTAssertTrue(personal.isBlocked(suggestion.text))
    XCTAssertTrue(PersonalDictionary(url: url).isBlocked(suggestion.text))
    XCTAssertEqual(PersonalDictionary(url: url).count(of: suggestion.text), 0)
    XCTAssertFalse(bar.isShowingNotice)
    RunLoop.main.run(until: Date().addingTimeInterval(0.03)) // Production bar updates are scheduled.
    XCTAssertFalse(bar.suggestions.contains { $0.text == suggestion.text })
    XCTAssertEqual(host.proxy.host, originalDocument)
    XCTAssertEqual(host.proxy.reported, originalReported)
    XCTAssertEqual(panel.state, state)
    XCTAssertEqual(controller.rootView.mode, mode)
    XCTAssertEqual(bridge.pendingRequest, pending)
  }
}
