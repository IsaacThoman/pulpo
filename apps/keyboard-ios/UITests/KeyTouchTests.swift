import XCTest
import UIKit
@testable import KeyboardUI

/// Drives UIKit's touch callbacks directly so overlapping contacts and release
/// ordering stay deterministic, without XCTest's private gesture synthesis.
@MainActor
final class KeyTouchTests: XCTestCase {
  private var keys: KeysView!
  private var recorder: Recorder!

  override func setUp() async throws {
    recorder = Recorder()
    let style = KeyboardStyle.current(dark: false, landscape: false, inset: false)
    keys = KeysView(layout: layout(.letters), style: style)
    keys.delegate = recorder
    keys.frame = CGRect(x: 0, y: 0, width: 393, height: style.totalHeight - style.barHeight)
    keys.layoutIfNeeded()
  }

  override func tearDown() async throws {
    keys.cancelAllTouches()
    keys = nil
    recorder = nil
  }

  private func layout(_ page: KeyboardPage) -> KeyboardLayout {
    KeyboardLayout.make(page: page, traits: InputTraits(), needsGlobe: false, digitHints: false)
  }

  private func touch(_ identifier: String, time: TimeInterval = 0) -> Contact {
    let view = keys.keyViews.first { $0.key.identifier == identifier }!
    return Contact(point: CGPoint(x: view.frame.midX, y: view.frame.midY), time: time)
  }

  func testGapsChooseTheClosestKeyEdgeAcrossStaggeredRows() {
    let a = keys.keyViews.first { $0.key.identifier == "key-a" }!.frame
    let q = keys.keyViews.first { $0.key.identifier == "key-q" }!.frame
    // Above the left corner of A, Q is closer even though this is in A's
    // expanded row hit area. The cap edges decide, not the row or center.
    let point = CGPoint(x: a.minX - 6, y: a.minY - 5)
    XCTAssertTrue(point.x >= q.minX && point.x <= q.maxX)
    XCTAssertEqual(keys.keyViews[keys.keyIndex(at: point)!].key.identifier, "key-q")
  }

  func testSpaceWinsNearItsWideEdgeInsteadOfALetterCenter() {
    let space = keys.keyViews.first { $0.key.identifier == "key-space" }!.frame
    let v = keys.keyViews.first { $0.key.identifier == "key-v" }!.frame
    let point = CGPoint(x: space.minX + 2, y: space.minY - 3)
    XCTAssertLessThan(space.minY - point.y, point.y - v.maxY)
    XCTAssertEqual(keys.keyViews[keys.keyIndex(at: point)!].key.identifier, "key-space")
  }

  func testNumberPadBlankResolvesToTheClosestVisibleKey() {
    var traits = InputTraits()
    traits.keyboard = .numberPad
    keys.setLayout(KeyboardLayout.make(page: .letters, traits: traits, needsGlobe: false, digitHints: false), style: keys.style)
    keys.layoutIfNeeded()
    let blank = keys.keyViews.first { $0.key.identifier == "key-blank" }!.frame
    let zero = keys.keyViews.first { $0.key.identifier == "key-0" }!.frame
    let point = CGPoint(x: blank.maxX - 2, y: zero.midY)
    let contact = Contact(point: point, time: 0)
    keys.touchesBegan([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.activations, ["key-0"])
  }

  func testUnusedSuggestionBarSpaceRoutesToTopRow() {
    let root = makeRoot()
    // No suggestions: the center of the bar is bare keyboard background.
    let point = CGPoint(x: 190, y: root.bar.frame.maxY - 12)
    XCTAssertTrue(root.hitTest(point, with: nil) === root.keys)
    // An unfilled suggestion slot must not swallow the touch either.
    root.bar.setSuggestions([Suggestion(text: "test", kind: .literal)])
    XCTAssertTrue(root.hitTest(point, with: nil) === root.keys)
  }

  func testBarControlsAndOtherPanelsKeepTheirTouches() {
    let root = makeRoot()
    let point = CGPoint(x: 20, y: root.bar.frame.midY)
    XCTAssertTrue(root.hitTest(point, with: nil) is UIButton)
    root.bar.setSuggestions([Suggestion(text: "test", kind: .literal)])
    XCTAssertTrue(root.hitTest(point, with: nil) is SlotControl)
    root.bar.showNotice("Test notice")
    XCTAssertFalse(root.hitTest(CGPoint(x: 190, y: root.bar.frame.maxY - 3), with: nil) === root.keys)
    root.mode = .dictation
    XCTAssertFalse(root.hitTest(CGPoint(x: 190, y: root.bounds.maxY - 3), with: nil) === root.keys)
  }

  func testPreviewBottomPaddingRoutesOnlyInKeyMode() {
    let root = makeRoot()
    root.bottomTouchPadding = 34
    let host = UIView(frame: CGRect(x: 0, y: 0, width: root.bounds.width, height: root.bounds.height + 34))
    host.addSubview(root)
    let point = CGPoint(x: root.bounds.midX, y: root.frame.maxY + 12)
    XCTAssertTrue(host.hitTest(point, with: nil) === root.keys)
    XCTAssertEqual(root.keys.keyViews[root.keys.keyIndex(at: root.keys.convert(point, from: host))!].key.identifier, "key-space")
    root.mode = .dictation
    XCTAssertTrue(host.hitTest(point, with: nil) === host)
  }

  func testAllGridGapsAndOuterMarginsRouteToKeys() {
    for inset in [false, true] {
      let root = makeRoot(inset: inset)
      for y in stride(from: root.keys.frame.minY, to: root.bounds.maxY, by: 3) {
        for x in stride(from: CGFloat(0), to: root.bounds.maxX, by: 3) {
          let point = CGPoint(x: x, y: y)
          XCTAssertTrue(root.hitTest(point, with: nil) === root.keys, "Unrouted gap at \(point)")
          XCTAssertNotNil(root.keys.keyIndex(at: root.keys.convert(point, from: root)))
        }
      }
    }
  }

  private func makeRoot(inset: Bool = false) -> KeyboardRootView {
    let style = KeyboardStyle.current(dark: false, landscape: false, inset: inset)
    let root = KeyboardRootView(style: style, layout: layout(.letters))
    root.frame = CGRect(x: 0, y: 0, width: 393, height: style.totalHeight)
    root.layoutIfNeeded()
    return root
  }

  func testThumbRollKeepsThePressedLetterAcrossAKeyBoundary() {
    let f = keys.keyViews.first { $0.key.identifier == "key-f" }!
    let g = keys.keyViews.first { $0.key.identifier == "key-g" }!
    let boundary = (f.frame.maxX + g.frame.minX) / 2
    for deliverMove in [false, true] {
      recorder.events = []
      let contact = Contact(point: CGPoint(x: boundary - 2, y: f.frame.midY), time: 0)
      keys.touchesBegan([contact], with: nil)
      contact.point.x += 5
      if deliverMove { keys.touchesMoved([contact], with: nil) }
      keys.touchesEnded([contact], with: nil)
      XCTAssertEqual(recorder.activations, ["key-f"])
    }
  }

  func testLetterCannotDisappearByDriftingOntoAFunctionKey() {
    recorder.allowsGlide = false
    for (letter, function) in [("key-z", "key-shift"), ("key-m", "key-delete"), ("key-v", "key-space")] {
      recorder.events = []
      let contact = touch(letter)
      keys.touchesBegan([contact], with: nil)
      contact.point = touch(function).point
      keys.touchesMoved([contact], with: nil)
      keys.touchesEnded([contact], with: nil)
      XCTAssertEqual(recorder.activations, [letter])
      XCTAssertFalse(recorder.events.contains("shift-up"))
    }
  }

  func testDeliberateSlideCanStillSelectAnotherLetter() {
    recorder.allowsGlide = false
    let contact = touch("key-f")
    keys.touchesBegan([contact], with: nil)
    contact.point = touch("key-g").point
    keys.touchesMoved([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.activations, ["key-g"])
    XCTAssertEqual(recorder.activationPoints.last, contact.point)
  }

  func testSpatialCorrectionUsesTouchDownBeforeThumbRoll() {
    let contact = touch("key-f")
    let down = contact.point
    keys.touchesBegan([contact], with: nil)
    contact.point.x += keys.pitch.width * 0.35
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.activations, ["key-f"])
    XCTAssertEqual(recorder.activationPoints.last, down)
  }

  func testRollingSpaceCommitsBeforeNextLetter() {
    let space = touch("key-space")
    let b = touch("key-b", time: 0.06)
    keys.touchesBegan([space], with: nil)
    keys.touchesBegan([b], with: nil)
    keys.touchesEnded([b], with: nil)
    keys.touchesEnded([space], with: nil)
    XCTAssertEqual(recorder.activations, ["key-space", "key-b"])
  }

  func testDeleteActsAfterPendingSpaceAndLetter() {
    for identifier in ["key-space", "key-a"] {
      recorder.events = []
      let pending = touch(identifier)
      let delete = touch("key-delete", time: 0.06)
      keys.touchesBegan([pending], with: nil)
      keys.touchesBegan([delete], with: nil)
      keys.touchesEnded([delete], with: nil)
      keys.touchesEnded([pending], with: nil)
      XCTAssertEqual(recorder.events, ["down:\(identifier)", "activate:\(identifier)", "down:key-delete"])
    }
  }

  func testCommittedFingerCannotGlideOrBlockLaterKey() {
    let h = touch("key-h")
    let e = touch("key-e", time: 0.04)
    let l = touch("key-l", time: 0.23)
    keys.touchesBegan([h], with: nil)
    keys.touchesBegan([e], with: nil)
    keys.touchesEnded([e], with: nil)
    h.point = touch("key-k").point
    keys.touchesMoved([h], with: nil)
    keys.touchesBegan([l], with: nil)
    keys.touchesEnded([l], with: nil)
    keys.touchesEnded([h], with: nil)
    XCTAssertEqual(recorder.activations, ["key-h", "key-e", "key-l"])
    XCTAssertEqual(recorder.glides, 0)
    XCTAssertEqual(keys.stats.glides, 0)
  }

  func testCommittedSpaceCannotEnterCursorMode() {
    let space = touch("key-space")
    let b = touch("key-b", time: 0.06)
    keys.touchesBegan([space], with: nil)
    keys.touchesBegan([b], with: nil)
    keys.touchesEnded([b], with: nil)
    space.point.x += 60
    keys.touchesMoved([space], with: nil)
    keys.touchesEnded([space], with: nil)
    XCTAssertEqual(recorder.activations, ["key-space", "key-b"])
    XCTAssertEqual(keys.stats.cursorSlides, 0)
  }

  func testRollingSpaceHitTestsAfterReturningToLetters() {
    keys.setLayout(layout(.numbers), style: keys.style)
    keys.layoutIfNeeded()
    let space = touch("key-space")
    let e = touch("key-3", time: 0.06)
    recorder.onActivate = { [unowned self] key in
      if key.action == .space { keys.setLayout(layout(.letters), style: keys.style) }
    }
    keys.touchesBegan([space], with: nil)
    keys.touchesBegan([e], with: nil)
    keys.touchesEnded([e], with: nil)
    keys.touchesEnded([space], with: nil)
    XCTAssertEqual(recorder.activations, ["key-space", "key-e"])
  }

  func testRapidRollingTypingPreservesEveryKey() {
    let text = "the quick brown fox jumps over the lazy dog"
    let contacts = text.enumerated().map { index, character in
      touch(character == " " ? "key-space" : "key-\(character)", time: Double(index) * 0.08)
    }
    for index in stride(from: 0, to: contacts.count, by: 2) {
      keys.touchesBegan([contacts[index]], with: nil)
      if index + 1 < contacts.count {
        keys.touchesBegan([contacts[index + 1]], with: nil)
        // The newer thumb lifts first; insertion must still follow touch-down order.
        keys.touchesEnded([contacts[index + 1]], with: nil)
      }
      keys.touchesEnded([contacts[index]], with: nil)
    }
    XCTAssertEqual(recorder.activations, text.map { $0 == " " ? "key-space" : "key-\($0)" })
  }

  func testBatchedBeginsFollowTouchTimestamps() {
    let a = touch("key-a", time: 0)
    let b = touch("key-b", time: 0.02)
    let c = touch("key-c", time: 0.04)
    keys.touchesBegan([c, a, b], with: nil)
    keys.touchesEnded([b, a, c], with: nil)
    XCTAssertEqual(recorder.activations, ["key-a", "key-b", "key-c"])
  }

  func testShiftRemainsHeldAcrossRollingLetters() {
    let shift = touch("key-shift")
    let a = touch("key-a", time: 0.06)
    let b = touch("key-b", time: 0.12)
    keys.touchesBegan([shift], with: nil)
    keys.touchesBegan([a], with: nil)
    keys.touchesBegan([b], with: nil)
    keys.touchesEnded([b], with: nil)
    keys.touchesEnded([a], with: nil)
    keys.touchesEnded([shift], with: nil)
    XCTAssertEqual(recorder.events, ["down:key-shift", "down:key-a", "activate:key-a", "down:key-b", "activate:key-b", "shift-up"])
  }

  private final class Contact: UITouch {
    var point: CGPoint
    let time: TimeInterval
    init(point: CGPoint, time: TimeInterval) {
      self.point = point
      self.time = time
      super.init()
    }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { time }
  }

  private final class Recorder: KeysViewDelegate {
    var events: [String] = []
    var glides = 0
    var allowsGlide = true
    var activationPoints: [CGPoint] = []
    var onActivate: ((Key) -> Void)?
    var activations: [String] { events.filter { $0.hasPrefix("activate:") }.map { String($0.dropFirst(9)) } }
    var keysViewAllowsGlide: Bool { allowsGlide }
    var keysViewShowsPopups: Bool { false }
    func keysView(_ view: KeysView, touchDown key: Key) { events.append("down:\(key.identifier)") }
    func keysView(_ view: KeysView, activate key: Key, at point: CGPoint) {
      events.append("activate:\(key.identifier)")
      activationPoints.append(point)
      onActivate?(key)
    }
    func keysView(_ view: KeysView, glide points: [CGPoint], start: Key) { glides += 1 }
    func keysViewShiftUp(_ view: KeysView) { events.append("shift-up") }
    func keysView(_ view: KeysView, insertAlternate text: String, for key: Key) {}
    func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool) {}
    func keysView(_ view: KeysView, moveCursor offset: Int) {}
    func keysView(_ view: KeysView, inputModeListWith event: UIEvent) {}
    func keysViewFinishedPageSlide(_ view: KeysView) {}
    func keysViewDidLayout(_ view: KeysView) {}
  }
}
