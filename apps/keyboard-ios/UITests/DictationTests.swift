import XCTest

/// Dictation from the keyboard through the app's recorder to a Pulpo server.
/// Needs `scripts/stub_pulpo_server.py` on port 8091 and microphone permission
/// granted to the app (`xcrun simctl privacy <device> grant microphone com.isaacthoman.pulpo.keyboard`).
@MainActor
final class DictationTests: XCTestCase {
  func stubAvailable() -> Bool {
    guard let url = URL(string: "http://127.0.0.1:8091/api/mobile/config"), let data = try? Data(contentsOf: url) else { return false }
    return !data.isEmpty
  }

  func testDictationInsertsTheTranscript() throws {
    try XCTSkipUnless(stubAvailable(), "Start scripts/stub_pulpo_server.py first")
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKResetLearning", "-PKResetSettings"]
    app.launchEnvironment["PK_TEST_LOGIN"] = "http://localhost:8091|tester@example.com|correct horse"
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    sleep(2)
    app.typeOnPreview("so ")
    app.descendants(matching: .any).matching(identifier: "dictate").firstMatch.tap()
    let done = app.descendants(matching: .any).matching(identifier: "dictation-done").firstMatch
    XCTAssertTrue(done.waitForExistence(timeout: 6), "Recording never started:\n\(app.debugDescription)")
    sleep(2)
    snapshot("dictation-recording")
    done.tap()
    let deadline = Date().addingTimeInterval(10)
    while Date() < deadline, !app.previewText.contains("Pulpo dictation") { usleep(200_000) }
    XCTAssertEqual(app.previewText, "So hello from Pulpo dictation.")
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3), "Keyboard should return after dictation")
  }

  func testDictationAsksToSignInFirst() {
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKSignOut"]
    app.launch()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
    app.descendants(matching: .any).matching(identifier: "dictate").firstMatch.tap()
    let title = app.descendants(matching: .any).matching(identifier: "dictation-title").firstMatch
    XCTAssertTrue(title.waitForExistence(timeout: 3))
    XCTAssertEqual(title.label, "Sign in to dictate")
    snapshot("dictation-sign-in")
    app.descendants(matching: .any).matching(identifier: "dictation-cancel").firstMatch.tap()
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3))
  }
}
