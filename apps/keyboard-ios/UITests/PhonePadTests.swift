import XCTest

/// Phone fields: digits with a +*# page, through the in-app keyboard.
final class PhonePadTests: PreviewTypingTestCase {
  func testPhonePadTypesPlusAndSymbols() {
    app.segmentedControls["field-kind"].buttons["Phone"].tap()
    XCTAssertTrue(app.key("key-phone-symbols").waitForExistence(timeout: 3))
    XCTAssertFalse(app.key("key-q").exists)
    snapshot("phone-digits")
    app.key("key-phone-symbols").tap()
    XCTAssertTrue(app.key("key-+").waitForExistence(timeout: 2))
    snapshot("phone-symbols")
    app.key("key-+").tap()
    // One symbol, then back to the digits.
    XCTAssertTrue(app.key("key-4").waitForExistence(timeout: 2))
    app.key("key-4").tap()
    app.key("key-4").tap()
    waitForText("+44")
    app.key("key-phone-symbols").tap()
    app.key("key-space").tap()
    app.key("key-2").tap()
    app.key("key-0").tap()
    waitForText("+44 20")
    // Holding 0 types "+", as on Gboard.
    clearText()
    app.key("key-0").press(forDuration: 0.8)
    waitForText("+")
  }
}
