import XCTest

@MainActor
final class DraftNavigationTests: PreviewTypingTestCase {
  private func returnToTryIt(preview: Bool = true) {
    let link = app.key("try-it")
    // AX5 Settings rows can require more than five native swipes. Keep the
    // same actual navigation and all draft assertions; handle virtualization.
    for _ in 0..<40 where !link.isHittable { app.swipeDown() }
    // At the top, a tall header can leave Try It below the initial viewport.
    for _ in 0..<20 where !link.isHittable { app.swipeUp() }
    XCTAssertTrue(link.exists && link.isHittable)
    link.tap()
    XCTAssertTrue(app.textViews[preview ? "preview-text" : "system-text"].waitForExistence(timeout: 5))
  }

  func testSettingsRoundTripKeepsDraftAndDismissedReturnStaysHidden() {
    app.typeOnPreview("hola")
    let before = app.previewText
    XCTAssertFalse(before.isEmpty)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(app.navigationBars["Keyboard"].waitForExistence(timeout: 5))
    returnToTryIt()
    waitForText(before)
    // Explicitly refocus; restoration itself need not open a keyboard.
    app.textViews["preview-text"].tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3))
    app.buttons["hide-keyboard"].tap()
    app.navigationBars.buttons.element(boundBy: 0).tap()
    returnToTryIt()
    waitForText(before)
    XCTAssertFalse(app.key("key-q").exists)
    XCTAssertFalse(app.buttons["hide-keyboard"].isEnabled)
    app.navigationBars.buttons["Clear"].tap()
    waitForText("")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    returnToTryIt()
    waitForText("")
    XCTAssertFalse(app.key("key-q").exists)
  }

  func testSwitchingModesAndReturningKeepsTextFieldKindAndDismissal() {
    app.typeOnPreview("sample")
    let before = app.previewText
    app.buttons["hide-keyboard"].tap()
    app.buttons["Email"].tap()
    app.buttons["Installed Keyboard"].tap()
    let installed = app.textViews["system-text"]
    XCTAssertTrue(installed.waitForExistence(timeout: 3))
    XCTAssertEqual(installed.value as? String, before)
    XCTAssertFalse(app.buttons["hide-keyboard"].isEnabled)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    returnToTryIt(preview: false)
    XCTAssertTrue(installed.waitForExistence(timeout: 3))
    XCTAssertEqual(installed.value as? String, before)
    XCTAssertTrue(app.buttons["Email"].isSelected)
    XCTAssertTrue(app.buttons["Installed Keyboard"].isSelected)
    app.buttons["In-App Preview"].tap()
    waitForText(before)
    XCTAssertFalse(app.key("key-q").exists)
    app.textViews["preview-text"].tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3))
    app.navigationBars.buttons["Clear"].tap()
    waitForText("")
    app.typeOnPreview("ok")
    XCTAssertFalse(app.previewText.isEmpty)
  }
}
