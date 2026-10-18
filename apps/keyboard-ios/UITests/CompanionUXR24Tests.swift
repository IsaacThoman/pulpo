import XCTest
import UIKit

/// R24 development exploration. System content size is set by the UUID-pinned runner.
@MainActor
final class CompanionUXR24Tests: PreviewTypingTestCase {
  private func capture(_ name: String) throws {
    snapshot("r24-\(name)")
    if let directory = ProcessInfo.processInfo.environment["PK_SCREENSHOT_DIR"] {
      try app.debugDescription.write(toFile: directory + "/\(name).txt", atomically: true, encoding: .utf8)
    }
  }

  func testLargestTypeInstalledGuidanceCanBeReadInFull() throws {
    app.buttons["Installed Keyboard"].tap()
    let guidance = app.staticTexts["If another keyboard shows up, touch and hold 🌐 and choose Pulpo Keyboard."]
    XCTAssertTrue(guidance.waitForExistence(timeout: 5))
    // AX includes the complete label even when SwiftUI visually truncates it.
    // Compare the displayed height with the same system footnote's wrapped text.
    let needed = (guidance.label as NSString).boundingRect(
      with: CGSize(width: guidance.frame.width, height: .greatestFiniteMagnitude),
      options: [.usesLineFragmentOrigin, .usesFontLeading],
      attributes: [.font: UIFont.preferredFont(forTextStyle: .footnote)], context: nil).height
    try capture("guidance-measured")
    if let directory = ProcessInfo.processInfo.environment["PK_SCREENSHOT_DIR"] {
      try JSONSerialization.data(withJSONObject: ["displayedHeight": guidance.frame.height, "neededHeight": needed, "width": guidance.frame.width])
        .write(to: URL(fileURLWithPath: directory + "/guidance-measurement.json"))
    }
    XCTAssertGreaterThanOrEqual(guidance.frame.height + 2, needed,
      "Installed-keyboard guidance must show the complete switching instruction; AX label alone hides visual truncation")
    let scroll = app.scrollViews.firstMatch
    XCTAssertTrue(scroll.exists)
    let keyboardTop = app.key("inputView").frame.minY
    XCTAssertGreaterThan(keyboardTop, 300)
    for _ in 0..<2 where guidance.frame.maxY > keyboardTop {
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 394, dy: keyboardTop - 30))
        .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 394, dy: 240)))
    }
    let keyboardAfterScroll = app.key("inputView")
    XCTAssertTrue(keyboardAfterScroll.exists)
    XCTAssertGreaterThan(keyboardAfterScroll.frame.height, 0)
    XCTAssertLessThan(keyboardAfterScroll.frame.minY, app.frame.maxY)
    XCTAssertLessThanOrEqual(guidance.frame.maxY, keyboardAfterScroll.frame.minY + 2)
    try capture("guidance-readable-end")
  }

  func testMultilineEditorAndOuterScrollReturnToTyping() throws {
    app.typeOnPreview("hola\nteam\nhola\nteam\nhola\nteam")
    let draft = app.previewText
    app.textViews["preview-text"].swipeUp()
    app.buttons["Installed Keyboard"].tap()
    let outer = app.scrollViews.firstMatch
    let keyboardTop = app.key("inputView").frame.minY
    app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 394, dy: keyboardTop - 30))
      .press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 394, dy: 240)))
    try capture("multiline-outer-bottom")
    app.buttons["try-it-tips"].tap()
    app.buttons["Done"].tap()
    XCTAssertEqual(app.textViews["system-text"].value as? String, draft)
    app.buttons["hide-keyboard"].tap()
    outer.swipeDown()
    app.buttons["In-App Preview"].tap()
    XCTAssertEqual(app.previewText, draft)
    app.textViews["preview-text"].tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 5))
    app.navigationBars.buttons["Clear"].tap()
    XCTAssertEqual(app.previewText, "")
    XCTAssertFalse(app.navigationBars.buttons["Clear"].isEnabled)
    app.typeOnPreview("ok")
    XCTAssertEqual(app.previewText, "Ok")
    XCTAssertTrue(app.navigationBars.buttons["Clear"].isEnabled)
    try capture("multiline-final-typing")
  }
}
