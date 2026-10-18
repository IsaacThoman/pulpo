import XCTest

/// Public OS URL route on the real app; no manufactured internal route dispatch.
@MainActor
final class SettingsRouteR50Tests: XCTestCase {
  func testPublicSettingsURLDismissesDisplayedGuideAndAllowsReopen() throws {
    let app = XCUIApplication()
    app.launchArguments = ["-PKOnboarding"]
    app.launch()
    let step = app.descendants(matching: .any).matching(identifier: "setup-step-1").firstMatch
    XCTAssertTrue(step.waitForExistence(timeout: 8))
    let original = (1...3).map { app.descendants(matching: .any).matching(identifier: "setup-step-\($0)").firstMatch.value as? String ?? "" }
    let before = XCTAttachment(screenshot: app.screenshot()); before.name = "r50-guide-before-public-url"; before.lifetime = .keepAlways; add(before)
    XCUIDevice.shared.system.open(URL(string: "pulpokeyboard://settings")!)
    XCTAssertTrue(step.waitForNonExistence(timeout: 6), "Setup Guide still covers the requested settings")
    let after = XCTAttachment(screenshot: app.screenshot()); after.name = "r50-after-public-settings-url"; after.lifetime = .keepAlways; add(after)
    guard !step.exists else { return }
    let find = app.buttons["find-setting"]
    XCTAssertTrue(find.isHittable); find.tap()
    app.buttons["Language"].tap()
    let language = app.descendants(matching: .any).matching(identifier: "typing-language").firstMatch
    XCTAssertTrue(language.waitForExistence(timeout: 4)); XCTAssertTrue(language.isHittable)
    language.tap()
    XCTAssertTrue(app.buttons["English + Español"].waitForExistence(timeout: 3), app.debugDescription)
    app.buttons["English + Español"].tap()
    let reopen = app.buttons["continue-setup"]
    for _ in 0..<4 where !reopen.isHittable { app.swipeDown() }
    XCTAssertTrue(reopen.waitForExistence(timeout: 3)); reopen.tap()
    XCTAssertTrue(step.waitForExistence(timeout: 4))
    XCTAssertEqual((1...3).map { app.descendants(matching: .any).matching(identifier: "setup-step-\($0)").firstMatch.value as? String ?? "" }, original)
    let a = XCTAttachment(screenshot: app.screenshot()); a.name = "r50-guide-reopened-status-preserved"; a.lifetime = .keepAlways; add(a)
  }
}
