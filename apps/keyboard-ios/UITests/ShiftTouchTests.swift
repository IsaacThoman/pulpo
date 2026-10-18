import XCTest
import UIKit
@testable import KeyboardUI

/// Exercises modifier ownership through real engine state transitions.
@MainActor
final class ShiftTouchTests: XCTestCase {
  private var keys: KeysView!
  private var recorder: Recorder!
  override func setUp() async throws {
    recorder = Recorder()
    let style = KeyboardStyle.current(dark: false, landscape: false, inset: false)
    keys = KeysView(layout: KeyboardLayout.make(page: .letters, traits: InputTraits(), needsGlobe: false, digitHints: false), style: style)
    keys.delegate = recorder
    keys.frame = CGRect(x: 0, y: 0, width: 393, height: style.totalHeight - style.barHeight)
    keys.layoutIfNeeded()
  }
  override func tearDown() async throws { keys.cancelAllTouches() }
  private func touch(_ id: String) -> Contact {
    let view = keys.keyViews.first { $0.key.identifier == id }!
    return Contact(point: CGPoint(x: view.frame.midX, y: view.frame.midY))
  }
  func testShiftSlideReleasesBeforeLaterTyping() {
    let shift = touch("key-shift")
    keys.touchesBegan([shift], with: nil)
    shift.point = touch("key-a").point
    keys.touchesMoved([shift], with: nil)
    keys.touchesEnded([shift], with: nil)
    recorder.engine.insertCharacter("b")
    XCTAssertEqual(recorder.document.text, "Ab")
    XCTAssertEqual(recorder.shiftUps, 1)
  }
  func testBulkCancelReleasesHeldShiftWithoutTypingPendingLetters() {
    let shift = touch("key-shift")
    let a = touch("key-a")
    keys.touchesBegan([shift], with: nil)
    keys.touchesBegan([a], with: nil)
    keys.cancelAllTouches()
    keys.touchesEnded([shift, a], with: nil)
    XCTAssertEqual(recorder.document.text, "")
    XCTAssertEqual(recorder.shiftUps, 1)
    recorder.engine.insertCharacter("a")
    recorder.engine.insertCharacter("b")
    XCTAssertEqual(recorder.document.text, "Ab")
  }
  func testCancelledShiftSlideReleasesWithoutTypingItsLetter() {
    let shift = touch("key-shift")
    keys.touchesBegan([shift], with: nil)
    shift.point = touch("key-a").point
    keys.touchesMoved([shift], with: nil)
    keys.touchesCancelled([shift], with: nil)
    XCTAssertEqual(recorder.document.text, "")
    XCTAssertEqual(recorder.shiftUps, 1)
    recorder.engine.insertCharacter("a")
    recorder.engine.insertCharacter("b")
    XCTAssertEqual(recorder.document.text, "Ab")
  }
  func testRolledShiftSlideRemainsHeldUntilItsOwnLift() {
    let shift = touch("key-shift")
    keys.touchesBegan([shift], with: nil)
    shift.point = touch("key-a").point
    keys.touchesMoved([shift], with: nil)
    let b = touch("key-b")
    keys.touchesBegan([b], with: nil)
    keys.touchesEnded([b], with: nil)
    XCTAssertEqual(recorder.document.text, "AB")
    XCTAssertEqual(recorder.shiftUps, 0)
    keys.touchesEnded([shift], with: nil)
    recorder.engine.insertCharacter("c")
    XCTAssertEqual(recorder.document.text, "ABc")
    XCTAssertEqual(recorder.shiftUps, 1)
  }
  private final class Contact: UITouch {
    var point: CGPoint
    init(point: CGPoint) { self.point = point; super.init() }
    override func location(in view: UIView?) -> CGPoint { point }
  }
  private final class Recorder: KeysViewDelegate {
    let document = Document()
    lazy var engine: KeyboardEngine = {
      let result = KeyboardEngine(document: document, suggester: nil, glide: nil)
      var traits = InputTraits(); traits.capitalization = .none
      result.traits = traits
      result.documentDidChange()
      return result
    }()
    var shiftUps = 0
    var keysViewAllowsGlide: Bool { false }
    var keysViewShowsPopups: Bool { false }
    func keysView(_ view: KeysView, touchDown key: Key) { if key.action == .shift { engine.shiftDown() } }
    func keysView(_ view: KeysView, activate key: Key, at point: CGPoint) { if case let .character(text) = key.action { engine.insertCharacter(text) } }
    func keysViewShiftUp(_ view: KeysView) { shiftUps += 1; engine.shiftUp() }
    func keysView(_ view: KeysView, glide points: [CGPoint], times: [TimeInterval], start: Key) {}
    func keysView(_ view: KeysView, insertAlternate text: String, for key: Key) {}
    func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool) {}
    func keysView(_ view: KeysView, moveCursor offset: Int) {}
    func keysView(_ view: KeysView, inputModeListWith event: UIEvent) {}
    func keysViewFinishedPageSlide(_ view: KeysView) {}
    func keysViewDidLayout(_ view: KeysView) {}
  }
  private final class Document: TextDocument {
    var text = ""
    var documentContextBeforeInput: String? { text }
    var documentContextAfterInput: String? { "" }
    var selectedText: String? { nil }
    var hasText: Bool { !text.isEmpty }
    func insertText(_ value: String) { text += value }
    func deleteBackward() { if !text.isEmpty { text.removeLast() } }
  }
}
