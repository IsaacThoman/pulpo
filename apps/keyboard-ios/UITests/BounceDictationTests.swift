import XCTest

/// The real dictation round trip from another app: the keyboard opens Pulpo
/// Keyboard to record, the person returns, and the transcript lands in their app.
/// Needs the stub server, microphone permission, and the keyboard enabled.
@MainActor
final class BounceDictationTests: XCTestCase {
  func testDictationFromSafari() throws {
    guard let url = URL(string: "http://127.0.0.1:8091/api/mobile/config"), (try? Data(contentsOf: url)) != nil else {
      throw XCTSkip("Start scripts/stub_pulpo_server.py first")
    }
    // Sign in once through the app.
    let app = XCUIApplication()
    app.launchArguments = ["-PKResetSettings"]
    app.launchEnvironment["PK_TEST_LOGIN"] = "http://127.0.0.1:8091|tester@example.com|correct horse"
    app.launch()
    sleep(3)
    let signedIn = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Stub Tester' OR value CONTAINS 'Stub Tester'")).firstMatch
    XCTAssertTrue(signedIn.waitForExistence(timeout: 8), "Sign-in failed:\n\(app.debugDescription)")

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
    snapshot("bounce-safari-keyboard")

    safari.key("dictate").tap()
    // The keyboard opens Pulpo Keyboard, which starts recording.
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8), "Pulpo Keyboard didn't open")
    XCTAssertTrue(app.staticTexts["Listening"].waitForExistence(timeout: 6), "Recording didn't start:\n\(app.debugDescription)")
    snapshot("bounce-app-listening")

    // The person goes back to Safari; the keyboard shows the live recording.
    safari.activate()
    let done = safari.key("dictation-done")
    XCTAssertTrue(done.waitForExistence(timeout: 6), "Keyboard isn't showing the recording:\n\(safari.debugDescription)")
    sleep(1)
    snapshot("bounce-keyboard-recording")
    done.tap()

    // Leaving the host loses continuous destination observation. Review the
    // returned field before explicitly inserting the waiting transcript.
    let insert = safari.key("dictation-action")
    XCTAssertTrue(insert.waitForExistence(timeout: 10), "The host round trip should require destination confirmation")
    XCTAssertEqual(insert.label, "Insert Here")
    XCTAssertFalse((destination.value as? String ?? "").contains("Pulpo dictation"), "Insertion must wait for confirmation")
    insert.tap()

    let deadline = Date().addingTimeInterval(10)
    var value = ""
    while Date() < deadline {
      value = destination.value as? String ?? ""
      if value.contains("Pulpo dictation") { break }
      usleep(300_000)
    }
    snapshot("bounce-inserted")
    XCTAssertTrue(value.contains("Hello from Pulpo dictation"), "Got \(value)")
  }
}
