import XCTest

@MainActor
final class LearningClearScopeUITests: XCTestCase {
  func testSharedScopeConfirmationIsReadableAndCanBeCancelled() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["-PKResetSettings"]
    app.launch()
    defer { app.terminate() }
    let find = app.buttons["find-setting"]
    XCTAssertTrue(find.waitForExistence(timeout: 5))
    find.tap()
    app.buttons["Privacy & Learning"].tap()
    app.buttons["clear-learned-words"].tap()
    let sheet = app.sheets.firstMatch
    XCTAssertTrue(sheet.waitForExistence(timeout: 3))
    let copy = "Clears learned words and touch adjustments shared with this app. Learning stored only inside a keyboard without shared access can’t be cleared here. Your language and keyboard settings stay as they are."
    let message = sheet.staticTexts.matching(NSPredicate(format: "label == %@", copy)).firstMatch
    XCTAssertTrue(message.exists)
    XCTAssertTrue(message.isHittable)
    let confirm = sheet.buttons["Clear Learned Words"]
    let cancel = sheet.buttons["Cancel"]
    XCTAssertTrue(confirm.isHittable)
    XCTAssertTrue(cancel.isHittable)
    XCTAssertLessThanOrEqual(message.frame.maxY, confirm.frame.minY)
    XCTAssertGreaterThan(message.frame.width, 0)
    snapshot("r41-shared-clear-confirmation")
    cancel.tap()
    XCTAssertFalse(app.alerts["Learned Words Cleared"].exists)
    XCTAssertFalse(app.alerts["Couldn’t Clear Learned Words"].exists)
  }
}
