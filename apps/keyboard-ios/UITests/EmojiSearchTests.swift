import XCTest

/// Searching the emoji picker from its search field, in the in-app preview and
/// in the installed extension: the query is the keyboard's own buffer, results
/// go into the document, and the way back leads to the picker or the letters.
@MainActor
final class EmojiSearchTests: XCTestCase {
  var app: XCUIApplication!

  override func setUp() {
    continueAfterFailure = false
    app = XCUIApplication()
  }

  // MARK: Hosts

  private func launchPreview() {
    app.launchArguments = ["-PKPreview", "-PKResetLearning", "-PKResetSettings"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
  }

  private var systemField: XCUIElement {
    app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
  }

  private func launchInstalled() {
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard", "-PKResetLearning", "-PKResetSettings"]
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

  private var field: XCUIElement { app.key("emoji-search-field") }
  private var query: String { (field.value as? String) ?? "" }

  private func waitForQuery(_ expected: String, file: StaticString = #filePath, line: UInt = #line) {
    let deadline = Date().addingTimeInterval(3)
    while Date() < deadline, query != expected { usleep(100_000) }
    XCTAssertEqual(query, expected, file: file, line: line)
  }

  private func result(_ emoji: String) -> XCUIElement { app.key("emoji-result-\(emoji)") }

  private func openSearch() {
    app.key("key-emoji").tap()
    let open = app.key("emoji-search-open")
    XCTAssertTrue(open.waitForExistence(timeout: 6), app.debugDescription)
    XCTAssertTrue(open.isHittable)
    open.tap()
    XCTAssertTrue(field.waitForExistence(timeout: 3))
  }

  // MARK: Flow

  /// The whole search round trip; the same steps run in both hosts.
  private func searchRoundTrip(prefix: String) {
    type("hi ")
    waitForText("Hi ")
    openSearch()
    snapshot("\(prefix)-search-empty")
    XCTAssertEqual(field.label, "Search emoji")
    XCTAssertTrue(app.key("key-q").exists && app.key("key-letters").exists && app.key("key-space").exists)
    XCTAssertFalse(app.key("suggestion-0").exists && app.key("suggestion-0").isHittable, "The suggestion bar gives way to the search row")
    // An empty query offers recent and popular emoji right away.
    XCTAssertTrue(result("😂").waitForExistence(timeout: 2))

    type("pizza")
    waitForQuery("pizza")
    XCTAssertEqual(text, "Hi ", "Typing a query must not touch the document")
    XCTAssertTrue(result("🍕").waitForExistence(timeout: 2))
    XCTAssertEqual(result("🍕").label, "pizza")
    snapshot("\(prefix)-search-pizza")
    result("🍕").tap()
    waitForText("Hi 🍕")
    XCTAssertTrue(field.exists, "Search stays open for another pick")
    XCTAssertEqual(query, "pizza")

    // Delete edits the query only, and stops at an empty field.
    for _ in 0..<7 { app.key("key-delete").tap() }
    waitForQuery("")
    waitForText("Hi 🍕")

    // Space separates words; more words narrow the strip.
    type("red heart")
    waitForQuery("red heart")
    XCTAssertTrue(result("❤️").waitForExistence(timeout: 2))
    result("❤️").tap()
    waitForText("Hi 🍕❤️")

    // A wide query scrolls sideways.
    for _ in 0..<9 { app.key("key-delete").tap() }
    type("face")
    waitForQuery("face")
    let strip = app.key("emoji-search-results")
    let cells = strip.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'emoji-result-'"))
    XCTAssertGreaterThan(cells.count, 10)
    let first = cells.element(boundBy: 0)
    let later = cells.element(boundBy: 9)
    XCTAssertTrue(first.isHittable)
    XCTAssertFalse(later.isHittable)
    strip.swipeLeft()
    XCTAssertFalse(first.isHittable, "The strip should scroll sideways")
    XCTAssertGreaterThan(cells.count, 10)
    XCTAssertEqual(text, "Hi 🍕❤️", "Scrolling the strip picks nothing")

    // Nothing found says so.
    for _ in 0..<4 { app.key("key-delete").tap() }
    type("xqzq")
    XCTAssertTrue(app.key("emoji-search-empty").waitForExistence(timeout: 2))
    snapshot("\(prefix)-search-none")

    // Back returns to the picker, where the picks are now recent.
    app.key("emoji-search-back").tap()
    XCTAssertTrue(app.key("emoji-panel").waitForExistence(timeout: 2))
    XCTAssertFalse(field.exists)
    app.buttons["Frequently Used"].tap()
    let grid = app.collectionViews.firstMatch.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'emoji-'"))
    XCTAssertTrue(grid.element(boundBy: 1).waitForExistence(timeout: 2))
    // Newest first, down the first column.
    let heart = grid.element(boundBy: 0)
    XCTAssertEqual(heart.identifier, "emoji-❤️")
    let pizza = app.collectionViews.firstMatch.descendants(matching: .any).matching(identifier: "emoji-🍕").firstMatch
    XCTAssertTrue(pizza.isHittable)
    XCTAssertEqual(pizza.frame.minX, heart.frame.minX, accuracy: 1)
    XCTAssertGreaterThan(pizza.frame.minY, heart.frame.minY)

    // Searching again starts empty; ABC goes straight to the letters.
    app.key("emoji-search-open").tap()
    XCTAssertTrue(field.waitForExistence(timeout: 2))
    XCTAssertEqual(query, "")
    app.key("key-letters").tap()
    XCTAssertTrue(app.key("key-numbers").waitForExistence(timeout: 2))
    XCTAssertFalse(field.exists)
    type(" so")
    waitForText("Hi 🍕❤️ so")
  }

  func testSearchInPreview() {
    launchPreview()
    searchRoundTrip(prefix: "preview")
  }

  func testSearchInInstalledKeyboard() {
    launchInstalled()
    searchRoundTrip(prefix: "installed")
  }

  /// The emoji key returns to the picker, and shift types capitals into the
  /// query without changing the matches. Run with the simulator in dark
  /// appearance for the dark screenshots.
  func testEmojiKeyAndShiftInInstalledKeyboard() {
    launchInstalled()
    openSearch()
    app.key("key-shift").tap()
    type("cat")
    waitForQuery("Cat")
    XCTAssertTrue(result("🐈").waitForExistence(timeout: 2))
    snapshot("installed-search-shift")
    app.key("key-emoji").tap()
    XCTAssertTrue(app.key("emoji-panel").waitForExistence(timeout: 2))
    XCTAssertFalse(field.exists)
    snapshot("installed-panel-after-search")
    app.buttons["emoji-abc"].tap()
    XCTAssertTrue(app.key("key-numbers").waitForExistence(timeout: 2))
    waitForText("")
  }

  /// Another kind of field ends the search with that field's own keys.
  func testSwitchingFieldsEndsSearch() {
    launchPreview()
    openSearch()
    type("dog")
    waitForQuery("dog")
    app.segmentedControls["field-kind"].buttons["Email"].tap()
    XCTAssertTrue(app.key("key-@").waitForExistence(timeout: 3))
    XCTAssertFalse(field.exists)
    type("hi")
    waitForText("hi")
  }

  /// The keyboard going away and coming back starts from the letter keys, with
  /// no stale query, and typing goes to the document again.
  func testReappearingResetsSearch() {
    launchInstalled()
    openSearch()
    type("dog")
    waitForQuery("dog")
    XCUIDevice.shared.press(.home)
    sleep(1)
    app.activate()
    if !app.key("key-q").waitForExistence(timeout: 4) { systemField.tap() }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 6))
    XCTAssertFalse(field.exists)
    XCTAssertTrue(app.key("key-numbers").exists)
    type("ok")
    waitForText("Ok")
    app.key("key-emoji").tap()
    app.key("emoji-search-open").tap()
    XCTAssertTrue(field.waitForExistence(timeout: 2))
    XCTAssertEqual(query, "")
  }
}
