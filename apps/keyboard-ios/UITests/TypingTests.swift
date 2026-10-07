import XCTest

/// End-to-end typing through the in-app keyboard: real touches on real key views.
@MainActor
final class TypingTests: XCTestCase {
  var app: XCUIApplication!

  override func setUp() {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKResetLearning", "-PKResetSettings"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
  }

  func waitForText(_ expected: String, timeout: TimeInterval = 3) {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline, app.previewText != expected { usleep(100_000) }
    XCTAssertEqual(app.previewText, expected)
  }

  func center(of identifier: String) -> CGPoint {
    let frame = app.key(identifier).frame
    return CGPoint(x: frame.midX, y: frame.midY)
  }

  func testCapitalizesAndAutocorrects() {
    app.typeOnPreview("i think teh cat is wierd")
    app.key("key-numbers").tap()
    app.key("key-.").tap()
    waitForText("I think the cat is weird.")
  }

  func testDeleteRightAfterAutocorrectRestoresTheWord() {
    app.typeOnPreview("and teh ")
    waitForText("And the ")
    app.key("key-delete").tap()
    waitForText("And teh")
    app.typeOnPreview(" ")
    waitForText("And teh ")
  }

  func testDoubleSpaceTypesAPeriodAndCapitalizes() {
    app.typeOnPreview("ok  so")
    waitForText("Ok. So")
  }

  func testSuggestionsCompleteWords() {
    app.typeOnPreview("beau")
    // Sentence start, so suggestions are capitalized like the word.
    let slot = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Beautiful")).firstMatch
    XCTAssertTrue(slot.waitForExistence(timeout: 3), app.debugDescription)
    slot.tap()
    waitForText("Beautiful ")
  }

  func testPredictionsAfterASpace() {
    app.typeOnPreview("thank ")
    let you = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "you")).firstMatch
    XCTAssertTrue(you.waitForExistence(timeout: 3))
  }

  func testCapsLock() {
    app.typeOnPreview("x ")
    let shift = app.key("key-shift")
    shift.doubleTap()
    app.typeOnPreview("ab")
    waitForText("X AB")
  }

  func testSwipeTypesWordsWithAutomaticSpaces() throws {
    try TouchPath.swipe(through: ["h", "e", "l", "o"].map { center(of: "key-\($0)") })
    waitForText("Hello")
    try TouchPath.swipe(through: ["w", "o", "r", "l", "d"].map { center(of: "key-\($0)") })
    waitForText("Hello world")
    // Delete right after a swipe removes the whole word.
    app.key("key-delete").tap()
    waitForText("Hello ")
    try TouchPath.swipe(through: ["t", "h", "e", "r", "e"].map { center(of: "key-\($0)") })
    waitForText("Hello there")
  }

  func testLongPressShowsAccents() {
    let e = app.key("key-e")
    let start = e.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    // The strip opens over the key with "e" first; drag one cell right to "è".
    let target = start.withOffset(CGVector(dx: e.frame.width * 1.05, dy: -8))
    start.press(forDuration: 0.8, thenDragTo: target)
    waitForText("È")
  }

  func testSlideFromNumbersKeyTypesASymbolAndReturns() {
    app.typeOnPreview("a")
    let numbers = app.key("key-numbers").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let zeroFrame = app.key("key-p").frame
    numbers.press(forDuration: 0.15, thenDragTo: app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: zeroFrame.midX, dy: zeroFrame.midY)))
    waitForText("A0")
    XCTAssertTrue(app.key("key-q").exists, "Should be back on letters")
  }

  func testEmojiPanelInsertsEmoji() {
    app.typeOnPreview("hi ")
    app.key("key-emoji").tap()
    let grin = app.descendants(matching: .any).matching(identifier: "emoji-😀").firstMatch
    XCTAssertTrue(grin.waitForExistence(timeout: 4))
    grin.tap()
    app.descendants(matching: .any).matching(identifier: "emoji-abc").firstMatch.tap()
    waitForText("Hi 😀")
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 2))
  }

  func testDeleteHoldRemovesWords() {
    app.typeOnPreview("one two three four five six")
    app.key("key-delete").press(forDuration: 3.2)
    let remaining = app.previewText
    XCTAssertLessThan(remaining.count, "One two three four five six".count - 12, "Holding delete should speed up to whole words: \(remaining)")
  }
}
