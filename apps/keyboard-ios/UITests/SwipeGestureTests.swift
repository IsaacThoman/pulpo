import UIKit
import XCTest
@testable import KeyboardUI

/// Swipe gestures end to end: touches on the real key views, through the
/// controller and engine, into a simulated host. Covers what a finger can do
/// around a swipe that the engine alone cannot see: where it starts, where it
/// travels and lifts, and taps that only wobble.
@MainActor
final class SwipeGestureTests: XCTestCase {
  private var harness: ControllerHarness!
  private var keys: KeysView { harness.controller.rootView.keys }
  private var clock: TimeInterval = 100

  override func setUp() async throws {
    harness = ControllerHarness(waitsForEmoji: false)
  }

  override func tearDown() async throws {
    keys.cancelAllTouches()
    harness = nil
  }

  private var text: String {
    harness.settle()
    harness.pump()
    return harness.proxy.host.string.replacingOccurrences(of: "\u{2019}", with: "'")
      .replacingOccurrences(of: "\u{201C}", with: "\"").replacingOccurrences(of: "\u{201D}", with: "\"")
  }

  private func center(_ identifier: String) -> CGPoint {
    let view = keys.keyViews.first { $0.key.identifier == identifier }!
    return CGPoint(x: view.frame.midX, y: view.frame.midY)
  }

  private func letter(_ character: Character) -> CGPoint { center("key-\(character)") }

  /// A finger through `points`, sampled every few points and 8 ms apart.
  private func drag(_ points: [CGPoint], cancel: Bool = false) {
    var samples = [points[0]]
    for (a, b) in zip(points, points.dropFirst()) {
      let steps = max(2, Int(hypot(b.x - a.x, b.y - a.y) / 6))
      for step in 1...steps {
        let t = CGFloat(step) / CGFloat(steps)
        samples.append(CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
      }
    }
    clock += 1
    let contact = Contact(point: samples[0], time: clock)
    keys.touchesBegan([contact], with: nil)
    for point in samples.dropFirst() {
      contact.time += 0.008
      contact.point = point
      keys.touchesMoved([contact], with: nil)
    }
    contact.time += 0.008
    if cancel { keys.touchesCancelled([contact], with: nil) } else { keys.touchesEnded([contact], with: nil) }
    harness.now += 1
    harness.settle()
    harness.pump()
  }

  private func swipe(_ word: String) { drag(word.map(letter)) }

  private func tap(_ identifier: String) { drag([center(identifier)]) }

  /// A symbol from another page or a long-press strip, as the controller receives it.
  private func symbol(_ character: String) {
    let anyLetter = keys.keyViews.first { $0.key.isCharacter }!.key
    harness.controller.keysView(keys, insertAlternate: character, for: anyLetter)
    harness.settle()
    harness.pump()
  }

  // H1, H2: taps that wobble stay taps.

  func testDriftingTapTypesOneLetter() {
    let start = letter("g")
    let pitch = letter("h").x - start.x
    drag([start, CGPoint(x: start.x + pitch * 0.4, y: start.y + 6)])
    XCTAssertEqual(text, "G")
  }

  func testShortDragBetweenAdjacentKeysIsNotAWord() {
    harness.type("so ")
    let start = letter("a")
    drag([start, CGPoint(x: start.x + 20, y: start.y)])
    let typed = text
    XCTAssertTrue(typed.hasPrefix("So "), typed)
    XCTAssertLessThanOrEqual(typed.count - 3, 1, "a short drag typed \(typed.debugDescription)")
  }

  // H3 - H6, H12: swipes that do not start on a letter decode nothing.

  func testSwipeFromFunctionKeysInsertsNoWord() {
    for start in ["key-shift", "key-space", "key-numbers"] {
      harness = ControllerHarness(waitsForEmoji: false)
      drag([center(start)] + "hello".map(letter))
      let typed = text.lowercased()
      XCTAssertFalse(typed.contains("hello"), "\(start): \(typed.debugDescription)")
      XCTAssertLessThanOrEqual(typed.count, 1, "\(start): \(typed.debugDescription)")
    }
  }

  func testSwipeFromDeleteInsertsNoWord() {
    harness.type("so ")
    drag([center("key-delete"), letter("m"), letter("n"), letter("b")])
    XCTAssertFalse(text.contains(where: { "mnb".contains($0) }), text)
  }

  func testNumbersPageDoesNotGlide() {
    tap("key-numbers")
    XCTAssertEqual(harness.engine.page, .numbers)
    let views = keys.keyViews.filter { $0.key.isCharacter }
    drag([views[0], views[3], views[6]].map { CGPoint(x: $0.frame.midX, y: $0.frame.midY) })
    XCTAssertLessThanOrEqual(text.count, 1, text)
  }

  // H7 - H10: letter swipes decode wherever the finger travels and lifts.

  func testSwipeDecodes() {
    swipe("hello")
    XCTAssertEqual(text, "Hello")
    swipe("to")
    XCTAssertEqual(text, "Hello to")
  }

  func testSwipeLeavingTheKeyboardStillDecodes() {
    harness.type("say ")
    let o = letter("o")
    drag("hello".map(letter) + [CGPoint(x: o.x, y: o.y - 40), CGPoint(x: o.x, y: -30)])
    XCTAssertEqual(text, "Say hello")
  }

  func testSwipeOverTheSpaceBarStillDecodes() {
    harness.type("so ")
    let space = center("key-space")
    let m = letter("m")
    drag([m, CGPoint(x: m.x, y: space.y), letter("a"), letter("n"), letter("y")])
    XCTAssertEqual(text, "So many")
  }

  func testSwipeEndingOnDeleteDecodesWithoutDeleting() {
    harness.type("so ")
    drag("film".map(letter) + [center("key-delete")])
    XCTAssertEqual(text, "So film")
  }

  // H11: a cancelled swipe inserts nothing and leaves the keyboard usable.

  func testCancelledSwipeInsertsNothing() {
    harness.type("so ")
    drag("hello".map(letter), cancel: true)
    XCTAssertEqual(text, "So ")
    swipe("hello")
    XCTAssertEqual(text, "So hello")
  }

  // Workflow through the bar and the delete key.

  func testAlternativeTapThenDeleteRemovesTheWord() throws {
    harness.type("i want ")
    swipe("to")
    let committed = text
    let alternative = try XCTUnwrap(harness.displayed.first { $0.kind == .alternative && !committed.hasSuffix($0.text) })
    harness.tapSlot(alternative.text)
    XCTAssertEqual(text, "I want " + alternative.text)
    tap("key-delete")
    XCTAssertEqual(text, "I want ")
    tap("key-delete")
    XCTAssertEqual(text, "I want")
  }

  func testSwipeBeforeAFollowingWordTypesItsSpace() {
    harness.proxy.hostChanges { $0 = SimulatedProxy.State("Hello world", cursor: 6) }
    harness.deliver(callbacks: [.selectionWill, .selectionDid])
    swipe("big")
    XCTAssertEqual(text, "Hello big world")
    XCTAssertEqual(harness.proxy.host.before, "Hello big ")
    XCTAssertTrue(harness.displayed.contains { $0.kind == .alternative }, "\(harness.displayed)")
  }

  func testApostropheJoinsTheSwipedWord() {
    harness.type("the ")
    swipe("dog")
    symbol("'")
    harness.type("s ")
    XCTAssertEqual(text, "The dog's ")
  }

  func testSwipeAfterAnOpeningQuoteStartsTheSentence() {
    symbol("\"")
    swipe("hello")
    XCTAssertEqual(text, "\"Hello")
  }

  private final class Contact: UITouch {
    var point: CGPoint
    var time: TimeInterval
    init(point: CGPoint, time: TimeInterval) {
      self.point = point
      self.time = time
      super.init()
    }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { time }
  }
}
