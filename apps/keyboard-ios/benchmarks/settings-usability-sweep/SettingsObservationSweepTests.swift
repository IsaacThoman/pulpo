import XCTest

@MainActor
final class SettingsObservationSweepTests: XCTestCase {
  let app = XCUIApplication()

  private func reach(_ identifier: String) -> XCUIElement {
    let target = app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    for _ in 0..<30 {
      if target.exists && target.isHittable && target.frame.minY >= 116 && target.frame.maxY <= 812 { return target }
      if target.exists && (target.frame.minY < 116 || target.frame.maxY > 812) {
        let delta = target.frame.minY < 116 ? min(300, 116 - target.frame.minY + 10) : -min(300, target.frame.maxY - 812 + 10)
        let start = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 394, dy: 450))
        start.press(forDuration: 0.05, thenDragTo: start.withOffset(CGVector(dx: 0, dy: delta)))
      } else { app.swipeUp() }
    }
    return target
  }

  private func record(_ name: String) throws {
    snapshot(name)
    guard FileManager.default.fileExists(atPath: "/tmp/pulpo-settings-usability-sweep") else { return }
    try app.debugDescription.write(toFile: "/tmp/pulpo-settings-usability-sweep/\(name).txt", atomically: true, encoding: .utf8)
    try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/pulpo-settings-usability-sweep/\(name).png"))
  }

  func testObserveActionsAndPersistence() throws {
    continueAfterFailure = false
    app.launchArguments = ["-PKResetSettings"]
    app.launch()
    reach("typing-language").tap()
    try record("language-menu")
    app.buttons["English + Español"].tap()
    XCTAssertTrue(app.buttons["typing-language"].label.contains("English + Español"))
    reach("one-handed-setting").tap()
    try record("one-handed-menu")
    app.buttons["Left"].tap()
    app.terminate()
    app.launchArguments = []
    app.launch()
    XCTAssertTrue(reach("typing-language").label.contains("English + Español"))
    XCTAssertTrue(reach("one-handed-setting").label.contains("Left"))
    reach("clear-learned-words").tap()
    try record("clear-dialog")
    app.otherElements["PopoverDismissRegion"].coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5)).tap()
    XCTAssertFalse(app.sheets["Clear all learned words?"].exists)
    reach("clear-learned-words").tap()
    app.sheets.buttons["Clear Learned Words"].tap()
    XCTAssertTrue(app.alerts["Learned Words Cleared"].waitForExistence(timeout: 3))
    try record("cleared-alert")
    app.alerts.buttons["OK"].tap()
    reach("privacy").tap()
    try record("privacy-details")
  }

  func testObservePublicSettings() throws {
    continueAfterFailure = false
    app.launchArguments = ["-PKResetSettings"]
    app.launch()
    XCTAssertTrue(app.navigationBars["Keyboard"].waitForExistence(timeout: 8))
    for index in 0..<22 {
      let description = app.debugDescription
      try description.write(toFile: "/tmp/pulpo-settings-usability-sweep/observation-\(index).txt", atomically: true, encoding: .utf8)
      try XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: "/tmp/pulpo-settings-usability-sweep/observation-\(index).png"))
      snapshot("settings-observation-\(index)")
      app.swipeUp()
    }
  }
}
