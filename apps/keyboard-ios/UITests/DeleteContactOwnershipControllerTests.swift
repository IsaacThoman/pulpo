import UIKit
import XCTest
@testable import KeyboardUI

/// Real KeysView touch tracking, controller, proxy edits and visible Undo.
@MainActor
final class DeleteContactOwnershipControllerTests: XCTestCase {
  private final class Contact: UITouch {
    var point: CGPoint
    private let time = ProcessInfo.processInfo.systemUptime
    init(point: CGPoint) { self.point = point; super.init() }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { time }
  }

  private func contact(_ h: ControllerHarness, key: String = "key-delete") throws -> Contact {
    let view = try XCTUnwrap(h.controller.rootView.keys.keyViews.first { $0.key.identifier == key })
    return Contact(point: CGPoint(x: view.frame.midX, y: view.frame.midY))
  }

  private func undo(_ h: ControllerHarness) throws {
    h.pump()
    let button = try XCTUnwrap(h.bar.subviews.compactMap { $0 as? UIButton }.first {
      $0.accessibilityIdentifier == "undo-delete" && !$0.isHidden
    })
    button.sendActions(for: .touchUpInside)
    h.settle()
  }

  func testOlderLiftDoesNotCancelTheNewDeleteSwipe() throws {
    for optimistic in [false, true] {
      let h = ControllerHarness(text: "one two three!", optimistic: optimistic, waitsForEmoji: false)
      let keys = h.controller.rootView.keys
      defer { keys.cancelAllTouches() }
      let older = try contact(h)
      let newer = try contact(h)
      keys.touchesBegan([older], with: nil)
      keys.touchesBegan([newer], with: nil)
      h.settle()
      XCTAssertEqual(h.proxy.host.string, "one two thre")
      keys.touchesEnded([older], with: nil)
      newer.point.x -= keys.pitch.width
      keys.touchesMoved([newer], with: nil)
      keys.touchesEnded([newer], with: nil)
      h.settle()
      XCTAssertEqual(h.proxy.host.string, "one two ")
      try undo(h)
      // Undo belongs to the new press; the first press's ! stays deleted.
      XCTAssertEqual(h.proxy.host.string, "one two three")
    }
  }

  func testOlderLiftDoesNotCancelTheNewDeleteRepeat() throws {
    let h = ControllerHarness(text: "abcdef", waitsForEmoji: false)
    let keys = h.controller.rootView.keys
    defer { keys.cancelAllTouches() }
    let older = try contact(h)
    let newer = try contact(h)
    keys.touchesBegan([older], with: nil)
    keys.touchesBegan([newer], with: nil)
    keys.touchesEnded([older], with: nil)
    h.settle()
    XCTAssertEqual(h.proxy.host.string, "abcd")
    XCTAssertTrue(h.pump(until: { !h.proxy.outbox.isEmpty }, timeout: 1))
    keys.touchesEnded([newer], with: nil)
    h.settle()
    XCTAssertEqual(h.proxy.host.string, "abc")
  }

  func testTwoRapidDeleteTapsEachRemoveOneCharacterInEitherReleaseOrder() throws {
    for newestFirst in [false, true] {
      let h = ControllerHarness(text: "abcdef", waitsForEmoji: false)
      let keys = h.controller.rootView.keys
      defer { keys.cancelAllTouches() }
      let older = try contact(h)
      let newer = try contact(h)
      keys.touchesBegan([older], with: nil)
      keys.touchesBegan([newer], with: nil)
      keys.touchesEnded([newestFirst ? newer : older], with: nil)
      keys.touchesEnded([newestFirst ? older : newer], with: nil)
      h.settle()
      XCTAssertEqual(h.proxy.host.string, "abcd")
      XCTAssertEqual(h.proxy.sentEdits, 2)
    }
  }

  func testNewDeleteFinishesTheOlderDeferredCorrectionUndoFirst() throws {
    let h = ControllerHarness(waitsForEmoji: false)
    let keys = h.controller.rootView.keys
    defer { keys.cancelAllTouches() }
    h.type("and teh ")
    XCTAssertTrue(h.engine.deleteUndoesLastEdit)
    let older = try contact(h)
    let newer = try contact(h)
    let sent = h.proxy.sentEdits
    keys.touchesBegan([older], with: nil)
    XCTAssertEqual(h.proxy.sentEdits, sent, "The first correction undo waits for release")
    keys.touchesBegan([newer], with: nil)
    keys.touchesEnded([older], with: nil)
    keys.touchesEnded([newer], with: nil)
    h.settle()
    XCTAssertEqual(h.proxy.host.string, "And te", "First undo the correction, then delete h")
  }

  func testInvalidatedOldContactCannotEndOrSwipeTheNewFieldsGesture() throws {
    for deferred in [false, true] {
      for callbacks in [false, true] {
        let h = ControllerHarness(text: deferred ? "" : "old field!", waitsForEmoji: false)
        let keys = h.controller.rootView.keys
        defer { keys.cancelAllTouches() }
        if deferred { h.type("and teh "); XCTAssertTrue(h.engine.deleteUndoesLastEdit) }
        let older = try contact(h)
        keys.touchesBegan([older], with: nil)
        h.settle()
        h.proxy.identifier = UUID()
        h.proxy.hostChanges { $0 = SimulatedProxy.State("one two three!") }
        h.deliver(callbacks: callbacks ? [.textWill, .textDid] : [])
        let newer = try contact(h)
        keys.touchesBegan([newer], with: nil)
        h.settle()
        let sent = h.proxy.sentEdits
        older.point.x -= keys.pitch.width * 2
        keys.touchesMoved([older], with: nil)
        keys.touchesEnded([older], with: nil)
        XCTAssertEqual(h.proxy.sentEdits, sent)
        newer.point.x -= keys.pitch.width
        keys.touchesMoved([newer], with: nil)
        keys.touchesEnded([newer], with: nil)
        h.settle()
        XCTAssertEqual(h.proxy.host.string, "one two ")
        try undo(h)
        XCTAssertEqual(h.proxy.host.string, "one two three!")
      }
    }
  }

  func testDestinationCancellationPreservesAnUnrelatedLetterContact() throws {
    let h = ControllerHarness(text: "old!", waitsForEmoji: false)
    let keys = h.controller.rootView.keys
    defer { keys.cancelAllTouches() }
    let deletion = try contact(h)
    keys.touchesBegan([deletion], with: nil)
    h.settle()
    let letter = try contact(h, key: "key-q")
    keys.touchesBegan([letter], with: nil)
    h.proxy.identifier = UUID()
    h.proxy.hostChanges { $0 = SimulatedProxy.State("new ") }
    h.deliver(callbacks: [.textWill, .textDid])
    keys.touchesEnded([deletion], with: nil)
    keys.touchesEnded([letter], with: nil)
    h.settle()
    XCTAssertEqual(h.proxy.host.string, "new q")
  }
}
