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

  func testSpaceOffersAccessibleCursorStepsWithoutTypingASpace() throws {
    let space = try XCTUnwrap(keys.keyViews.first { $0.key.identifier == "key-space" })
    let actions = try XCTUnwrap(space.accessibilityCustomActions)
    XCTAssertEqual(actions.map(\.name), ["Move cursor left", "Move cursor right"])
    for action in actions { XCTAssertEqual(action.actionHandler?(action), true) }
    XCTAssertEqual(recorder.cursorOffsets, [-1, 1])
    XCTAssertTrue(recorder.events.isEmpty, "Cursor actions must not type a space")
    recorder.allowsCursorMovement = false
    XCTAssertNil(space.accessibilityCustomActions, "Search must not offer to move the host caret")
    XCTAssertEqual(actions[0].actionHandler?(actions[0]), false, "An old action must respect the current mode")
    XCTAssertEqual(recorder.cursorOffsets, [-1, 1])
  }

  func testDisabledReturnIsAnnouncedAndCannotActivate() throws {
    let key = try XCTUnwrap(keys.keyViews.first { $0.key.action == .returnKey })
    keys.returnEnabled = false
    XCTAssertTrue(key.accessibilityTraits.contains(.notEnabled))
    XCTAssertFalse(key.accessibilityActivate())
    XCTAssertTrue(recorder.events.isEmpty)
    keys.returnEnabled = true
    XCTAssertFalse(key.accessibilityTraits.contains(.notEnabled))
    XCTAssertTrue(key.accessibilityActivate())
    XCTAssertEqual(recorder.activations, [key.key.identifier])
  }

  func testNumberPadSpacerIsNotAnAccessibleEmptyKey() throws {
    var traits = InputTraits()
    traits.keyboard = .numberPad
    keys.setLayout(KeyboardLayout.make(page: .letters, traits: traits, needsGlobe: false, digitHints: false), style: keys.style)
    let blank = try XCTUnwrap(keys.keyViews.first { $0.key.action == .text("") })
    XCTAssertFalse(blank.isAccessibilityElement)
    XCTAssertFalse(blank.accessibilityActivate())
    XCTAssertTrue(recorder.events.isEmpty)
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

  func testSlideFromShiftAcrossLettersTypesTheLastLetterInsteadOfSwiping() {
    let contact = touch("key-shift")
    keys.touchesBegan([contact], with: nil)
    for letter in ["key-z", "key-a", "key-s", "key-e"] {
      contact.point = touch(letter).point
      keys.touchesMoved([contact], with: nil)
    }
    keys.touchesEnded([contact], with: nil)
    XCTAssertTrue(recorder.glidePaths.isEmpty)
    XCTAssertEqual(recorder.activations, ["key-e"])
    XCTAssertTrue(recorder.events.contains("shift-up"))
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

  func testGlideIncludesTheFinalLiftLocation() {
    let contact = touch("key-h")
    let start = contact.point
    keys.touchesBegan([contact], with: nil)
    contact.point = touch("key-e").point
    keys.touchesMoved([contact], with: nil)
    contact.point = touch("key-l").point
    keys.touchesMoved([contact], with: nil)
    contact.point = touch("key-o").point
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.glidePaths.first?.first, start)
    XCTAssertEqual(recorder.glidePaths.first?.last, contact.point)
  }

  func testAdjacentLetterSwipesReachTheDecoder() {
    for (first, last) in [("key-w", "key-e"), ("key-a", "key-s")] {
      recorder.events = []
      recorder.glidePaths = []
      let contact = touch(first)
      let start = contact.point
      let end = touch(last).point
      keys.touchesBegan([contact], with: nil)
      contact.point = CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
      keys.touchesMoved([contact], with: nil)
      contact.point = end
      keys.touchesMoved([contact], with: nil)
      keys.touchesEnded([contact], with: nil)
      XCTAssertEqual(recorder.glidePaths.count, 1)
      XCTAssertEqual(recorder.glidePaths.first?.last, end)
      XCTAssertTrue(recorder.activations.isEmpty)
    }
  }

  func testGlideCarriesTouchAndCoalescedTimestamps() {
    let contact = touch("key-h", time: 10)
    keys.touchesBegan([contact], with: nil)
    let e = touch("key-e", time: 10.016)
    let l = touch("key-l", time: 10.033)
    contact.point = l.point
    contact.time = l.time
    keys.touchesMoved([contact], with: ContactEvent(samples: [e, l]))
    let o = touch("key-o", time: 10.05)
    contact.point = o.point
    contact.time = o.time
    keys.touchesEnded([contact], with: ContactEvent(samples: [o]))
    // The main touch repeats the last coalesced sample; neither list doubles it.
    XCTAssertEqual(recorder.glidePaths.first, [touch("key-h").point, e.point, l.point, o.point])
    XCTAssertEqual(recorder.glideTimes.first, [10, 10.016, 10.033, 10.05])
  }

  func testCoalescedLiftCanContainTheEntireShortSwipe() {
    let contact = touch("key-w")
    let start = contact.point
    let end = touch("key-e")
    let middle = Contact(point: CGPoint(x: (start.x + end.point.x) / 2, y: start.y), time: 0.04)
    keys.touchesBegan([contact], with: nil)
    contact.point = end.point
    keys.touchesEnded([contact], with: ContactEvent(samples: [middle, end]))
    XCTAssertEqual(recorder.glidePaths.first, [start, middle.point, end.point])
    XCTAssertTrue(recorder.activations.isEmpty)
  }

  func testCoalescedLoopCanReturnToTheStartingKeyBeforeLift() {
    let contact = touch("key-w")
    let start = contact.point
    let turn = touch("key-o")
    let end = touch("key-w")
    keys.touchesBegan([contact], with: nil)
    keys.touchesEnded([contact], with: ContactEvent(samples: [turn, end]))
    XCTAssertEqual(recorder.glidePaths.first, [start, turn.point, start])
    XCTAssertTrue(recorder.activations.isEmpty)
  }

  func testSmallCoalescedThumbRollsRemainTaps() {
    for letter in "qwertyuiopasdfghjklzxcvbnm" {
      for direction: CGFloat in [-1, 1] {
        recorder.events = []
        recorder.glidePaths = []
        let identifier = "key-\(letter)"
        let contact = touch(identifier)
        let start = contact.point
        let middle = Contact(point: CGPoint(x: start.x + direction * keys.pitch.width * 0.2, y: start.y), time: 0.04)
        let end = Contact(point: CGPoint(x: start.x + direction * keys.pitch.width * 0.4, y: start.y), time: 0.08)
        keys.touchesBegan([contact], with: nil)
        contact.point = end.point
        keys.touchesEnded([contact], with: ContactEvent(samples: [middle, end]))
        XCTAssertTrue(recorder.glidePaths.isEmpty)
        XCTAssertEqual(recorder.activations, [identifier])
        XCTAssertEqual(recorder.activationPoints.last, start)
      }
    }
  }

  func testGlideIncludesCoalescedLiftSamplesAndDeduplicatesTheLift() {
    let contact = touch("key-h")
    keys.touchesBegan([contact], with: nil)
    contact.point = touch("key-e").point
    keys.touchesMoved([contact], with: nil)
    let middle = touch("key-l")
    let end = touch("key-o")
    contact.point = end.point
    keys.touchesEnded([contact], with: ContactEvent(samples: [middle, end]))
    XCTAssertEqual(recorder.glidePaths.first?.suffix(2), [middle.point, end.point])
    XCTAssertEqual(recorder.glidePaths.first?.count, 4)
  }

  func testLiftCompletesAShortGlideWithoutDuplicatingTheLastSample() {
    let contact = touch("key-f")
    let start = contact.point
    keys.touchesBegan([contact], with: nil)
    contact.point.x += keys.pitch.width * 0.8
    keys.touchesMoved([contact], with: nil)
    contact.point.x += keys.pitch.width * 0.8
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.glidePaths.first?.count, 3)
    XCTAssertEqual(recorder.glidePaths.first?.first, start)
    XCTAssertEqual(recorder.glidePaths.first?.last, contact.point)

    let next = touch("key-f")
    keys.touchesBegan([next], with: nil)
    next.point = touch("key-h").point
    keys.touchesMoved([next], with: nil)
    keys.touchesEnded([next], with: nil)
    XCTAssertEqual(recorder.glidePaths.last?.count, 2)
  }

  func testCoalescedMoveRecognizesALoopBeforeLongPressCanTakeIt() {
    let contact = touch("key-w")
    let start = contact.point
    keys.touchesBegan([contact], with: nil)
    let turn = touch("key-o")
    let returned = touch("key-w")
    keys.touchesMoved([contact], with: ContactEvent(samples: [turn, returned]))
    XCTAssertEqual(keys.stats.glides, 1, "The completed loop must own the gesture before the alternate timer can fire")
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.glidePaths.first, [start, turn.point, start])
    XCTAssertTrue(recorder.activations.isEmpty)
  }

  func testSmallCoalescedMoveLoopsRemainTaps() {
    for direction: CGFloat in [-1, 1] {
      recorder.events = []
      let contact = touch("key-w")
      let start = contact.point
      keys.touchesBegan([contact], with: nil)
      let turn = Contact(point: CGPoint(x: start.x + direction * keys.pitch.width * 0.4, y: start.y), time: 0.04)
      keys.touchesMoved([contact], with: ContactEvent(samples: [turn, contact]))
      XCTAssertEqual(keys.stats.glides, 0)
      keys.touchesEnded([contact], with: nil)
      XCTAssertEqual(recorder.activations, ["key-w"])
      XCTAssertTrue(recorder.glidePaths.isEmpty)
    }
  }

  func testColorsDoNotInvalidateASwipe() {
    let contact = touch("key-h")
    keys.touchesBegan([contact], with: nil)
    contact.point = touch("key-e").point
    keys.touchesMoved([contact], with: nil)
    let original = keys.style
    keys.setLayout(keys.layout, style: KeyboardStyle(modern: original.modern, dark: !original.dark, landscape: original.landscape, inset: original.inset))
    keys.layoutIfNeeded()
    contact.point = touch("key-o").point
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.glidePaths.count, 1)
    XCTAssertTrue(recorder.activations.isEmpty)
  }

  func testResizingCancelsAPendingLetterWithoutTypingIt() {
    let contact = touch("key-a")
    keys.touchesBegan([contact], with: nil)
    keys.frame.size.width = 700
    keys.setNeedsLayout()
    keys.layoutIfNeeded()
    keys.touchesEnded([contact], with: nil)
    XCTAssertTrue(recorder.activations.isEmpty)
    XCTAssertTrue(recorder.glidePaths.isEmpty)
  }

  func testPageKeySlideSurvivesItsOwnLetterGeometryChange() {
    let contact = touch("key-numbers")
    recorder.onTouchDown = { [unowned self] key in
      if case .page = key.action { keys.setLayout(layout(.numbers), style: keys.style) }
    }
    keys.touchesBegan([contact], with: nil)
    contact.point = touch("key-1").point
    keys.touchesMoved([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.activations, ["key-1"])
    XCTAssertEqual(recorder.pageSlideFinishes, 1)
  }

  func testSameBoundsMetricChangeRefreshesGeometry() {
    let oldCenters = keys.letterCenters
    let oldLayouts = recorder.layouts
    let insetStyle = KeyboardStyle(modern: true, dark: false, landscape: false, inset: true)
    keys.setLayout(keys.layout, style: insetStyle)
    keys.layoutIfNeeded()
    XCTAssertNotEqual(keys.letterCenters, oldCenters)
    XCTAssertEqual(recorder.layouts, oldLayouts + 1)
  }

  func testResizingDuringASwipeDoesNotDecodeMixedCoordinateFrames() {
    let contact = touch("key-t")
    keys.touchesBegan([contact], with: nil)
    contact.point = touch("key-y").point
    keys.touchesMoved([contact], with: nil)
    XCTAssertEqual(keys.stats.glides, 1)
    keys.frame.size.width = 700
    keys.setNeedsLayout()
    keys.layoutIfNeeded()
    contact.point = touch("key-s").point
    keys.touchesMoved([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertTrue(recorder.glidePaths.isEmpty)
    XCTAssertTrue(recorder.activations.isEmpty)
    // The first new gesture after rotation still works normally.
    let next = touch("key-h")
    keys.touchesBegan([next], with: nil)
    next.point = touch("key-o").point
    keys.touchesMoved([next], with: nil)
    keys.touchesEnded([next], with: nil)
    XCTAssertEqual(recorder.glidePaths.count, 1)
  }

  func testAnIgnoredContactCannotContaminateTheNextSwipe() {
    let first = touch("key-t")
    let palm = touch("key-a", time: 0.1)
    keys.touchesBegan([first], with: nil)
    first.point = touch("key-p").point
    keys.touchesMoved([first], with: nil)
    keys.touchesBegan([palm], with: nil)
    first.point = touch("key-s").point
    keys.touchesEnded([first], with: nil)
    let next = touch("key-w", time: 0.3)
    let nextStart = next.point
    keys.touchesBegan([next], with: nil)
    next.point = touch("key-e").point
    keys.touchesMoved([next], with: nil)
    keys.touchesEnded([next], with: nil)
    keys.touchesEnded([palm], with: nil)
    XCTAssertEqual(recorder.glidePaths.count, 2)
    XCTAssertEqual(recorder.glidePaths.last, [nextStart, next.point])
    XCTAssertTrue(recorder.activations.isEmpty)
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

  private final class ContactEvent: UIEvent {
    let samples: [UITouch]
    init(samples: [UITouch]) {
      self.samples = samples
      super.init()
    }
    override func coalescedTouches(for touch: UITouch) -> [UITouch]? { samples }
  }

  private final class Recorder: KeysViewDelegate {
    var events: [String] = []
    var glides = 0
    var glidePaths: [[CGPoint]] = []
    var glideTimes: [[TimeInterval]] = []
    var allowsGlide = true
    var allowsCursorMovement = true
    var cursorOffsets: [Int] = []
    var layouts = 0
    var activationPoints: [CGPoint] = []
    var onActivate: ((Key) -> Void)?
    var onTouchDown: ((Key) -> Void)?
    var pageSlideFinishes = 0
    var activations: [String] { events.filter { $0.hasPrefix("activate:") }.map { String($0.dropFirst(9)) } }
    var keysViewAllowsGlide: Bool { allowsGlide }
    var keysViewAllowsCursorMovement: Bool { allowsCursorMovement }
    var keysViewShowsPopups: Bool { false }
    func keysView(_ view: KeysView, touchDown key: Key) { events.append("down:\(key.identifier)"); onTouchDown?(key) }
    func keysView(_ view: KeysView, activate key: Key, at point: CGPoint) {
      events.append("activate:\(key.identifier)")
      activationPoints.append(point)
      onActivate?(key)
    }
    func keysView(_ view: KeysView, glide points: [CGPoint], times: [TimeInterval], start: Key) {
      glides += 1
      glidePaths.append(points)
      glideTimes.append(times)
    }
    func keysViewShiftUp(_ view: KeysView) { events.append("shift-up") }
    func keysView(_ view: KeysView, insertAlternate text: String, for key: Key) {}
    func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool) {}
    func keysView(_ view: KeysView, moveCursor offset: Int) { cursorOffsets.append(offset) }
    func keysView(_ view: KeysView, inputModeListWith event: UIEvent) {}
    func keysViewFinishedPageSlide(_ view: KeysView) { pageSlideFinishes += 1 }
    func keysViewDidLayout(_ view: KeysView) { layouts += 1 }
  }
}
