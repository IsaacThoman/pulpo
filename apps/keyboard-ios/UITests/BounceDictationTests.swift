import XCTest

/// The real dictation round trip from another app: the keyboard opens Pulpo
/// Keyboard to record, it returns to the app, and the transcript lands there.
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
    // The keyboard opens Pulpo Keyboard, which starts recording and then reopens
    // Safari by itself. The keyboard shows the live recording.
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8), "Pulpo Keyboard didn't open")
    XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 8), "Pulpo Keyboard didn't return to Safari:\n\(app.debugDescription)")
    let done = safari.key("dictation-done")
    // Safari comes back with the page's field blurred; focusing it brings the keyboard back.
    if !done.waitForExistence(timeout: 4) { destination.tap() }
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

  /// A native host keeps its field focused, so the keyboard is showing the recording as
  /// soon as Pulpo Keyboard has sent the person back.
  func testDictationReturnsToMessages() throws {
    guard let url = URL(string: "http://127.0.0.1:8091/api/mobile/config"), (try? Data(contentsOf: url)) != nil else {
      throw XCTSkip("Start scripts/stub_pulpo_server.py first")
    }
    let app = XCUIApplication()
    app.launchArguments = ["-PKResetSettings"]
    app.launchEnvironment["PK_TEST_LOGIN"] = "http://127.0.0.1:8091|tester@example.com|correct horse"
    app.launch()
    let signedIn = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'Stub Tester' OR value CONTAINS 'Stub Tester'")).firstMatch
    XCTAssertTrue(signedIn.waitForExistence(timeout: 8), "Sign-in failed:\n\(app.debugDescription)")

    let messages = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
    messages.launch()
    XCTAssertTrue(messages.cells.firstMatch.waitForExistence(timeout: 8), "No conversation to open")
    messages.cells.firstMatch.tap()
    let field = messages.descendants(matching: .any).matching(NSPredicate(format: "(elementType == %d OR elementType == %d) AND isEnabled == true", XCUIElement.ElementType.textView.rawValue, XCUIElement.ElementType.textField.rawValue)).firstMatch
    XCTAssertTrue(field.waitForExistence(timeout: 5), "No message field:\n\(messages.debugDescription)")
    field.tap()
    if messages.key("dictation-cancel").waitForExistence(timeout: 2) { messages.key("dictation-cancel").tap() }
    for _ in 0..<4 {
      if messages.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = messages.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(messages.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active in Messages")

    messages.key("dictate").tap()
    XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8), "Pulpo Keyboard didn't open")
    let done = messages.key("dictation-done")
    XCTAssertTrue(done.waitForExistence(timeout: 8), "Pulpo Keyboard didn't return to Messages:\n\(messages.debugDescription)")
    snapshot("bounce-messages-recording")
    messages.key("dictation-cancel").tap()
  }
}
