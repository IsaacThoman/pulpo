import XCTest

/// Dictation from another app on iOS 26: the keyboard records and uploads by itself,
/// so the person never leaves the app they're typing in. Needs the stub server,
/// microphone permission, and the keyboard enabled with Full Access.
@MainActor
final class InKeyboardDictationTests: XCTestCase {
  func testDictationStaysInSafari() throws {
    guard #available(iOS 26.0, *) else { throw XCTSkip("In-keyboard dictation needs iOS 26") }
    guard let url = URL(string: "http://127.0.0.1:8091/api/mobile/config"), (try? Data(contentsOf: url)) != nil else {
      throw XCTSkip("Start scripts/stub_pulpo_server.py first")
    }
    let app = XCUIApplication()
    app.launchArguments = ["-PKResetSettings"]
    app.launchEnvironment["PK_TEST_LOGIN"] = "http://127.0.0.1:8091|tester@example.com|correct horse"
    app.launch()
    let signedIn = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Stub Tester' OR value CONTAINS 'Stub Tester'")).firstMatch
    XCTAssertTrue(signedIn.waitForExistence(timeout: 8), "Sign-in failed:\n\(app.debugDescription)")
    app.terminate()

    let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    safari.launch()
    safari.open(URL(string: "http://127.0.0.1:8091/stub/dictation")!)
    let destination = safari.textViews["Dictation destination"]
    XCTAssertTrue(destination.waitForExistence(timeout: 8), "The public test field didn't load")
    destination.tap()
    for _ in 0..<4 {
      if safari.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = safari.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(safari.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active in Safari")

    safari.key("dictate").tap()
    let done = safari.key("dictation-done")
    XCTAssertTrue(done.waitForExistence(timeout: 8), "The keyboard didn't start recording:\n\(safari.debugDescription)")
    XCTAssertEqual(safari.state, .runningForeground, "Dictation must not leave Safari")
    XCTAssertNotEqual(app.state, .runningForeground, "Pulpo Keyboard must not open")
    sleep(2)
    snapshot("in-keyboard-recording")
    done.tap()

    // The field was observed the whole time, so the transcript goes straight in.
    let deadline = Date().addingTimeInterval(15)
    var value = ""
    while Date() < deadline {
      value = destination.value as? String ?? ""
      if value.contains("Pulpo dictation") { break }
      usleep(300_000)
    }
    snapshot("in-keyboard-inserted")
    XCTAssertTrue(value.contains("Hello from Pulpo dictation"), "Got \(value):\n\(safari.debugDescription)")
    XCTAssertNotEqual(app.state, .runningForeground, "Pulpo Keyboard must not open")
  }
}
