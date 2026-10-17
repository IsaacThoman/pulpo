import XCTest

/// The first-launch setup guide: live step status, the Settings deep link, recovery
/// when the person comes back without finishing, and confirming the installed keyboard.
/// Works on a fresh simulator and on one where `KeyboardSetupTests` already ran.
@MainActor
final class SetupGuideTests: XCTestCase {
  var app: XCUIApplication!
  let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")

  override func setUp() {
    continueAfterFailure = false
    app = XCUIApplication()
  }

  /// Starts setup over: guide unseen, keyboard never observed.
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

  func waitFor(_ number: Int, _ expected: String, timeout: TimeInterval = 6) {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline, status(number) != expected { usleep(200_000) }
    XCTAssertEqual(status(number), expected, "Step \(number):\n\(app.debugDescription)")
  }

  /// Focuses the guide's field and cycles keyboards until Pulpo Keyboard is up.
  func switchToPulpoKeyboard() {
    let field = element("setup-try-field")
    // Scroll it clear of the pinned button bar, which XCTest still calls hittable.
    let bar = element("setup-open-settings").exists ? element("setup-open-settings") : element("setup-done")
    for _ in 0..<4 where !field.isHittable || (bar.exists && field.frame.maxY > bar.frame.minY - 8) {
      app.swipeUp()
    }
    XCTAssertTrue(field.isHittable, app.debugDescription)
    field.tap()
    for _ in 0..<5 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = app.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active:\n\(app.debugDescription)")
  }

  func testGuideShowsLiveStepsAndPrivacy() {
    launchGuide()
    snapshot("setup-guide-start")
    XCTAssertEqual(status(3), "To do")
    if status(1) == "To do" {
      XCTAssertEqual(status(2), "To do")
      XCTAssertTrue(element("setup-open-settings").exists)
      XCTAssertFalse(element("setup-try-field").exists, "Nothing to switch to before the keyboard is added")
    } else {
      // Enabled, but this launch forgot every sighting of the keyboard.
      XCTAssertEqual(status(1), "Done")
      XCTAssertEqual(status(2), "Not confirmed yet")
    }

    element("setup-privacy").tap()
    XCTAssertTrue(app.navigationBars["Full Access & Privacy"].waitForExistence(timeout: 3))
    XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS 'never connects to the internet'")).firstMatch.exists)
    snapshot("setup-privacy")
    app.buttons["Done"].firstMatch.tap()

    // Not Now leaves setup on the home screen, and the guide doesn't come back on its own.
    element("setup-not-now").tap()
    XCTAssertTrue(element("continue-setup").waitForExistence(timeout: 3), app.debugDescription)
    app.terminate()
    app.launchArguments = []
    app.launch()
    XCTAssertTrue(element("continue-setup").waitForExistence(timeout: 8))
    XCTAssertFalse(step(1).exists, "The guide only opens by itself once")
    element("continue-setup").tap()
    XCTAssertTrue(step(1).waitForExistence(timeout: 3))
  }

  /// Taps Open Settings and gets to the app's Keyboards row the way the guide describes:
  /// directly when Settings opens on the app's page, else through Apps › Pulpo Keyboard
  /// (the iOS 26.5 simulator opens Settings on its main page).
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

  /// The row's own switch, by tapping the trailing edge of the row-wide element.
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

  /// From a removed keyboard: Open Settings leads to the app's page, whose Keyboards
  /// row holds both switches. Coming back without them shows what's missing; turning
  /// them on and switching to the keyboard completes every step without relaunching.
  /// Ends with the keyboard on and Full Access allowed, like `KeyboardSetupTests`.
  func testOpenSettingsDeepLinkRecoveryAndConfirmation() {
    launchGuide()
    if status(1) == "Done" {
      // Start from the inverse state: the keyboard removed.
      openSettingsToKeyboardsRow().tap()
      setSwitch("Pulpo Keyboard", on: false)
      app.activate()
      waitFor(1, "To do")
    } else {
      _ = openSettingsToKeyboardsRow()
      snapshot("setup-settings-app-page")
      // Back without turning anything on.
      app.activate()
    }
    let notice = element("setup-notice")
    XCTAssertTrue(notice.waitForExistence(timeout: 5), app.debugDescription)
    XCTAssertTrue(notice.label.contains("isn't on yet"), notice.label)
    XCTAssertFalse(element("setup-try-field").exists)
    snapshot("setup-guide-recovery")

    openSettingsToKeyboardsRow().tap()
    setSwitch("Pulpo Keyboard", on: true)
    setSwitch("Allow Full Access", on: true)
    snapshot("setup-settings-switches")

    app.activate()
    waitFor(1, "Done")
    snapshot("setup-guide-returned")
    // Full Access can't be read from the app; switching to the keyboard confirms it.
    XCTAssertEqual(status(2), "Not confirmed yet")
    XCTAssertTrue(notice.waitForExistence(timeout: 3) && notice.label.contains("is added"), "\(notice.exists ? notice.label : "no notice")\n\(app.debugDescription)")
    switchToPulpoKeyboard()
    waitFor(2, "Done")
    waitFor(3, "Done")
    XCTAssertFalse(notice.exists, "The notice clears once setup is confirmed")
    XCTAssertTrue(element("setup-ready").waitForExistence(timeout: 3))
    snapshot("setup-guide-complete")
    app.key("key-h").tap()
    app.key("key-i").tap()
    let done = element("setup-done")
    for _ in 0..<4 where !done.isHittable { app.swipeUp() }
    done.tap()
    XCTAssertTrue(element("setup-ready-row").waitForExistence(timeout: 4), app.debugDescription)
  }

  /// With Full Access turned off, the keyboard still announces itself, so the guide
  /// says Full Access is off instead of trusting an older heartbeat.
  func testKeyboardWithoutFullAccessIsReported() throws {
    launchGuide()
    try XCTSkipIf(status(1) != "Done", "Needs the keyboard added (run KeyboardSetupTests first)")
    openSettingsToKeyboardsRow().tap()
    setSwitch("Allow Full Access", on: false)
    app.activate()
    switchToPulpoKeyboard()
    waitFor(2, "Off")
    let notice = element("setup-notice")
    XCTAssertTrue(notice.waitForExistence(timeout: 3) && notice.label.contains("Full Access is off"), app.debugDescription)
    snapshot("setup-guide-full-access-off")

    // Turn it back on; the next appearance confirms it.
    openSettingsToKeyboardsRow().tap()
    setSwitch("Allow Full Access", on: true)
    app.activate()
    switchToPulpoKeyboard()
    waitFor(2, "Done")
    XCTAssertTrue(element("setup-ready").waitForExistence(timeout: 3))
  }

  /// The in-app preview always has "Full Access"; it must not mark setup done.
  func testInAppPreviewDoesNotConfirmFullAccess() throws {
    launchGuide()
    try XCTSkipIf(status(1) != "Done", "Needs the keyboard added (run KeyboardSetupTests first)")
    XCTAssertEqual(status(2), "Not confirmed yet")
    element("setup-not-now").tap()
    let tryIt = element("try-it")
    XCTAssertTrue(tryIt.waitForExistence(timeout: 4))
    tryIt.tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    app.typeOnPreview("ok")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    // Background and return, which re-reads setup state.
    XCUIDevice.shared.press(.home)
    app.activate()
    let row = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Allow Full Access'")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5), app.debugDescription)
    XCTAssertEqual(row.value as? String, "Not confirmed yet")
  }

  func testTipsAreReachableFromTryIt() {
    app.launchArguments = ["-PKPreview"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    element("try-it-tips").tap()
    for id in ["swipe", "cursor", "delete-swipe", "accents", "emoji-search", "one-handed"] {
      let tip = element("tip-\(id)")
      for _ in 0..<3 where !tip.exists { app.swipeUp() }
      XCTAssertTrue(tip.exists, "Missing tip \(id):\n\(app.debugDescription)")
    }
    snapshot("try-it-tips")
  }
}
