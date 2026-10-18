import UIKit
import XCTest
@testable import KeyboardUI

@MainActor
final class DeleteGestureDestinationControllerTests: XCTestCase {
  private func begin(_ text: String, optimistic: Bool) throws -> ControllerHarness {
    let h = ControllerHarness(text: text, optimistic: optimistic, waitsForEmoji: false)
    h.controller.keysView(h.controller.rootView.keys, touchDown: try XCTUnwrap(h.key(.delete)))
    h.settle()
    h.controller.keysView(h.controller.rootView.keys, previewWordDeletion: 1)
    return h
  }

  private func hasUndo(_ h: ControllerHarness) -> Bool {
    h.bar.subviews.contains { $0.accessibilityIdentifier == "undo-delete" && !$0.isHidden }
  }

  func testIdentifiedFieldSwitchCannotDeleteOrRestoreTheOldFieldsText() throws {
    for optimistic in [false, true] {
      for callbacks in [false, true] {
        for selection in [false, true] {
          let h = try begin("shared old content!", optimistic: optimistic)
          h.proxy.identifier = UUID()
          h.proxy.hostChanges {
            $0 = SimulatedProxy.State("shared new")
            if selection { $0.cursor = 7; $0.selection = 3 }
          }
          h.deliver(callbacks: callbacks ? [.textWill, .textDid] : [])
          let sent = h.proxy.sentEdits
          // A late preview must not re-arm the gesture after callback cancellation.
          h.controller.keysView(h.controller.rootView.keys, previewWordDeletion: 1)
          h.controller.keysView(h.controller.rootView.keys, commitWordDeletion: 1)
          h.settle()
          h.pump()
          XCTAssertEqual(h.proxy.sentEdits, sent)
          XCTAssertEqual(h.proxy.host.string, "shared new")
          XCTAssertFalse(hasUndo(h), "The old field's text must never be offered as Undo here")
        }
      }
    }
  }

  func testFreshCaretOrTextChangeCancelsTheOldPreview() throws {
    for callbacks in [false, true] {
      for moveCaret in [false, true] {
        let h = try begin("one two three!", optimistic: false)
        h.proxy.hostChanges {
          if moveCaret { $0.cursor = 4 } else { $0 = SimulatedProxy.State("different host text") }
        }
        h.deliver(callbacks: callbacks ? [.selectionWill, .selectionDid] : [])
        let expected = h.proxy.host.string
        let sent = h.proxy.sentEdits
        h.controller.keysView(h.controller.rootView.keys, commitWordDeletion: 1)
        h.settle()
        h.pump()
        XCTAssertEqual(h.proxy.sentEdits, sent)
        XCTAssertEqual(h.proxy.host.string, expected)
        XCTAssertFalse(hasUndo(h))
      }
    }
  }

  func testPrivacyTransitionCancelsCommitAndHeldDeleteRepeats() throws {
    for callbacks in [false, true] {
      let h = try begin("account secret!", optimistic: false)
      h.proxy.secureEntryValue = true
      if callbacks { h.fire([.textWill, .textDid]) }
      let sent = h.proxy.sentEdits
      h.controller.keysViewRepeatDelete(h.controller.rootView.keys, wholeWord: true)
      h.controller.keysView(h.controller.rootView.keys, commitWordDeletion: 1)
      h.settle()
      XCTAssertEqual(h.proxy.sentEdits, sent)
      XCTAssertEqual(h.proxy.host.string, "account secret")
    }
  }

  func testSilentSameFieldSelectionStillDeletesOnlyItsRangeAndUndoesIt() throws {
    for optimistic in [false, true] {
      let h = try begin("prefix chosen suffix!", optimistic: optimistic)
      h.proxy.hostChanges { $0.cursor = 7; $0.selection = 6 }
      h.deliver(callbacks: [])
      let sent = h.proxy.sentEdits
      h.controller.keysView(h.controller.rootView.keys, commitWordDeletion: 3)
      XCTAssertEqual(h.proxy.outbox, [.delete])
      XCTAssertEqual(h.proxy.sentEdits, sent + 1)
      h.settle()
      h.pump()
      XCTAssertEqual(h.proxy.host.string, "prefix  suffix")
      let undo = try XCTUnwrap(h.bar.subviews.compactMap { $0 as? UIButton }.first {
        $0.accessibilityIdentifier == "undo-delete" && !$0.isHidden
      })
      undo.sendActions(for: .touchUpInside)
      h.settle()
      XCTAssertEqual(h.proxy.host.string, "prefix chosen suffix")
    }
  }

  func testDelayedOwnReportsKeepTheGestureAndItsTouchDownUndo() throws {
    for optimistic in [false, true] {
      let h = try begin("one two three!", optimistic: optimistic)
      h.controller.keysViewRepeatDelete(h.controller.rootView.keys, wholeWord: false)
      h.proxy.hostApplies()
      h.controller.keysViewRepeatDelete(h.controller.rootView.keys, wholeWord: false)
      h.proxy.hostApplies()
      h.now += 1.3
      h.deliver(1, callbacks: [.textWill, .textDid])
      h.controller.keysView(h.controller.rootView.keys, commitWordDeletion: 1)
      h.settle()
      h.pump()
      XCTAssertEqual(h.proxy.host.string, "one two ")
      let undo = try XCTUnwrap(h.bar.subviews.compactMap { $0 as? UIButton }.first {
        $0.accessibilityIdentifier == "undo-delete" && !$0.isHidden
      })
      undo.sendActions(for: .touchUpInside)
      h.settle()
      XCTAssertEqual(h.proxy.host.string, "one two three!")
    }
  }

  func testFieldSwitchCancelsADeferredCorrectionUndoAtDeleteRelease() throws {
    let h = ControllerHarness(waitsForEmoji: false)
    h.type("and teh ")
    guard h.engine.deleteUndoesLastEdit else {
      XCTFail("Expected a deferred correction undo; host contains \(h.proxy.host.string.debugDescription)")
      return
    }
    h.controller.keysView(h.controller.rootView.keys, touchDown: try XCTUnwrap(h.key(.delete)))
    guard h.proxy.outbox.isEmpty else {
      XCTFail("A deferred correction undo must not send an edit on touch-down")
      return
    }
    let sent = h.proxy.sentEdits
    h.proxy.identifier = UUID()
    h.proxy.hostChanges { $0 = SimulatedProxy.State("new field") }
    h.deliver(callbacks: [.textWill, .textDid])
    h.controller.keysViewDeleteEnded(h.controller.rootView.keys)
    h.settle()
    XCTAssertEqual(h.proxy.sentEdits, sent)
    XCTAssertEqual(h.proxy.host.string, "new field")
  }
}
