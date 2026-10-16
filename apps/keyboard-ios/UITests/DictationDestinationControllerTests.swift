import UIKit
import XCTest
@testable import KeyboardUI

/// Runs the actual controller, bridge notifications, proxy adapter and panel
/// buttons. The parent owns running these iOS tests; no microphone/server needed.
@MainActor
final class DictationDestinationControllerTests: XCTestCase {
  @MainActor private final class Host: KeyboardHost {
    let proxy = SimulatedProxy(text: "hello ")
    lazy var document: TextDocument = ProxyDocument(proxy: proxy)
    var inputTraits = InputTraits()
    var hasFullAccess = true
    var needsInputModeSwitchKey: Bool { false }
    var isInsideApp: Bool { true }
    func advanceToNextInputMode() {}
    func handleInputModeList(from view: UIView, with event: UIEvent) {}
    func adjustTextPosition(byCharacterOffset offset: Int) { proxy.adjustTextPosition(byCharacterOffset: offset) }
    func openApp(_ url: URL) {}
  }

  @MainActor private final class Session {
    let host = Host()
    let directory: URL
    let suite = "DictationDestinationControllerTests.\(UUID())"
    let defaults: UserDefaults
    let bridge: DictationBridge
    let controller: KeyboardController

    init() throws {
      directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
      bridge = try XCTUnwrap(DictationBridge(containerURL: directory, defaults: defaults))
      controller = KeyboardController(host: host, dictationBridge: bridge)
      controller.hostWillAppear()
    }

    func start() throws -> UUID {
      let account = AccountSnapshot.load()
      defer { account.save() }
      AccountSnapshot(signedIn: true, displayName: nil, instanceHost: "test.invalid", dictationAvailable: true).save()
      controller.rootView.bar.onMicrophone?()
      let request = try XCTUnwrap(bridge.pendingRequest)
      publish(DictationState(phase: .transcribing, requestID: request))
      return request
    }

    func publish(_ state: DictationState) {
      bridge.writeState(state)
      pump()
    }

    func complete(_ request: UUID, text: String = "spoken words", at: Date = Date()) {
      publish(DictationState(phase: .finished, requestID: request, transcript: text, updatedAt: at))
    }

    func pump() { RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }

    var action: UIButton {
      controller.rootView.dictation.subviews.compactMap { $0 as? UIButton }
        .first { $0.accessibilityIdentifier == "dictation-action" }!
    }

    func applyEdits() { host.proxy.hostApplies() }

    func close() {
      controller.hostDidDisappear()
      defaults.removePersistentDomain(forName: suite)
      try? FileManager.default.removeItem(at: directory)
    }
  }

  func testUnchangedIdentifiedDestinationInsertsOnlyOnce() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.complete(request)
    s.complete(request)
    s.applyEdits()
    XCTAssertEqual(s.host.proxy.host.string, "hello spoken words")
    XCTAssertEqual(s.host.proxy.sentEdits, 1)
    XCTAssertTrue(s.bridge.wasDelivered(request))
    XCTAssertNil(s.bridge.pendingRequest)
  }

  func testBridgeDeliveredStandalonePunctuationAttachesOnce() throws {
    for text in [",", "!", ";", ")", "..."] {
      let s = try Session()
      defer { s.close() }
      s.host.proxy.hostChanges { $0 = SimulatedProxy.State("hello") }
      s.host.proxy.receive()
      s.controller.documentDidChange()
      let request = try s.start()
      s.complete(request, text: text)
      s.complete(request, text: text)
      s.applyEdits()
      XCTAssertEqual(s.host.proxy.host.string, "hello" + text)
      XCTAssertEqual(s.host.proxy.sentEdits, 1)
      XCTAssertTrue(s.bridge.wasDelivered(request))
      XCTAssertNil(s.bridge.pendingRequest)
    }
  }

  func testBridgeDeliveredPunctuationLedTokensKeepTheirSeparator() throws {
    for text in [".NET", ".env", ":)", "!important", "?flag", "’tis"] {
      let s = try Session()
      defer { s.close() }
      s.host.proxy.hostChanges { $0 = SimulatedProxy.State("Use") }
      s.host.proxy.receive()
      s.controller.documentDidChange()
      let request = try s.start()
      s.complete(request, text: text)
      s.complete(request, text: text)
      s.applyEdits()
      XCTAssertEqual(s.host.proxy.host.string, "Use " + text)
      XCTAssertEqual(s.host.proxy.sentEdits, 1)
      XCTAssertTrue(s.bridge.wasDelivered(request))
      XCTAssertNil(s.bridge.pendingRequest)
    }
  }

  func testIdenticalTextInAnotherFieldWaitsForAnActualPanelButtonTap() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.proxy.identifier = UUID()
    s.complete(request)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertEqual(s.bridge.pendingRequest, request)
    XCTAssertFalse(s.bridge.wasDelivered(request))
    XCTAssertFalse(s.action.isHidden)
    XCTAssertEqual(s.action.configuration?.title, "Insert Here")
    let repeatedAction = s.controller.rootView.dictation.onAction
    s.action.sendActions(for: .touchUpInside)
    repeatedAction?()
    s.applyEdits()
    XCTAssertEqual(s.host.proxy.host.string, "hello spoken words")
    XCTAssertEqual(s.host.proxy.sentEdits, 1)
    XCTAssertNil(s.bridge.pendingRequest)
  }

  func testSilentCaretMoveRefusesAutomaticInsertionAtNewCaret() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.proxy.hostChanges { $0.move(by: -6) }
    s.host.proxy.receive() // Proxy changes before any host callback.
    s.complete(request)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    s.action.sendActions(for: .touchUpInside)
    s.applyEdits()
    XCTAssertEqual(s.host.proxy.host.string, "spoken wordshello ")
  }

  func testSelectionPreservesTranscriptUntilCursorIsPlaced() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.proxy.hostChanges { $0.cursor = 0; $0.selection = 5 }
    s.host.proxy.receive()
    s.complete(request)
    XCTAssertTrue(s.action.isHidden)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertFalse(s.bridge.wasDelivered(request))
    XCTAssertEqual(s.bridge.pendingRequest, request)
    s.host.proxy.hostChanges { $0.move(by: 6) }
    s.host.proxy.receive()
    s.controller.documentDidChange()
    XCTAssertFalse(s.action.isHidden)
    s.action.sendActions(for: .touchUpInside)
    s.applyEdits()
    XCTAssertEqual(s.host.proxy.host.string, "hello spoken words")
  }

  func testPrivateDestinationCannotInsertAndRecoveryBecomesUsableInPublicField() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.inputTraits.isSecure = true // Engine has not yet received a callback.
    s.complete(request)
    XCTAssertTrue(s.action.isHidden)
    XCTAssertNil(s.controller.rootView.dictation.onAction)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertEqual(s.bridge.pendingRequest, request)
    s.host.inputTraits.isSecure = false
    s.host.proxy.identifier = UUID()
    s.controller.documentDidChange()
    s.action.sendActions(for: .touchUpInside)
    s.applyEdits()
    XCTAssertEqual(s.host.proxy.host.string, "hello spoken words")
  }

  func testUnknownIdentityAndHiddenContextRequireConfirmation() throws {
    for hiddenContext in [false, true] {
      let s = try Session()
      defer { s.close() }
      if hiddenContext {
        s.host.proxy.host = SimulatedProxy.State()
        s.host.proxy.reported = s.host.proxy.host
        s.host.proxy.emptyAsNil = true
      } else {
        s.host.proxy.identifier = nil
      }
      let request = try s.start()
      s.complete(request)
      XCTAssertEqual(s.host.proxy.sentEdits, 0)
      XCTAssertFalse(s.action.isHidden)
      s.action.sendActions(for: .touchUpInside)
      s.applyEdits()
      XCTAssertEqual(s.host.proxy.host.string, hiddenContext ? "spoken words" : "hello spoken words")
    }
  }

  func testWillChangeInvalidatesMatchingLaggingProxyAndStaleConfirmation() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.controller.documentWillChange() // UIKit has not supplied its new context.
    s.complete(request)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    let staleAction = try XCTUnwrap(s.controller.rootView.dictation.onAction)
    s.controller.documentWillChange()
    staleAction()
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertEqual(s.bridge.pendingRequest, request)
    s.action.sendActions(for: .touchUpInside)
    XCTAssertEqual(s.host.proxy.sentEdits, 1)
  }

  func testDidOnlyCallbackWithLaggingContextStillRequiresConfirmation() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.proxy.hostChanges { $0.move(by: -6) }
    // The host moved, but its proxy still shows the old caret and text.
    s.controller.documentDidChange()
    s.complete(request)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertEqual(s.bridge.pendingRequest, request)
    XCTAssertFalse(s.action.isHidden)
  }

  func testAStaleRecoveryTapCannotFollowAFieldSwitchOrPrivateTraitChange() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.proxy.identifier = UUID()
    s.complete(request)
    let staleAction = try XCTUnwrap(s.controller.rootView.dictation.onAction)
    s.host.proxy.identifier = UUID()
    staleAction()
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    let publicAction = try XCTUnwrap(s.controller.rootView.dictation.onAction)
    s.host.inputTraits.contentType = "oneTimeCode"
    publicAction()
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertTrue(s.action.isHidden)
    XCTAssertEqual(s.bridge.pendingRequest, request)
  }

  func testCancellationAndNewRequestIgnoreLateCrossProcessReplies() throws {
    let s = try Session()
    defer { s.close() }
    let old = try s.start()
    s.host.proxy.identifier = UUID()
    s.complete(old)
    let cancelledAction = try XCTUnwrap(s.controller.rootView.dictation.onAction)
    s.controller.rootView.dictation.onCancel?()
    XCTAssertNil(s.bridge.pendingRequest)
    s.complete(old)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    let current = try s.start()
    s.complete(old)
    cancelledAction()
    XCTAssertEqual(s.bridge.pendingRequest, current)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    s.complete(current)
    XCTAssertEqual(s.host.proxy.sentEdits, 1)
  }

  func testReusedRequestIDCannotAuthorizeAnOldRecoveryActionForANewerResult() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.proxy.identifier = UUID()
    let firstTimestamp = Date(timeIntervalSince1970: 100)
    s.complete(request, text: "old transcript", at: firstTimestamp)
    let oldAction = try XCTUnwrap(s.controller.rootView.dictation.onAction)
    s.complete(request, text: "new transcript", at: firstTimestamp.addingTimeInterval(1))
    oldAction()
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertEqual(s.bridge.pendingRequest, request)
    s.action.sendActions(for: .touchUpInside)
    s.applyEdits()
    XCTAssertEqual(s.host.proxy.host.string, "hello new transcript")
  }

  func testStaleStopAndCancelCannotControlANewerPendingRequest() throws {
    let s = try Session()
    defer { s.close() }
    let old = try s.start()
    s.publish(DictationState(phase: .recording, requestID: old))
    let oldStop = try XCTUnwrap(s.controller.rootView.dictation.onStop)
    let oldCancel = try XCTUnwrap(s.controller.rootView.dictation.onCancel)
    oldCancel()
    let current = try s.start()
    s.publish(DictationState(phase: .recording, requestID: current))
    let currentCommand = s.bridge.readCommand()
    oldStop()
    oldCancel()
    XCTAssertEqual(s.bridge.pendingRequest, current)
    XCTAssertEqual(s.bridge.readCommand(), currentCommand)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
  }

  func testStaleDoneCannotReplaceFinishedRecoveryWithTranscribing() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.publish(DictationState(phase: .recording, requestID: request))
    let oldStop = try XCTUnwrap(s.controller.rootView.dictation.onStop)
    s.host.proxy.identifier = UUID()
    s.complete(request)
    let command = s.bridge.readCommand()
    oldStop()
    XCTAssertEqual(s.bridge.readCommand(), command)
    XCTAssertNotNil(s.controller.rootView.dictation.onAction)
    XCTAssertFalse(s.action.isHidden)
    XCTAssertEqual(s.bridge.pendingRequest, request)
  }

  func testRecreatedControllerAndLostVisibilityRequireRecoverableConfirmation() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.controller.hostDidDisappear()
    s.complete(request)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    let recreated = KeyboardController(host: s.host, dictationBridge: s.bridge)
    recreated.hostWillAppear()
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertEqual(s.bridge.pendingRequest, request)
    XCTAssertNotNil(recreated.rootView.dictation.onAction)
    recreated.rootView.dictation.onAction?()
    s.applyEdits()
    XCTAssertEqual(s.host.proxy.host.string, "hello spoken words")
    XCTAssertNil(s.bridge.pendingRequest)
    recreated.hostDidDisappear()
  }

  func testFullAccessRevocationKeepsRecoveryPendingUntilRestored() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.host.hasFullAccess = false
    s.complete(request)
    XCTAssertTrue(s.action.isHidden)
    XCTAssertEqual(s.host.proxy.sentEdits, 0)
    XCTAssertEqual(s.bridge.pendingRequest, request)
    s.host.hasFullAccess = true
    s.controller.documentDidChange()
    s.action.sendActions(for: .touchUpInside)
    XCTAssertEqual(s.host.proxy.sentEdits, 1)
  }

  func testClosingAnErrorCannotCancelAnUnrelatedPendingRequest() throws {
    let s = try Session()
    defer { s.close() }
    let request = try s.start()
    s.publish(DictationState(phase: .failed, requestID: request, errorMessage: "Test failure"))
    XCTAssertNil(s.bridge.pendingRequest)
    XCTAssertFalse(s.controller.rootView.dictation.isHidden)
    let unrelated = UUID()
    s.bridge.pendingRequest = unrelated
    let command = s.bridge.readCommand()
    s.controller.rootView.dictation.onCancel?()
    XCTAssertTrue(s.controller.rootView.dictation.isHidden)
    XCTAssertEqual(s.bridge.pendingRequest, unrelated)
    XCTAssertEqual(s.bridge.readCommand(), command)
  }
}
