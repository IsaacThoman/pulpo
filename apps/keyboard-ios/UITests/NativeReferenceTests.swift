import XCTest

/// Captures the system keyboard for side-by-side comparison. Writes PNGs to
/// $PK_SCREENSHOT_DIR when set.
final class NativeReferenceTests: XCTestCase {
  func save(_ name: String) {
    let shot = XCUIScreen.main.screenshot()
    let attachment = XCTAttachment(screenshot: shot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    if let directory = ProcessInfo.processInfo.environment["PK_SCREENSHOT_DIR"] {
      try? shot.pngRepresentation.write(to: URL(fileURLWithPath: directory).appendingPathComponent("\(name).png"))
    }
  }

  func testCaptureSystemKeyboard() throws {
    let app = XCUIApplication()
    app.launch()
    let field = app.textFields.firstMatch.exists ? app.textFields.firstMatch : app.textViews.firstMatch
    if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
    for _ in 0..<3 where app.buttons["Continue"].waitForExistence(timeout: 2) { app.buttons["Continue"].tap() }
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
    sleep(1)
    save("native-letters")
    for key in ["shift", "Shift"] where app.keyboards.buttons[key].exists { app.keyboards.buttons[key].tap(); break }
    save("native-shift")
    for key in ["more", "numbers", "123"] where app.keyboards.buttons[key].exists { app.keyboards.buttons[key].tap(); break }
    sleep(1)
    save("native-numbers")
    print("KEYS:", app.keyboards.buttons.allElementsBoundByIndex.map { "\($0.identifier)|\($0.label)|\($0.frame)" }.joined(separator: "\n"))
  }
}
