import XCTest
import UIKit
@testable import KeyboardUI

/// Named extension selection and system-container geometry avoid depending on
/// iOS 27's missing extension-key AX descendants. Menu AX is still required.
@MainActor
final class CompactInstalledInteractionTests: XCTestCase {
  func testInstalledLowerLanguageControlPresentsMenuAndRestoresTyping() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard", "-PKResetLearning", "-PKResetSettings"]
    app.launch()
    let field = app.descendants(matching: .any).matching(identifier: "system-text").firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 8))
    field.tap()
    let globe = app.buttons["Next keyboard"].firstMatch
    XCTAssertTrue(globe.waitForExistence(timeout: 5), "Enable Pulpo and disable hardware keyboard first")
    globe.press(forDuration: 1)
    let named = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "Pulpo Keyboard")).firstMatch
    XCTAssertTrue(named.waitForExistence(timeout: 3))
    named.tap()
    let container = app.descendants(matching: .any).matching(identifier: "inputView").firstMatch
    XCTAssertTrue(container.waitForExistence(timeout: 3))
    let frame = container.frame
    let emptyFieldValue = field.value as? String
    let style = KeyboardStyle.current(dark: false, landscape: frame.width > 500, inset: true)
    func tap(_ point: CGPoint) {
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: point.x, dy: point.y)).tap()
    }
    // Language is immediately before the 46-point microphone and 2-point inset.
    tap(CGPoint(x: frame.maxX - 46 - 2 - 24, y: frame.minY + style.barHeight * 0.94))
    let spanish = app.buttons["Español"].firstMatch
    let menuAccessible = spanish.waitForExistence(timeout: 4)
    snapshot("installed-language-after-lower-tap")
    XCTAssertEqual(field.value as? String, emptyFieldValue, "Language tap typed into the host")
    XCTAssertTrue(menuAccessible, "Installed lower-language tap did not expose its menu; remote menu AX may be unavailable")
    spanish.tap()
    let grid = KeysView(layout: KeyboardLayout.make(page: .letters, traits: InputTraits(), needsGlobe: false, digitHints: false), style: style)
    grid.frame = CGRect(x: 0, y: 0, width: frame.width, height: style.keysHeight)
    grid.layoutIfNeeded()
    let q = try XCTUnwrap(grid.keyViews.first { $0.key.identifier == "key-q" })
    tap(CGPoint(x: frame.minX + q.frame.midX, y: frame.minY + style.barHeight + q.frame.midY))
    let typed = expectation(for: NSPredicate(format: "value == 'Q'"), evaluatedWith: field)
    XCTAssertEqual(XCTWaiter.wait(for: [typed], timeout: 4), .completed)
  }
}
