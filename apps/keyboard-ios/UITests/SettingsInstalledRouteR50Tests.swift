import XCTest

/// Additional exposed witnesses using the OS-installed extension and real
/// permission switches. Does not manufacture setup state or internal routing.
@MainActor
final class SettingsInstalledRouteR50Tests: XCTestCase {
  var app: XCUIApplication!
  let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
  override func setUp() { continueAfterFailure = false; app = XCUIApplication() }
  func launchGuide(_ extra: [String] = []) {
    app.launchArguments = ["-PKOnboarding"] + extra
    app.launch()
    XCTAssertTrue(step(1).waitForExistence(timeout: 8), "The guide should open on first launch:\n\(app.debugDescription)")
  }

  func step(_ number: Int) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: "setup-step-\(number)").firstMatch
  }

  func status(_ number: Int) -> String { step(number).value as? String ?? "" }

  func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  func openSettingsToKeyboardsRow() -> XCUIElement {
    settings.terminate()
    element("setup-open-settings").tap()
    XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 8))
    let keyboards = settings.staticTexts["Keyboards"].firstMatch
    if keyboards.waitForExistence(timeout: 4) { return keyboards }
    let apps = settings.staticTexts["Apps"].firstMatch
    for _ in 0..<8 where !(apps.exists && apps.isHittable) { settings.swipeUp() }
    XCTAssertTrue(apps.isHittable, settings.debugDescription)
    apps.tap()
    let pulpo = settings.staticTexts["Pulpo Keyboard"].firstMatch
    for _ in 0..<10 where !(pulpo.waitForExistence(timeout: 1) && pulpo.isHittable) { settings.swipeUp() }
    XCTAssertTrue(pulpo.isHittable, "Pulpo Keyboard isn't under Apps:\n\(settings.debugDescription)")
    pulpo.tap()
    XCTAssertTrue(keyboards.waitForExistence(timeout: 5), "No Keyboards row on the app's page:\n\(settings.debugDescription)")
    return keyboards
  }

  func setSwitch(_ label: String, on: Bool) {
    let row = settings.switches.matching(NSPredicate(format: "label == %@", label)).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), "No \(label) switch:\n\(settings.debugDescription)")
    guard (row.value as? String) != (on ? "1" : "0") else { return }
    row.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap()
    let allow = settings.alerts.buttons["Allow"]
    if on, allow.waitForExistence(timeout: 3) { allow.tap() }
    let deadline = Date().addingTimeInterval(4)
    while Date() < deadline, (row.value as? String) != (on ? "1" : "0") { usleep(200_000) }
    XCTAssertEqual(row.value as? String, on ? "1" : "0", settings.debugDescription)
  }

  private func evidence(_ name: String) {
    let image = XCTAttachment(screenshot: app.screenshot()); image.name = name; image.lifetime = .keepAlways; add(image)
    let tree = XCTAttachment(string: app.debugDescription); tree.name = name + "-hierarchy"; tree.lifetime = .keepAlways; add(tree)
  }

  private func installedRoute(fullAccess: Bool) throws {
    launchGuide()
    XCTAssertEqual(status(1), "Done", "Requires the real keyboard enabled by the preceding OS availability probe")
    openSettingsToKeyboardsRow().tap()
    setSwitch("Allow Full Access", on: fullAccess)
    let switches = XCTAttachment(screenshot: settings.screenshot()); switches.name = fullAccess ? "r50-os-full-access-on" : "r50-os-full-access-off"; switches.lifetime = .keepAlways; add(switches)
    app.activate()
    let field = element("setup-try-field")
    for _ in 0..<4 where !field.isHittable || field.frame.maxY > element("setup-open-settings").frame.minY - 8 { app.swipeUp() }
    XCTAssertTrue(field.isHittable); field.tap()
    for _ in 0..<5 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = app.buttons["Next keyboard"].firstMatch
      guard globe.exists else { break }
      globe.tap()
    }
    evidence(fullAccess ? "r50-installed-completed-before-route" : "r50-installed-off-before-route")
    try XCTSkipUnless(app.key("key-q").exists, "Installed Pulpo extension unavailable after actual OS keyboard switching; public OS URL witness is separate")
    let expected = fullAccess ? "Done" : "Off"
    let deadline = Date().addingTimeInterval(6)
    while status(2) != expected, Date() < deadline { usleep(100_000) }
    XCTAssertEqual(status(2), expected)
    XCTAssertEqual(status(3), "Done")
    let original = (1...3).map { status($0) }
    app.buttons["keyboard-language"].tap()
    let request = app.buttons["Keyboard Settings"]
    evidence(fullAccess ? "r50-installed-completed-menu" : "r50-installed-off-menu")
    let menuAvailable = request.waitForExistence(timeout: 3) && request.isHittable
    let binding = XCTAttachment(string: "Full Access: \(expected); setup statuses: \(original); installed Keyboard Settings menu available: \(menuAvailable); route binding: \(menuAvailable ? "actual installed menu tap" : "real public OS URL fallback; installed menu unavailable")")
    binding.name = fullAccess ? "r50-completed-route-binding" : "r50-off-route-binding"; binding.lifetime = .keepAlways; add(binding)
    if menuAvailable { request.tap() }
    else { XCUIDevice.shared.system.open(URL(string: "pulpokeyboard://settings")!) }
    let gone = step(1).waitForNonExistence(timeout: 6)
    evidence(fullAccess ? "r50-installed-completed-after-route" : "r50-installed-off-after-route")
    XCTAssertTrue(gone, "Public settings request left Setup Guide covering settings")
    guard gone else { return }
    let find = app.buttons["find-setting"]; XCTAssertTrue(find.isHittable); find.tap()
    app.buttons["Language"].tap()
    let language = element("typing-language")
    XCTAssertTrue(language.waitForExistence(timeout: 4)); XCTAssertTrue(language.isHittable); language.tap()
    XCTAssertTrue(app.buttons["English + Español"].waitForExistence(timeout: 3)); app.buttons["English + Español"].tap()
    let reopen = element(fullAccess ? "setup-guide" : "continue-setup")
    for _ in 0..<4 where !reopen.isHittable { app.swipeDown() }
    XCTAssertTrue(reopen.isHittable); reopen.tap()
    XCTAssertTrue(step(1).waitForExistence(timeout: 4))
    XCTAssertEqual((1...3).map { status($0) }, original)
    evidence(fullAccess ? "r50-installed-completed-reopened" : "r50-installed-off-reopened")
  }

  func testFullAccessOffGuideSettingsRouteWithAvailablePublicBinding() throws { try installedRoute(fullAccess: false) }
  func testCompletedGuideSettingsRouteWithAvailablePublicBinding() throws { try installedRoute(fullAccess: true) }
}
