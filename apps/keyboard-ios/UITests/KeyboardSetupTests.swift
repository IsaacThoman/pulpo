import XCTest

/// Turns Pulpo Keyboard on in Settings, with Full Access, on a fresh simulator.
/// Run once per simulator before the keyboard tests.
@MainActor
final class KeyboardSetupTests: XCTestCase {
  let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")

  override func setUp() {
    continueAfterFailure = false
  }

  /// Taps the row labeled `label`, scrolling the list toward it.
  func tapCell(_ label: String, timeout: TimeInterval = 5) -> Bool {
    let byLabel = NSPredicate(format: "label == %@", label)
    let candidates = [
      settings.cells.matching(byLabel).firstMatch,
      settings.cells[label].firstMatch,
      settings.buttons.matching(byLabel).firstMatch,
      settings.cells.containing(.staticText, identifier: label).firstMatch,
      settings.cells.staticTexts.matching(byLabel).firstMatch,
    ]
    for attempt in 0..<6 {
      for element in candidates where element.waitForExistence(timeout: attempt == 0 ? timeout / Double(candidates.count) : 0.3) {
        if element.isHittable {
          element.tap()
          return true
        }
        // Off screen: scroll toward it.
        if element.frame.minY < settings.frame.midY { settings.swipeDown() } else { settings.swipeUp() }
        if element.isHittable {
          element.tap()
          return true
        }
      }
      if attempt > 0 { settings.swipeUp() }
    }
    return false
  }

  /// Taps a row and waits for a screen with one of `titles`, retrying taps that land mid-animation.
  func open(_ label: String, titles: [String]) -> Bool {
    func arrived() -> Bool { titles.contains { settings.navigationBars[$0].exists } }
    for _ in 0..<3 {
      guard tapCell(label) else { return false }
      if titles.contains(where: { settings.navigationBars[$0].waitForExistence(timeout: 3) }) { return true }
    }
    return arrived()
  }

  func testEnablePulpoKeyboard() throws {
    settings.terminate()
    settings.launch()
    // Start from the root list, with search dismissed.
    let cancelSearch = settings.buttons.matching(NSPredicate(format: "label == 'Cancel'")).firstMatch
    if cancelSearch.waitForExistence(timeout: 2), cancelSearch.isHittable { cancelSearch.tap() }
    for _ in 0..<5 where !settings.navigationBars["Settings"].exists {
      let back = settings.navigationBars.buttons["BackButton"].exists ? settings.navigationBars.buttons["BackButton"] : settings.navigationBars.buttons.element(boundBy: 0)
      guard back.exists else { break }
      back.tap()
    }
    if cancelSearch.exists, cancelSearch.isHittable { cancelSearch.tap() }
    XCTAssertTrue(open("General", titles: ["General"]), "General not found:\n\(settings.debugDescription)")
    // iOS 18 titles the Keyboard page "Keyboards" too, so the list is recognized by its Add row.
    let addRow = settings.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'AddNewKeyboard' OR label BEGINSWITH 'Add New Keyboard'")).firstMatch
    XCTAssertTrue(open("Keyboard", titles: ["Keyboard", "Keyboards"]), "Keyboard not found:\n\(settings.debugDescription)")
    for _ in 0..<3 where !addRow.waitForExistence(timeout: 1) {
      XCTAssertTrue(tapCell("Keyboards"), "Keyboards not found:\n\(settings.debugDescription)")
    }
    if !settings.cells.containing(.staticText, identifier: "Pulpo Keyboard").firstMatch.waitForExistence(timeout: 2)
      && !settings.staticTexts["Pulpo Keyboard"].exists {
      let row = settings.staticTexts["Pulpo Keyboard"]
      for _ in 0..<3 where !row.exists {
        XCTAssertTrue(tapCell("AddNewKeyboard") || tapCell("Add New Keyboard") || tapCell("Add New Keyboard…"), "Add New Keyboard not found:\n\(settings.debugDescription)")
        if row.waitForExistence(timeout: 4) { break }
      }
      XCTAssertTrue(row.waitForExistence(timeout: 4), "Pulpo Keyboard not offered:\n\(settings.debugDescription)")
      row.tap()
    }
    // Open the keyboard's options for Full Access.
    let entry = settings.staticTexts["Pulpo Keyboard"].firstMatch
    XCTAssertTrue(entry.waitForExistence(timeout: 4))
    entry.tap()
    let fullAccess = settings.switches.firstMatch
    XCTAssertTrue(fullAccess.waitForExistence(timeout: 4), "No switches:\n\(settings.debugDescription)")
    for toggle in settings.switches.allElementsBoundByIndex where (toggle.value as? String) == "0" {
      toggle.tap()
      let allow = settings.alerts.buttons["Allow"]
      if allow.waitForExistence(timeout: 3) { allow.tap() }
    }
    XCTAssertTrue(settings.switches.allElementsBoundByIndex.allSatisfy { ($0.value as? String) == "1" }, settings.debugDescription)
    settings.terminate()
  }
}
