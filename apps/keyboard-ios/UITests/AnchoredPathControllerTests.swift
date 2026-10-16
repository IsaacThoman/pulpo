import UIKit
import XCTest
@testable import KeyboardUI

/// Exposed R15 integration regressions, frozen before the baseline native run.
/// Every method uses EN/ES/bilingual dictionaries and queued/optimistic proxies.
/// Seed punctuation that is not on the letter page; dispatch letters, spaces and
/// delete through the actual visible KeysView caps and production controller.
@MainActor
final class AnchoredPathControllerTests: XCTestCase {
  private struct Example {
    let language: KeyboardLanguage
    let typed: String
    let corrected: String
  }
  private let examples = [
    Example(language: .english, typed: "teh", corrected: "the"),
    Example(language: .spanish, typed: "inportante", corrected: "importante"),
    Example(language: .bilingual, typed: "teh", corrected: "the"),
  ]

  private final class Contact: UITouch {
    let point: CGPoint
    private let time = ProcessInfo.processInfo.systemUptime
    init(_ point: CGPoint) { self.point = point; super.init() }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { time }
  }

  private func tap(_ identifier: String, in h: ControllerHarness) throws {
    let root = h.controller.rootView
    root.layoutIfNeeded()
    root.keys.layoutIfNeeded()
    let cap = try XCTUnwrap(root.keys.keyViews.first { $0.key.identifier == identifier && $0.isEnabled })
    let point = CGPoint(x: cap.frame.midX, y: cap.frame.midY)
    XCTAssertFalse(cap.frame.isEmpty)
    XCTAssertTrue(root.hitTest(root.keys.convert(point, to: root), with: nil) === root.keys)
    let touch = Contact(point)
    h.now += 0.25
    root.keys.touchesBegan([touch], with: nil)
    root.keys.touchesEnded([touch], with: nil)
    h.pump()
  }

  private func type(_ text: String, in h: ControllerHarness, settling: Bool = true) throws {
    for letter in text {
      try tap(letter == " " ? "key-space" : "key-\(letter)", in: h)
      if settling { h.settle(); h.pump() }
    }
  }

  private func each(_ body: (ControllerHarness, Example) throws -> Void) throws {
    let stores = [SettingsStore(), SettingsStore(defaults: .standard)]
    let originals = stores.map { $0.load() }
    defer { for (store, original) in zip(stores, originals) { store.save(original) } }
    for example in examples {
      for optimistic in [false, true] {
        // Default normal-field policy, including autocorrection/capitalization.
        stores.forEach { $0.save(KeyboardSettings()) }
        let h = ControllerHarness(optimistic: optimistic, waitsForEmoji: false)
        defer {
          h.engine.suggester?.model.personal.clear()
          h.engine.suggester?.corrector.touch?.reset()
          h.disappear()
        }
        h.bar.onLanguage?(example.language)
        h.pump()
        let stack = try XCTUnwrap(h.controller.stack)
        XCTAssertTrue(h.engine.suggester === stack.suggester)
        XCTAssertEqual(h.engine.settings.language, example.language)
        XCTAssertTrue(h.engine.policy.autocorrects)
        XCTAssertTrue(h.engine.policy.showsSuggestions)
        h.engine.suggester?.model.personal.clear()
        h.engine.suggester?.corrector.touch?.reset()
        try body(h, example)
      }
    }
  }

  private func host(_ h: ControllerHarness, before: String, selected: String = "", after: String = "") {
    h.proxy.hostChanges {
      $0 = SimulatedProxy.State(before + selected + after, cursor: before.count)
      $0.selection = selected.count
    }
    h.deliver(callbacks: [.textWill, .selectionWill, .textDid, .selectionDid])
    h.pump()
  }

  func testAnchoredFinalComponentKeepsLiteralBarAndExactDocument() throws {
    try each { h, example in
      host(h, before: "say /var/cache/")
      try type(example.typed, in: h)
      XCTAssertEqual(h.proxy.host.string, "say /var/cache/" + example.typed)
      XCTAssertEqual(h.displayed.map(\.text), [example.typed])
      XCTAssertNil(h.engine.suggestions.autocorrection)
      try type(" ", in: h)
      XCTAssertEqual(h.proxy.host.string, "say /var/cache/" + example.typed + " ")
      XCTAssertFalse(h.engine.deleteUndoesLastEdit)
    }
  }

  func testQueuedAnchoredSelectionReplacementPreservesSuffixWithoutCorrectionDeletes() throws {
    try each { h, example in
      host(h, before: "say ./drafts/", selected: "old", after: "\nEND")
      let sent = h.proxy.sentEdits
      try type(example.typed, in: h, settling: false)
      XCTAssertEqual(h.displayed.map(\.text), [example.typed])
      XCTAssertNil(h.engine.suggestions.autocorrection)
      try type(" ", in: h, settling: false)
      let expected = "say ./drafts/" + example.typed + " \nEND"
      XCTAssertEqual(h.proxy.eventual.string, expected)
      XCTAssertEqual(h.proxy.sentEdits - sent, example.typed.count + 1, "Literal replacement needs one insert per key, without correction deletes")
      h.proxy.hostApplies(batched: true)
      h.deliver(callbacks: [.textDid, .textDid, .selectionDid])
      h.pump()
      XCTAssertEqual(h.proxy.host.string, expected)
      XCTAssertEqual(h.proxy.host.after, "\nEND")
      XCTAssertTrue(h.proxy.outbox.isEmpty)
    }
  }

  func testOrdinarySlashAndASCIIEllipsisStillCorrectAndDeleteUndoesCorrection() throws {
    for prefix in ["say a/", "say..."] {
      try each { h, example in
        host(h, before: prefix)
        try type(example.typed, in: h)
        XCTAssertEqual(h.engine.suggestions.autocorrection, example.corrected)
        XCTAssertTrue(h.displayed.contains { $0.text == example.corrected })
        try type(" ", in: h)
        XCTAssertEqual(h.proxy.host.string, prefix + example.corrected + " ")
        XCTAssertTrue(h.engine.deleteUndoesLastEdit)
        try tap("key-delete", in: h)
        h.settle()
        h.pump()
        XCTAssertEqual(h.proxy.host.string, prefix + example.typed, "Correction Undo restores the typed word and removes its delimiter")
      }
    }
  }

  func testAcceptedHostMarkerDeletionRestoresOrdinaryCorrection() throws {
    try each { h, example in
      host(h, before: "say ./")
      try type(example.typed, in: h)
      XCTAssertEqual(h.proxy.host.string, "say ./" + example.typed)
      // Host removes just the path marker, retaining the already typed word.
      h.proxy.hostChanges {
        $0.text.removeSubrange(4..<6)
        $0.cursor -= 2
      }
      h.deliver(callbacks: [.textWill, .textDid, .selectionDid])
      h.pump()
      XCTAssertEqual(h.proxy.reported.before, "say " + example.typed)
      XCTAssertEqual(h.engine.suggestions.autocorrection, example.corrected)
      try type(" ", in: h)
      XCTAssertEqual(h.proxy.host.string, "say " + example.corrected + " ")
    }
  }

  func testAcceptedHostCaretMoveRestoresCorrectionAndKeepsPathSuffix() throws {
    try each { h, example in
      host(h, before: "say /var/cache/")
      try type(example.typed, in: h)
      let suffix = "/var/cache/" + example.typed
      h.proxy.hostChanges { $0.cursor = 4 }
      h.deliver(callbacks: [.selectionWill, .selectionDid])
      h.pump()
      XCTAssertEqual(h.proxy.reported.before, "say ")
      XCTAssertEqual(h.proxy.reported.after, suffix)
      try type(example.typed, in: h)
      XCTAssertEqual(h.engine.suggestions.autocorrection, example.corrected)
      try type(" ", in: h)
      XCTAssertEqual(h.proxy.host.string, "say " + example.corrected + " " + suffix)
      XCTAssertEqual(h.proxy.host.after, suffix)
    }
  }
}
