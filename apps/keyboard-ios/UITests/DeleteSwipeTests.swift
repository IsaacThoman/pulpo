import XCTest
import UIKit
@testable import KeyboardUI

/// Delete-key word swipes, driven through UIKit's touch callbacks so the
/// gesture state machine is deterministic.
@MainActor
final class DeleteSwipeTests: XCTestCase {
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

  override func tearDown() async throws {
    keys.cancelAllTouches()
    keys = nil
    recorder = nil
  }

  private func center(_ identifier: String) -> CGPoint {
    let frame = keys.keyViews.first { $0.key.identifier == identifier }!.frame
    return CGPoint(x: frame.midX, y: frame.midY)
  }

  func testSlidingLeftFromDeleteSelectsWordsAndDeletesOnLift() {
    let start = center("key-delete")
    let contact = Contact(point: start)
    keys.touchesBegan([contact], with: nil)
    for step in 1...6 {
      contact.point.x = start.x - CGFloat(step) * keys.pitch.width * 0.4
      keys.touchesMoved([contact], with: nil)
    }
    keys.touchesEnded([contact], with: nil)
    // 2.4 pitches: one word after 0.6, a second after 1.6.
    XCTAssertEqual(recorder.previews, [1, 2])
    XCTAssertEqual(recorder.commits, [2])
    XCTAssertEqual(recorder.deleteEnds, 0)
  }

  func testReturningToDeleteCancelsTheSwipe() {
    let start = center("key-delete")
    let contact = Contact(point: start)
    keys.touchesBegan([contact], with: nil)
    contact.point.x = start.x - keys.pitch.width * 1.8
    keys.touchesMoved([contact], with: nil)
    contact.point.x = start.x - 4
    keys.touchesMoved([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.previews, [2, 0])
    XCTAssertTrue(recorder.commits.isEmpty)
  }

  func testThumbRollOnDeleteStaysATap() {
    let start = center("key-delete")
    let contact = Contact(point: start)
    keys.touchesBegan([contact], with: nil)
    contact.point.x -= 12
    keys.touchesMoved([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertTrue(recorder.previews.isEmpty)
    XCTAssertEqual(recorder.deleteEnds, 1)
  }

  func testFlickThatArrivesOnlyAtLiftStillDeletesAWord() {
    let start = center("key-delete")
    let contact = Contact(point: start)
    keys.touchesBegan([contact], with: nil)
    contact.point.x = start.x - keys.pitch.width
    keys.touchesEnded([contact], with: nil)
    XCTAssertEqual(recorder.commits, [1])
  }

  func testCancelledSwipeClearsThePreviewWithoutDeleting() {
    let start = center("key-delete")
    let contact = Contact(point: start)
    keys.touchesBegan([contact], with: nil)
    contact.point.x = start.x - keys.pitch.width
    keys.touchesMoved([contact], with: nil)
    keys.touchesCancelled([contact], with: nil)
    XCTAssertEqual(recorder.previews, [1, 0])
    XCTAssertTrue(recorder.commits.isEmpty)

    let second = Contact(point: start)
    keys.touchesBegan([second], with: nil)
    second.point.x = start.x - keys.pitch.width
    keys.touchesMoved([second], with: nil)
    keys.cancelAllTouches()
    XCTAssertEqual(recorder.previews, [1, 0, 1, 0])
    XCTAssertTrue(recorder.commits.isEmpty)
  }

  func testOtherFingersAreIgnoredDuringADeleteSwipe() {
    let start = center("key-delete")
    let contact = Contact(point: start)
    keys.touchesBegan([contact], with: nil)
    contact.point.x = start.x - keys.pitch.width
    keys.touchesMoved([contact], with: nil)
    let stray = Contact(point: center("key-a"))
    keys.touchesBegan([stray], with: nil)
    keys.touchesEnded([stray], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertTrue(recorder.activations.isEmpty)
    XCTAssertEqual(recorder.commits, [1])
  }

  func testASecondFingerPreventsADeleteSwipe() {
    let start = center("key-delete")
    let contact = Contact(point: start)
    let held = Contact(point: center("key-shift"))
    keys.touchesBegan([held], with: nil)
    keys.touchesBegan([contact], with: nil)
    contact.point.x = start.x - keys.pitch.width * 2
    keys.touchesMoved([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    keys.touchesEnded([held], with: nil)
    XCTAssertTrue(recorder.previews.isEmpty)
    XCTAssertEqual(recorder.deleteEnds, 1)
  }

  func testNumberPadDeleteHasNoWordSwipe() {
    var traits = InputTraits()
    traits.keyboard = .phonePad
    keys.setLayout(KeyboardLayout.make(page: .letters, traits: traits, needsGlobe: false, digitHints: false), style: keys.style)
    keys.layoutIfNeeded()
    let start = center("key-delete")
    let contact = Contact(point: start)
    keys.touchesBegan([contact], with: nil)
    contact.point.x = start.x - keys.pitch.width
    keys.touchesMoved([contact], with: nil)
    keys.touchesEnded([contact], with: nil)
    XCTAssertTrue(recorder.previews.isEmpty)
    XCTAssertEqual(recorder.deleteEnds, 1)
  }

  private final class Contact: UITouch {
    var point: CGPoint
    init(point: CGPoint) {
      self.point = point
      super.init()
    }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { 0 }
  }

  private final class Recorder: KeysViewDelegate {
    var previews: [Int] = []
    var commits: [Int] = []
    var deleteEnds = 0
    var activations: [String] = []
    var keysViewAllowsGlide: Bool { false }
    var keysViewShowsPopups: Bool { false }
    func keysView(_ view: KeysView, touchDown key: Key) {}
    func keysView(_ view: KeysView, activate key: Key, at point: CGPoint) { activations.append(key.identifier) }
    func keysView(_ view: KeysView, glide points: [CGPoint], times: [TimeInterval], start: Key) {}
    func keysViewShiftUp(_ view: KeysView) {}
    func keysView(_ view: KeysView, insertAlternate text: String, for key: Key) {}
    func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool) {}
    func keysView(_ view: KeysView, moveCursor offset: Int) {}
    func keysView(_ view: KeysView, inputModeListWith event: UIEvent) {}
    func keysViewFinishedPageSlide(_ view: KeysView) {}
    func keysViewDidLayout(_ view: KeysView) {}
    func keysViewDeleteEnded(_ view: KeysView) { deleteEnds += 1 }
    func keysView(_ view: KeysView, previewWordDeletion words: Int) { previews.append(words) }
    func keysView(_ view: KeysView, commitWordDeletion words: Int) { commits.append(words) }
  }
}

/// Delete swipes end to end through the in-app keyboard.
final class DeleteSwipeTypingTests: PreviewTypingTestCase {
  private func swipeLeftFromDelete(by distance: CGFloat) {
    let delete = app.key("key-delete").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    delete.press(forDuration: 0.05, thenDragTo: delete.withOffset(CGVector(dx: -distance, dy: 0)), withVelocity: 600, thenHoldForDuration: 0.05)
  }

  func testDeleteSwipeRemovesWordsAndUndoPutsThemBack() {
    app.typeOnPreview("one two three four ")
    waitForText("One two three four ")
    let pitch = keyPitch
    swipeLeftFromDelete(by: pitch * 2.1)
    waitForText("One two ")
    let undo = app.buttons["undo-delete"]
    XCTAssertTrue(undo.waitForExistence(timeout: 2))
    snapshot("delete-swipe-undo")
    undo.tap()
    waitForText("One two three four ")
    XCTAssertFalse(undo.waitForExistence(timeout: 1), "Undo is offered once")
    app.typeOnPreview("five")
    waitForText("One two three four five")
  }

  func testDeleteSwipePreviewShowsTheWordsAndReturningCancels() throws {
    app.typeOnPreview("one two three four ")
    waitForText("One two three four ")
    let frame = app.key("key-delete").frame
    let start = CGPoint(x: frame.midX, y: frame.midY)
    let pitch = keyPitch
    let left = CGPoint(x: start.x - pitch * 2.1, y: start.y)
    try TouchPath.swipe(through: [start, left, CGPoint(x: start.x + 2, y: start.y)], duration: 0.4)
    // Only delete's own touch-down character goes; the swipe was cancelled.
    waitForText("One two three four")
    XCTAssertFalse(app.buttons["undo-delete"].exists)
  }

  func testDeleteSwipeRightAfterAnAutocorrectionDoesNotLearnTheTypo() {
    app.typeOnPreview("and teh ")
    waitForText("And the ")
    let pitch = keyPitch
    swipeLeftFromDelete(by: pitch * 1.2)
    waitForText("And ")
    app.typeOnPreview("teh ")
    waitForText("And the ")
  }
}
