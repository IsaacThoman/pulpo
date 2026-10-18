import XCTest

/// The companion's typing field must be dismissible without leaving Try It.
@MainActor
final class PreviewDismissalTests: PreviewTypingTestCase {
  func testHideAndRefocusPreviewPreservesTextAndClearBinding() {
    app.typeOnPreview("hi")
    let before = app.previewText
    let hide = app.buttons["hide-keyboard"]
    XCTAssertTrue(hide.waitForExistence(timeout: 3))
    hide.tap()
    XCTAssertTrue(app.key("key-q").waitForNonExistence(timeout: 3))
    XCTAssertEqual(app.previewText, before)
    // An unrelated SwiftUI update must not force the keyboard back up.
    app.navigationBars.buttons["Clear"].tap()
    waitForText("")
    XCTAssertFalse(app.key("key-q").exists)
    app.textViews["preview-text"].tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3))
    app.typeOnPreview("ok")
    XCTAssertFalse(app.previewText.isEmpty)
    app.navigationBars.buttons["Clear"].tap()
    waitForText("")
    snapshot("preview-dismissal-refocused")
  }

  func testInstalledFieldCanHideAndRefocusWithoutLosingText() {
    app.buttons["Installed Keyboard"].tap()
    let field = app.descendants(matching: .any).matching(identifier: "system-text").firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 4))
    // XCTest typing does not depend on remote extension key accessibility.
    field.typeText("sample")
    let before = field.value as? String
    app.buttons["hide-keyboard"].tap()
    let hidden = NSPredicate(format: "enabled == false")
    expectation(for: hidden, evaluatedWith: app.buttons["hide-keyboard"])
    waitForExpectations(timeout: 3)
    XCTAssertEqual(field.value as? String, before)
    field.tap()
    expectation(for: NSPredicate(format: "enabled == true"), evaluatedWith: app.buttons["hide-keyboard"])
    waitForExpectations(timeout: 3)
  }
}
