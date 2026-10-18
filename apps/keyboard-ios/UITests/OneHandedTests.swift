import XCTest

/// One-handed layouts end to end: the emoji key's menu, typing, tap correction,
/// swiping and gestures on the docked keys, the side controls, and persistence,
/// in the in-app preview and the installed extension.
@MainActor
final class OneHandedTests: XCTestCase {
  var app: XCUIApplication!

  override func setUp() {
    continueAfterFailure = false
    app = XCUIApplication()
  }

  // MARK: Hosts

  private func launchPreview(_ extra: [String] = []) {
    app.launchArguments = ["-PKPreview", "-PKResetLearning", "-PKResetSettings"] + extra
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
  }

  private var systemField: XCUIElement {
    app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
  }

  private func launchInstalled(_ extra: [String] = []) {
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard", "-PKResetLearning", "-PKResetSettings"] + extra
    app.launch()
    XCTAssertTrue(systemField.waitForExistence(timeout: 8))
    if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { systemField.tap() }
    for _ in 0..<4 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = app.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active:\n\(app.debugDescription)")
  }

  private var text: String {
    if app.textViews["preview-text"].exists { return app.previewText }
    let value = systemField.value as? String ?? ""
    return value == "Type here" ? "" : value
  }

  private func waitForText(_ expected: String, timeout: TimeInterval = 4, file: StaticString = #filePath, line: UInt = #line) {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline, text != expected { usleep(100_000) }
    XCTAssertEqual(text, expected, file: file, line: line)
  }

  private func type(_ letters: String) {
    for character in letters {
      app.key(character == " " ? "key-space" : "key-\(character)").tap()
    }
  }

  private func center(_ letter: Character) -> CGPoint {
    let frame = app.key("key-\(letter)").frame
    return CGPoint(x: frame.midX, y: frame.midY)
  }

  private func swipe(_ word: String) throws {
    try TouchPath.swipe(through: word.map(center))
  }

  private func tap(at point: CGPoint) {
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
  }

  /// Waits for the layout to settle where `condition` holds.
  private func waitFor(_ description: String, file: StaticString = #filePath, line: UInt = #line, _ condition: () -> Bool) {
    let deadline = Date().addingTimeInterval(3)
    while Date() < deadline, !condition() { usleep(100_000) }
    XCTAssertTrue(condition(), description, file: file, line: line)
  }

  /// Holds the emoji key, slides `cells` menu cells (negative is left) and lifts.
  private func chooseFromEmojiMenu(cells: CGFloat) {
    let emoji = app.key("key-emoji")
    let start = emoji.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    start.press(forDuration: 0.8, thenDragTo: start.withOffset(CGVector(dx: cells * max(emoji.frame.width, 44), dy: -4)))
  }

  // MARK: Flow

  private func dockedRoundTrip(prefix: String) throws {
    let fullQ = app.key("key-q").frame
    let fullP = app.key("key-p").frame
    XCTAssertFalse(app.key("one-handed-expand").exists)

    chooseFromEmojiMenu(cells: 1)
    let expand = app.key("one-handed-expand")
    XCTAssertTrue(expand.waitForExistence(timeout: 2), "Holding emoji and sliding right should dock right")
    XCTAssertFalse(app.key("emoji-panel").exists, "Choosing a layout doesn't open the picker")
    waitFor("Docked right") { app.key("key-q").frame.minX > fullQ.minX + 30 }
    let q = app.key("key-q").frame
    let p = app.key("key-p").frame
    XCTAssertEqual(p.maxX, fullP.maxX, accuracy: 1.5)
    XCTAssertLessThan(p.width, fullP.width)
    XCTAssertEqual(p.height, fullP.height, accuracy: 0.5)
    XCTAssertGreaterThanOrEqual(q.width, 25.5)
    XCTAssertLessThan(expand.frame.maxX, q.minX, "The side controls sit left of the keys")
    XCTAssertEqual(expand.label, "Full width keyboard")
    XCTAssertEqual(app.key("one-handed-move").label, "Move keyboard left")
    snapshot("\(prefix)-one-handed-right")

    // Taps at the docked caps, then swipes over them.
    type("hello ")
    waitForText("Hello ")
    try swipe("world")
    waitForText("Hello world")

    app.key("one-handed-move").tap()
    waitFor("Docked left") { abs(app.key("key-q").frame.minX - fullQ.minX) < 1.5 }
    XCTAssertLessThan(app.key("key-p").frame.maxX, fullP.maxX - 30)
    XCTAssertGreaterThan(app.key("one-handed-move").frame.minX, app.key("key-p").frame.maxX)
    XCTAssertEqual(app.key("one-handed-move").label, "Move keyboard right")
    snapshot("\(prefix)-one-handed-left")
    try swipe("there")
    waitForText("Hello world there")

    // A tap just inside F's half of the F|G gap, then ordinary taps.
    app.key("key-space").tap()
    let f = app.key("key-f").frame
    let g = app.key("key-g").frame
    tap(at: CGPoint(x: (f.maxX + g.minX) / 2 - 1, y: f.midY))
    type("or ")
    waitForText("Hello world there for ")

    // Swiping left from delete removes a word; the bar's Undo puts it back.
    let delete = app.key("key-delete").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    let pitch = app.key("key-w").frame.minX - app.key("key-q").frame.minX
    delete.press(forDuration: 0.05, thenDragTo: delete.withOffset(CGVector(dx: -pitch * 1.1, dy: 0)), withVelocity: 600, thenHoldForDuration: 0.05)
    waitForText("Hello world there ")
    let undo = app.buttons["undo-delete"]
    XCTAssertTrue(undo.waitForExistence(timeout: 2))
    XCTAssertLessThan(undo.frame.maxX, app.key("key-p").frame.maxX + 1, "The bar is docked with the keys")
    undo.tap()
    waitForText("Hello world there for ")

    // Caps lock and return on the docked edges.
    app.key("key-shift").doubleTap()
    type("ok")
    waitForText("Hello world there for OK")
    app.key("key-shift").tap()
    app.key("key-return").tap()
    waitForText("Hello world there for OK\n")

    // Accents still open over the docked key.
    let e = app.key("key-e")
    let held = e.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    held.press(forDuration: 0.8, thenDragTo: held.withOffset(CGVector(dx: e.frame.width * 1.05, dy: -8)))
    waitFor("An accent from the docked E") { text == "Hello world there for OK\nè" || text == "Hello world there for OK\nÈ" }

    // Dragging the docked space bar moves the cursor: the next letter lands
    // inside the text instead of at its end.
    let before = text
    let space = app.key("key-space").coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
    space.press(forDuration: 0.7, thenDragTo: space.withOffset(CGVector(dx: -60, dy: 0)), withVelocity: 120, thenHoldForDuration: 0.2)
    app.key("key-z").tap()
    waitFor("A letter typed after the cursor moved") { text.count == before.count + 1 }
    XCTAssertFalse(text.hasSuffix("z") || text.hasSuffix("Z"), text)

    expand.tap()
    waitFor("Full width again") { abs(app.key("key-p").frame.maxX - fullP.maxX) < 1.5 && abs(app.key("key-q").frame.minX - fullQ.minX) < 1.5 }
    XCTAssertFalse(app.key("one-handed-expand").exists)
    XCTAssertEqual(app.key("key-p").frame.width, fullP.width, accuracy: 0.5)
  }

  func testDockedTypingSwipingAndSideControlsInPreview() throws {
    launchPreview()
    try dockedRoundTrip(prefix: "preview")
  }

  func testDockedTypingSwipingAndSideControlsInInstalledKeyboard() throws {
    if ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26 {
      throw XCTSkip("Multi-point touch synthesis doesn't reach keyboard extensions before iOS 26")
    }
    launchInstalled()
    try dockedRoundTrip(prefix: "installed")
  }

  /// Holding emoji and lifting in place, or beside the menu, changes nothing;
  /// sliding left docks left; a quick tap still opens the picker.
  func testEmojiMenuKeepsTheLayoutUnlessAChoiceIsMade() {
    launchPreview()
    let fullP = app.key("key-p").frame
    chooseFromEmojiMenu(cells: 0)
    sleep(1)
    XCTAssertFalse(app.key("one-handed-expand").exists)
    XCTAssertFalse(app.key("emoji-panel").exists)
    chooseFromEmojiMenu(cells: 7)
    sleep(1)
    XCTAssertFalse(app.key("one-handed-expand").exists, "Lifting beside the menu cancels")
    chooseFromEmojiMenu(cells: -1)
    XCTAssertTrue(app.key("one-handed-expand").waitForExistence(timeout: 2))
    waitFor("Docked left") { app.key("key-p").frame.maxX < fullP.maxX - 30 }
    app.key("key-emoji").tap()
    XCTAssertTrue(app.key("emoji-panel").waitForExistence(timeout: 4))
    XCTAssertEqual(app.key("emoji-panel").frame.width, app.windows.firstMatch.frame.width, accuracy: 1, "The picker keeps the full width")
    snapshot("preview-one-handed-emoji-panel")
    app.buttons["emoji-abc"].tap()
    XCTAssertTrue(app.key("one-handed-expand").waitForExistence(timeout: 2), "Back on the letters, still docked")
    // Numbers and symbols dock the same way.
    app.key("key-numbers").tap()
    XCTAssertTrue(app.key("key-0").waitForExistence(timeout: 2))
    XCTAssertLessThan(app.key("key-0").frame.maxX, fullP.maxX - 30)
    app.key("key-symbols").tap()
    XCTAssertLessThan(app.key("key-=").frame.maxX, fullP.maxX - 30)
    snapshot("preview-one-handed-symbols")
    app.key("key-letters").tap()
    app.key("one-handed-expand").tap()
    waitFor("Full width") { abs(app.key("key-p").frame.maxX - fullP.maxX) < 1.5 }
  }

  /// The choice outlives the keyboard and the app, and the settings screen
  /// shows and changes the same value.
  func testLayoutPersistsAndFollowsTheSettingsScreen() {
    launchPreview(["-PKOneHanded", "left"])
    XCTAssertTrue(app.key("one-handed-expand").waitForExistence(timeout: 2))
    let dockedP = app.key("key-p").frame
    app.terminate()
    app.launchArguments = ["-PKPreview"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    XCTAssertTrue(app.key("one-handed-expand").waitForExistence(timeout: 2), "Docking persists across launches")
    XCTAssertEqual(app.key("key-p").frame.maxX, dockedP.maxX, accuracy: 1)

    app.navigationBars.buttons.element(boundBy: 0).tap()
    let setting = app.key("one-handed-setting")
    for _ in 0..<6 where !(setting.exists && setting.isHittable) { app.swipeUp() }
    XCTAssertTrue(setting.isHittable, app.debugDescription)
    XCTAssertTrue(setting.label.contains("Left") || (setting.value as? String) == "Left", "\(setting.label) \(String(describing: setting.value))")
    setting.tap()
    let right = app.buttons["Right"].firstMatch
    XCTAssertTrue(right.waitForExistence(timeout: 2))
    right.tap()
    for _ in 0..<6 where !app.key("try-it").isHittable { app.swipeDown() }
    app.key("try-it").tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 6))
    XCTAssertTrue(app.key("one-handed-expand").waitForExistence(timeout: 2))
    XCTAssertGreaterThan(app.key("key-q").frame.minX, app.key("one-handed-expand").frame.maxX, "Docked right from Settings")
    app.key("one-handed-expand").tap()
    XCTAssertFalse(app.key("one-handed-expand").waitForExistence(timeout: 1))
  }

  /// The extension reads the shared choice and keeps a change made on its keys.
  func testInstalledKeyboardSharesTheChoice() {
    launchInstalled(["-PKOneHanded", "right"])
    XCTAssertTrue(app.key("one-handed-expand").waitForExistence(timeout: 3))
    snapshot("installed-one-handed-shared")
    app.key("one-handed-move").tap()
    let p = app.key("key-p").frame
    app.terminate()
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard"]
    app.launch()
    if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { systemField.tap() }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 6))
    XCTAssertTrue(app.key("one-handed-expand").waitForExistence(timeout: 2))
    XCTAssertEqual(app.key("key-p").frame.maxX, p.maxX, accuracy: 1, "Docked left after relaunch")
    app.key("one-handed-expand").tap()
    XCTAssertFalse(app.key("one-handed-expand").waitForExistence(timeout: 1))
  }
}
