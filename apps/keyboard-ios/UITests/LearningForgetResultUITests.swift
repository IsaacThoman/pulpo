import Foundation
import XCTest

/// Actual in-app preview AX tree and Remove action under a real owned flock.
@MainActor
final class LearningForgetResultUITests: XCTestCase {
  func testRealPreviewForgetNoticeIsReadableDismissibleAndRetryable() throws {
    continueAfterFailure = true
    struct Config: Decodable { let root: String; let nonce: String }
    struct Ready: Decodable { let nonce: String; let active: Bool; let error: String? }
    let control = URL(fileURLWithPath: "/tmp/pulpo-r33-settings-reset-native-control.json")
    guard FileManager.default.fileExists(atPath: control.path) else {
      throw XCTSkip("Requires an explicitly owned host fault gate")
    }
    let config = try JSONDecoder().decode(Config.self, from: Data(contentsOf: control))
    let root = URL(fileURLWithPath: config.root)
    let app = XCUIApplication()
    func write(_ suffix: String, _ caseKey: Bool = false) throws {
      var value = ["nonce": config.nonce]
      if caseKey { value["caseKey"] = "forget-busy" }
      try JSONSerialization.data(withJSONObject: value).write(to: root.appendingPathComponent("forget-busy." + suffix + ".json"), options: .atomic)
    }
    func wait(_ suffix: String) throws -> Ready {
      let end = Date().addingTimeInterval(15)
      let path = root.appendingPathComponent("forget-busy." + suffix + ".json")
      while Date() < end {
        if let data = try? Data(contentsOf: path), let ready = try? JSONDecoder().decode(Ready.self, from: data) { return ready }
        RunLoop.current.run(until: Date().addingTimeInterval(0.02))
      }
      throw NSError(domain: "R41ForgetFixture", code: 1)
    }
    func require(_ value: Bool, _ message: String) throws {
      if !value { XCTFail(message); throw NSError(domain: "R41ForgetFixture", code: 2) }
    }
    defer { try? write("release"); app.terminate() }
    app.launchArguments = ["-PKPreview", "-PKResetSettings", "-PKResetLearning"]
    app.launch()
    try require(app.key("key-q").waitForExistence(timeout: 8), "Actual preview keyboard unavailable")
    app.typeOnPreview("i want beau")
    let suggestion = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'suggestion-' AND label == %@", "beautiful")).firstMatch
    try require(suggestion.waitForExistence(timeout: 5), "Expected real displayed completion unavailable")
    let draft = app.previewText
    try write("request", true)
    let active = try wait("active")
    try require(active.active && active.nonce == config.nonce && active.error == nil, "Real canonical fault was not armed")
    suggestion.press(forDuration: 0.7)
    let remove = app.buttons["notice-action"]
    try require(remove.waitForExistence(timeout: 3), "Real Remove confirmation unavailable")
    remove.tap()
    let notice = app.staticTexts["Couldn't confirm removal. Try again."]
    try require(notice.waitForExistence(timeout: 4), "Actual controller did not retain failure notice")
    let dismiss = app.buttons["notice-dismiss"]
    XCTAssertEqual(dismiss.label, "Dismiss")
    XCTAssertTrue(dismiss.isHittable)
    XCTAssertTrue(notice.isHittable)
    XCTAssertFalse(remove.exists)
    XCTAssertEqual(app.previewText, draft)
    XCTAssertGreaterThan(notice.frame.width, 0)
    XCTAssertGreaterThan(notice.frame.height, 0)
    XCTAssertLessThanOrEqual(notice.frame.maxX, dismiss.frame.minX)
    snapshot("r41-real-forget-failure")
    try app.debugDescription.write(to: root.appendingPathComponent("forget-busy-ax.txt"), atomically: true, encoding: .utf8)
    try XCUIScreen.main.screenshot().pngRepresentation.write(to: root.appendingPathComponent("forget-busy.png"))
    dismiss.tap()
    XCTAssertFalse(notice.exists)
    XCTAssertTrue(suggestion.exists)
    XCTAssertEqual(app.previewText, draft)
    try write("release")
    let released = try wait("released")
    try require(!released.active && released.nonce == config.nonce && released.error == nil, "Real canonical fault was not released")
    suggestion.press(forDuration: 0.7)
    try require(remove.waitForExistence(timeout: 3), "Explicit retry confirmation unavailable")
    remove.tap()
    XCTAssertFalse(notice.exists)
    XCTAssertFalse(remove.exists)
    XCTAssertFalse(suggestion.exists)
    XCTAssertEqual(app.previewText, draft)
  }
}
