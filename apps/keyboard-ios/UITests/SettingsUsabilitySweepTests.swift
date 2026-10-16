import XCTest

/// Native navigation regression checks; large-type measurements use the assigned iPhone 18 Pro.
@MainActor
final class SettingsUsabilitySweepTests: XCTestCase {
  let app = XCUIApplication()

  private func record(_ name: String) throws {
    snapshot(name)
    guard FileManager.default.fileExists(atPath: "/tmp/pulpo-settings-usability-sweep") else { return }
    try app.debugDescription.write(toFile: "/tmp/pulpo-settings-usability-sweep/\(name).txt", atomically: true, encoding: .utf8)
    try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/pulpo-settings-usability-sweep/\(name).png"))
  }

  // Additional exposed regression check, outside the frozen blind score.
  func testLearningOffSurvivesJumpsClearAndRelaunch() {
    continueAfterFailure = false
    app.launchArguments = ["-PKResetSettings"]
    app.launch()
    let find = app.buttons["find-setting"]
    XCTAssertTrue(find.waitForExistence(timeout: 3))
    find.tap()
    app.buttons["Privacy & Learning"].tap()
    let learning = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Learn New Words,")).firstMatch
    XCTAssertEqual(learning.value as? String, "1")
    let actualSwitch = learning.switches.firstMatch
    XCTAssertTrue(actualSwitch.exists && actualSwitch.isHittable)
    actualSwitch.tap()
    XCTAssertEqual(learning.value as? String, "0")
    find.tap()
    app.buttons["Language"].tap()
    app.buttons["typing-language"].tap()
    app.buttons["Español"].tap()
    find.tap()
    app.buttons["One-Handed"].tap()
    app.buttons["one-handed-setting"].tap()
    app.buttons["Left"].tap()
    find.tap()
    app.buttons["Privacy & Learning"].tap()
    XCTAssertEqual(learning.value as? String, "0")
    app.buttons["clear-learned-words"].tap()
    app.sheets.buttons["Clear Learned Words"].tap()
    XCTAssertTrue(app.alerts["Learned Words Cleared"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts["Learn New Words is off, so nothing new will be learned."].exists)
    app.alerts.buttons["OK"].tap()
    XCTAssertEqual(learning.value as? String, "0")
    app.terminate()
    app.launchArguments = []
    app.launch()
    XCTAssertTrue(find.waitForExistence(timeout: 5))
    find.tap()
    app.buttons["Privacy & Learning"].tap()
    XCTAssertEqual(learning.value as? String, "0")
    find.tap()
    app.buttons["Language"].tap()
    XCTAssertEqual(app.buttons["typing-language"].label, "Typing Language, Español")
    find.tap()
    app.buttons["One-Handed"].tap()
    XCTAssertEqual(app.buttons["one-handed-setting"].label, "One-Handed Keyboard, Left")
  }

  func testQuickSettingsReachesExistingControlsWithoutChangingValues() throws {
    continueAfterFailure = false
    app.launchArguments = ["-PKResetSettings"]
    app.launch()
    let find = app.buttons["find-setting"]
    XCTAssertTrue(find.waitForExistence(timeout: 3), "Largest-type settings require 3/11/16 swipes; offer direct navigation to common settings")
    find.tap()
    try record("quick-settings-menu")
    XCTAssertLessThanOrEqual(app.buttons["Privacy & Learning"].frame.maxY, 812)
    app.buttons["Language"].tap()
    let language = app.buttons["typing-language"]
    XCTAssertTrue(language.isHittable)
    XCTAssertGreaterThanOrEqual(language.frame.minY, 116)
    XCTAssertLessThanOrEqual(language.frame.maxY, 812)
    XCTAssertTrue(language.label.contains("English"))
    language.tap()
    app.buttons["English + Español"].tap()
    find.tap()
    app.buttons["One-Handed"].tap()
    let oneHanded = app.buttons["one-handed-setting"]
    XCTAssertTrue(oneHanded.isHittable)
    XCTAssertGreaterThanOrEqual(oneHanded.frame.minY, 116)
    XCTAssertLessThanOrEqual(oneHanded.frame.maxY, 812)
    XCTAssertTrue(oneHanded.label.contains("Off"))
    oneHanded.tap()
    app.buttons["Right"].tap()
    find.tap()
    app.buttons["Privacy & Learning"].tap()
    let learning = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Learn New Words,")).firstMatch
    XCTAssertTrue(learning.isHittable)
    XCTAssertEqual(learning.value as? String, "1")
    let clear = app.buttons["clear-learned-words"]
    XCTAssertTrue(clear.isHittable)
    clear.tap()
    app.otherElements["PopoverDismissRegion"].coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)).tap()
    find.tap()
    app.buttons["Language"].tap()
    XCTAssertTrue(language.label.contains("English + Español"))
    find.tap()
    app.buttons["One-Handed"].tap()
    XCTAssertTrue(oneHanded.label.contains("Right"))
    try record("quick-settings-final")
  }
}
