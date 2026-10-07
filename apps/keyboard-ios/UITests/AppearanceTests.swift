import XCTest

/// Screenshots for visual comparison with the system keyboard.
@MainActor
final class AppearanceTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = true
  }

  func testPreviewKeyboardPages() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8), app.debugDescription)
    snapshot("preview-letters")
    app.key("key-numbers").tap()
    snapshot("preview-numbers")
    app.key("key-symbols").tap()
    snapshot("preview-symbols")
    app.key("key-letters").tap()
    app.key("key-emoji").tap()
    sleep(1)
    snapshot("preview-emoji")
  }

  func testFieldLayouts() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    app.segmentedControls["field-kind"].buttons["Email"].tap()
    XCTAssertTrue(app.key("key-@").waitForExistence(timeout: 3))
    snapshot("preview-email")
    app.segmentedControls["field-kind"].buttons["Web"].tap()
    XCTAssertTrue(app.key("key-dotcom").waitForExistence(timeout: 3))
    XCTAssertFalse(app.key("key-space").exists, "URL keyboards have no space bar")
    snapshot("preview-url")
    app.segmentedControls["field-kind"].buttons["Number"].tap()
    XCTAssertTrue(app.key("key-5").waitForExistence(timeout: 3))
    XCTAssertFalse(app.key("key-q").exists)
    snapshot("preview-number")
    app.key("key-4").tap()
    app.key("key-2").tap()
    XCTAssertEqual(app.previewText, "42")
  }

  func testInstalledKeyboard() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard"]
    app.launch()
    let field = app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
    XCTAssertTrue(field.waitForExistence(timeout: 8))
    if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
    // Cycle with the system globe until Pulpo Keyboard is up.
    for _ in 0..<4 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = app.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    sleep(1)
    snapshot("installed-letters")
    print("TREE:\n\(app.debugDescription)")
  }
}
