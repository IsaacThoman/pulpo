import XCTest

/// Exercises the real keyboard extension in a text field, after `KeyboardSetupTests`
/// has enabled it.
@MainActor
final class InstalledKeyboardTests: XCTestCase {
  var app: XCUIApplication!

  override func setUp() {
    continueAfterFailure = false
    if app == nil { app = XCUIApplication() }
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard", "-PKResetLearning", "-PKResetSettings"]
    app.launch()
    let field = app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
    XCTAssertTrue(field.waitForExistence(timeout: 8))
    if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
    for _ in 0..<4 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = app.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active:\n\(app.debugDescription)")
  }

  var fieldText: String {
    let field = app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
    let value = field.value as? String ?? ""
    return value == "Type here" ? "" : value
  }

  func waitForText(_ expected: String, timeout: TimeInterval = 4) {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline, fieldText != expected { usleep(100_000) }
    XCTAssertEqual(fieldText, expected)
  }

  func type(_ text: String) {
    for character in text {
      app.key(character == " " ? "key-space" : "key-\(character)").tap()
    }
  }

  func testGapsAndMarginsTypeTheClosestKeysInExtension() {
    let q = app.key("key-q").frame
    let a = app.key("key-a").frame
    let f = app.key("key-f").frame
    let g = app.key("key-g").frame
    let points = [
      CGPoint(x: q.minX - 2, y: q.midY),
      CGPoint(x: a.minX - 6, y: a.minY - 5),
      CGPoint(x: (f.maxX + g.minX) / 2 - 1, y: f.midY),
    ]
    for (point, expected) in zip(points, ["Q", "Qq", "Qqf"]) {
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
      waitForText(expected)
    }
  }

  func testTypesCapitalizesAndCorrectsInAnotherApp() {
    snapshot("installed-start")
    type("teh cat sat ")
    waitForText("The cat sat ")
    app.key("key-delete").tap()
    type("  ok")
    waitForText("The cat sat. Ok")
  }

  func testSwipeInExtension() throws {
    // XCTest's multi-point synthesizer doesn't reach keyboard extensions on iOS 18
    // simulators; testStraightSwipeInExtension covers swiping there.
    if ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26 {
      throw XCTSkip("Multi-point touch synthesis doesn't reach keyboard extensions before iOS 26")
    }
    func center(_ letter: String) -> CGPoint {
      let frame = app.key("key-\(letter)").frame
      return CGPoint(x: frame.midX, y: frame.midY)
    }
    try TouchPath.swipe(through: ["k", "e", "y", "b", "o", "a", "r", "d"].map(center))
    waitForText("Keyboard")
    try TouchPath.swipe(through: ["w", "o", "r", "k", "s"].map(center))
    waitForText("Keyboard works")
    snapshot("installed-after-swipe")
  }

  /// A straight swipe through the public drag API, which reaches the extension on every runtime.
  func testStraightSwipeInExtension() {
    let t = app.key("key-t").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let o = app.key("key-o").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    t.press(forDuration: 0.05, thenDragTo: o, withVelocity: 600, thenHoldForDuration: 0.05)
    waitForText("To")
  }

  func testKeyPopupsAppear() throws {
    // The app passes the key to the extension, which shows its balloon on appear.
    for letter in ["q", "g", "p"] {
      app.terminate()
      app.launchEnvironment["PK_DEBUG_POPUP"] = "key-\(letter)"
      setUp()
      sleep(1)
      snapshot("installed-popup-\(letter)")
    }
  }
}
