import XCTest
import UIKit
@testable import KeyboardUI

/// Exercises real extension touches even when a simulator's remote AX bridge
/// omits the extension's descendants. This does not verify VoiceOver exposure.
@MainActor
final class InstalledKeyboardGeometryTests: XCTestCase {
  func testInstalledExtensionAcceptsTapsAndAMultiPointSwipe() throws {
    continueAfterFailure = false
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard", "-PKResetLearning", "-PKResetSettings"]
    app.launch()
    let field = app.descendants(matching: .any).matching(identifier: "system-text").firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 8))
    field.tap()

    // Select the named installed keyboard explicitly: a native keyboard could
    // also type and swipe successfully, which would give this test a false pass.
    let globe = app.buttons["Next keyboard"].firstMatch
    XCTAssertTrue(globe.waitForExistence(timeout: 5), "Enable Pulpo Keyboard and disable the simulator hardware keyboard first")
    globe.press(forDuration: 1)
    let pulpo = app.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "Pulpo Keyboard")).firstMatch
    XCTAssertTrue(pulpo.waitForExistence(timeout: 3))
    pulpo.tap()
    // iOS 27 can leave the mode menu over the newly selected extension. A
    // coordinate aimed at Q would then hit the menu rather than the grid.
    if pulpo.exists { field.tap() }
    let menuDismissed = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: pulpo)
    XCTAssertEqual(XCTWaiter.wait(for: [menuDismissed], timeout: 4), .completed)

    // The system owns the input container and its dock. Anchor to its actual
    // frame, then use Pulpo's production grid geometry for the content above it.
    let container = app.descendants(matching: .any).matching(identifier: "inputView").firstMatch
    XCTAssertTrue(container.waitForExistence(timeout: 3))
    let frame = container.frame
    XCTAssertGreaterThan(frame.width, 0)
    let style = KeyboardStyle.current(dark: false, landscape: frame.width > 500, inset: true)
    XCTAssertGreaterThanOrEqual(frame.height, style.totalHeight)
    let grid = KeysView(
      layout: KeyboardLayout.make(page: .letters, traits: InputTraits(), needsGlobe: false, digitHints: false),
      style: style
    )
    grid.frame = CGRect(x: 0, y: 0, width: frame.width, height: style.keysHeight)
    grid.layoutIfNeeded()
    func point(_ identifier: String) throws -> CGPoint {
      let key = try XCTUnwrap(grid.keyViews.first { $0.key.identifier == identifier })
      return CGPoint(x: frame.minX + key.frame.midX, y: frame.minY + style.barHeight + key.frame.midY)
    }
    func tap(_ identifier: String) throws {
      let target = try point(identifier)
      app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: target.x, dy: target.y)).tap()
    }
    func waitForText(_ text: String) {
      let predicate = text.isEmpty
        ? NSPredicate(format: "value == '' OR value == 'Type here'")
        : NSPredicate(format: "value == %@", text)
      XCTAssertTrue(XCTWaiter.wait(for: [expectation(for: predicate, evaluatedWith: field)], timeout: 4) == .completed,
                    "Expected \(text.debugDescription), got \(String(describing: field.value))")
    }

    snapshot("installed-geometry-before")
    try tap("key-q")
    waitForText("Q")
    app.navigationBars.buttons["Clear"].tap()
    waitForText("")
    for key in ["key-t", "key-e", "key-h", "key-space"] { try tap(key) }
    waitForText("The ")
    if ProcessInfo.processInfo.operatingSystemVersion.majorVersion < 26 {
      throw XCTSkip("Multi-point touch synthesis doesn't reach keyboard extensions before iOS 26")
    }
    try TouchPath.swipe(through: "keyboard".map { try point("key-\($0)") })
    waitForText("The keyboard")
    snapshot("installed-geometry-after-swipe")
  }
}
