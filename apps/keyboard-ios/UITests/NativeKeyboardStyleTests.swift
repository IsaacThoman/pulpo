import XCTest

/// Same device, app and editor for a visual comparison with Apple's keyboard.
/// Screenshots are review artifacts, rather than pixel-perfect OS assertions.
@MainActor
final class NativeKeyboardStyleTests: XCTestCase {
  override func setUp() { continueAfterFailure = false }

  func testNativeReference() throws { try capture(system: true) }
  func testPulpoAppearanceAndPages() throws { try capture(system: false) }

  private func capture(system: Bool) throws {
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview"] + (system ? ["-PKSystemKeyboard"] : [])
    app.launch()
    let field = app.textViews[system ? "system-text" : "preview-text"]
    XCTAssertTrue(field.waitForExistence(timeout: 15))
    field.tap()
    if system, !app.keys["more"].exists {
      let globe = app.buttons["Next keyboard"].firstMatch
      XCTAssertTrue(globe.waitForExistence(timeout: 5))
      globe.press(forDuration: 1)
      let english = app.cells.matching(NSPredicate(format: "label BEGINSWITH 'English'")).firstMatch
      XCTAssertTrue(english.waitForExistence(timeout: 5))
      english.tap()
      if english.exists { field.tap() }
      let dismissed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: english)
      XCTAssertEqual(XCTWaiter.wait(for: [dismissed], timeout: 4), .completed)
    }
    if system {
      XCTAssertTrue(app.keys["more"].waitForExistence(timeout: 5), "Reference must use Apple's keyboard")
      XCTAssertFalse(app.key("key-q").exists, "Pulpo must not be mislabeled as the native reference")
    }
    let shift = system ? app.buttons["shift"] : app.key("key-shift")
    let q = system ? app.keys["Q"] : app.key("key-q")
    XCTAssertTrue(q.waitForExistence(timeout: 15), app.debugDescription)
    capture(app, name: system ? "native-upper" : "pulpo-upper")
    shift.tap()
    capture(app, name: system ? "native-lower" : "pulpo-lower")
    let page = system ? app.keys["more"] : app.key("key-numbers")
    XCTAssertTrue(page.exists, app.debugDescription)
    page.tap()
    capture(app, name: system ? "native-numbers" : "pulpo-numbers")
    let digit = system ? app.keys["1"] : app.key("key-1")
    digit.tap()
    XCTAssertEqual(field.value as? String, "1")
    let letters = system ? app.keys["more"] : app.key("key-letters")
    letters.tap()
    let a = system ? app.keys["a"] : app.key("key-a")
    a.tap()
    XCTAssertEqual(field.value as? String, "1a")
  }

  private func capture(_ app: XCUIApplication, name: String) {
    let image = XCTAttachment(screenshot: app.screenshot())
    image.name = name
    image.lifetime = .keepAlways
    add(image)
    let elements = app.keys.allElementsBoundByIndex + app.descendants(matching: .any)
      .matching(NSPredicate(format: "identifier BEGINSWITH 'key-' OR identifier == 'pulpo-keyboard'"))
      .allElementsBoundByIndex
    let rows: [[String: Any]] = elements.map {
      ["id": $0.identifier, "label": $0.label, "type": $0.elementType.rawValue,
       "frame": [ $0.frame.minX, $0.frame.minY, $0.frame.width, $0.frame.height ]]
    }
    if let data = try? JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys]) {
      let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
      attachment.name = name + "-frames"
      attachment.lifetime = .keepAlways
      add(attachment)
    }
  }
}
