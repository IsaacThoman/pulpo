import XCTest

/// Compact landscape needs a host that rotates; this app is portrait only, so
/// these run the installed keyboard in Safari's address field.
@MainActor
final class LandscapeKeyboardTests: XCTestCase {
  let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")

  override func setUp() {
    continueAfterFailure = false
  }

  override func tearDown() {
    XCUIDevice.shared.orientation = .portrait
    safari.terminate()
  }

  /// Saves the one-handed choice through the app, as a person would have.
  private func chooseOneHanded(_ mode: String) {
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKResetSettings", "-PKOneHanded", mode]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    app.terminate()
  }

  /// Opens Safari's address field and switches to Pulpo Keyboard.
  private func showKeyboardInSafari() {
    safari.launch()
    XCUIDevice.shared.orientation = .landscapeLeft
    sleep(1)
    let field = safari.textFields.matching(NSPredicate(format: "identifier == 'URL' OR label CONTAINS[c] 'Address' OR label CONTAINS[c] 'Search'")).firstMatch
    if !field.waitForExistence(timeout: 3) {
      let bar = safari.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'TabBarItemTitle' OR identifier == 'URL' OR label CONTAINS[c] 'Address'")).firstMatch
      XCTAssertTrue(bar.waitForExistence(timeout: 5), safari.debugDescription)
      bar.tap()
    } else {
      field.tap()
    }
    for _ in 0..<5 {
      if safari.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = safari.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(safari.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active:\n\(safari.debugDescription)")
  }

  func testLandscapeIgnoresDockingAndFitsEmojiSearch() {
    chooseOneHanded("right")
    showKeyboardInSafari()
    let window = safari.windows.firstMatch.frame
    XCTAssertGreaterThan(window.width, window.height, "Expected landscape")
    let q = safari.key("key-q").frame
    let p = safari.key("key-p").frame
    XCTAssertFalse(safari.key("one-handed-expand").exists, "Landscape stays full width")
    // The system insets landscape keyboards from the screen edges; the keys
    // still span the keyboard's own width.
    let root = safari.key("pulpo-keyboard").frame
    XCTAssertGreaterThan(root.width, 500)
    XCTAssertGreaterThan(p.maxX - q.minX, root.width * 0.95)
    snapshot("landscape-installed-letters")
    // Holding emoji offers no layouts here; it is an ordinary press.
    let emoji = safari.key("key-emoji")
    emoji.press(forDuration: 0.8)
    XCTAssertTrue(safari.key("emoji-panel").waitForExistence(timeout: 4))
    XCTAssertFalse(safari.key("one-handed-expand").exists)
    let open = safari.key("emoji-search-open")
    XCTAssertTrue(open.isHittable)
    snapshot("landscape-installed-panel")
    open.tap()
    let field = safari.key("emoji-search-field")
    XCTAssertTrue(field.waitForExistence(timeout: 2))
    for letter in "smile" { safari.key("key-\(letter)").tap() }
    let result = safari.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'emoji-result-'")).firstMatch
    XCTAssertTrue(result.waitForExistence(timeout: 2))
    let keyboard = safari.key("pulpo-keyboard").frame
    for element in [field, result, safari.key("emoji-search-back"), safari.key("key-letters"), safari.key("key-space"), safari.key("key-delete"), safari.key("key-m")] {
      XCTAssertTrue(element.isHittable, element.debugDescription)
      XCTAssertTrue(keyboard.insetBy(dx: -1, dy: -1).contains(element.frame), "\(element.identifier) leaves the keyboard")
    }
    snapshot("landscape-installed-search")
    safari.key("emoji-search-back").tap()
    XCTAssertTrue(safari.key("emoji-panel").waitForExistence(timeout: 2))
    safari.buttons["emoji-abc"].tap()
    // Back in portrait the saved layout returns.
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(safari.key("one-handed-expand").waitForExistence(timeout: 4), "Portrait docks again")
    snapshot("portrait-installed-redocked")
    safari.key("one-handed-expand").tap()
  }
}
