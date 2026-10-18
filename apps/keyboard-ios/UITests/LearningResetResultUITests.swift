import Foundation
import XCTest
import KeyboardCore

/// Informed production-UI result checks with a real host-held group-store fault.
/// No AppModel hooks, result overrides or persistence implementation substitutes.
@MainActor
final class LearningResetResultUITests: XCTestCase {
  private let app = XCUIApplication()
  private struct Config: Decodable { let root: String; let nonce: String; let groupContainer: String }
  private struct Ready: Decodable {
    let nonce: String
    let caseKey: String
    let active: Bool
    let error: String?
  }
  private let sharedSuccess = "Shared learned words and touch adjustments have been cleared. "
  private let enabledCopy = "Pulpo Keyboard starts learning again as you type."
  private let disabledCopy = "Learn New Words is off, so nothing new will be learned."

  func testRealLockContentionShowsFailureThenRetrySucceedsLearningOn() throws {
    try exercise(caseKey: "busy-on", learning: true)
  }
  func testRealLockContentionShowsFailureThenRetrySucceedsLearningOff() throws {
    try exercise(caseKey: "busy-off", learning: false)
  }
  func testRealStorageOpenFailureShowsFailureThenRetrySucceeds() throws {
    try exercise(caseKey: "io-on", learning: true)
  }

  private func exercise(caseKey: String, learning: Bool) throws {
    continueAfterFailure = true
    let configURL = URL(fileURLWithPath: "/tmp/pulpo-r33-settings-reset-native-control.json")
    guard FileManager.default.fileExists(atPath: configURL.path) else {
      throw XCTSkip("Requires the explicitly owned host fault gate; no storage fault was injected")
    }
    let config = try JSONDecoder().decode(Config.self, from: Data(contentsOf: configURL))
    let directory = URL(fileURLWithPath: config.root, isDirectory: true)
    let expectedCopy = sharedSuccess + (learning ? enabledCopy : disabledCopy)
    defer {
      // The host also restores on its own bounded active timeout/termination.
      try? write(["nonce": config.nonce], to: directory.appendingPathComponent(caseKey + ".release.json"))
      app.terminate()
    }
    app.launchArguments = ["-PKResetSettings"] // Deliberately no -PKResetLearning.
    app.launch()
    try openPrivacy()
    let toggle = app.switches.matching(NSPredicate(format: "label BEGINSWITH %@", "Learn New Words,")).firstMatch
    XCTAssertEqual(toggle.value as? String, "1")
    if !learning {
      let nativeSwitch = toggle.switches.firstMatch
      XCTAssertTrue(nativeSwitch.exists && nativeSwitch.isHittable)
      nativeSwitch.tap()
    }
    XCTAssertEqual(toggle.value as? String, learning ? "1" : "0")

    // Establish public, successful initialization before touching any lock path.
    try confirmClear()
    try expectSuccess() // Common setup for old and result-aware UI; arm the real fault in both.
    app.alerts.buttons["OK"].tap()

    // Seed both real canonical stores through their public native models.
    let group = URL(fileURLWithPath: config.groupContainer, isDirectory: true)
    let dictionaryURL = group.appendingPathComponent("PersonalDictionary.json")
    let touchURL = group.appendingPathComponent("TouchModel.json")
    let personal = PersonalDictionary(url: dictionaryURL)
    let touch = TouchModel(url: touchURL)
    try require(personal.pin("r41Café") && personal.save(), "Native dictionary seed failed")
    let typed = TypedWord(text: "ivy", taps: "ivy".utf8.map { LetterGeometry.qwerty.center($0) })
    try require(touch.learn(typed, intended: "ivy", geometry: .qwerty) && touch.save(), "Native touch seed failed")
    XCTAssertEqual(PersonalDictionary(url: dictionaryURL).count(of: "r41Café"), 1)
    XCTAssertEqual(TouchModel(url: touchURL).weight, 3)

    try write(["nonce": config.nonce, "caseKey": caseKey], to: directory.appendingPathComponent(caseKey + ".request.json"))
    let readyURL = directory.appendingPathComponent(caseKey + ".active.json")
    let ready = try waitFor(Ready.self, at: readyURL, timeout: 15)
    XCTAssertEqual(ready.nonce, config.nonce)
    XCTAssertEqual(ready.caseKey, caseKey)
    XCTAssertNil(ready.error)
    try require(ready.active && ready.nonce == config.nonce && ready.caseKey == caseKey, "Real storage fault was not armed")

    try confirmClear()
    let failure = app.alerts["Couldn’t Clear Learned Words"]
    let failureVisible = failure.waitForExistence(timeout: 5)
    try record(caseKey + "-actual-result", in: directory)
    try require(failureVisible, "Real failure did not show the failure result alert")
    XCTAssertFalse(app.alerts["Learned Words Cleared"].exists)
    XCTAssertTrue(failure.staticTexts["Couldn’t clear learned words. Please try again."].exists)
    XCTAssertTrue(failure.buttons["OK"].isHittable)
    try record(caseKey + "-failure", in: directory)
    // Fresh readers cannot read through this real lock/open fault. Their
    // default empty projection is unavailable, not evidence of data removal.
    let unreadable = PersonalDictionary(url: dictionaryURL)
    let unreadableTouch = TouchModel(url: touchURL)
    let fault: LearningPersistenceResult = caseKey == "io-on" ? .io : .busy
    XCTAssertEqual(unreadable.persistenceResult, fault)
    XCTAssertEqual(unreadableTouch.persistenceResult, fault)
    XCTAssertEqual(personal.count(of: "r41Café"), 1)
    XCTAssertEqual(touch.weight, 3)
    failure.buttons["OK"].tap()
    XCTAssertEqual(toggle.value as? String, learning ? "1" : "0")

    try write(["nonce": config.nonce], to: directory.appendingPathComponent(caseKey + ".release.json"))
    let released = try waitFor(Ready.self, at: directory.appendingPathComponent(caseKey + ".released.json"), timeout: 15)
    try require(!released.active && released.error == nil && released.nonce == config.nonce && released.caseKey == caseKey, "Host failed to restore the real store boundary")

    let retained = PersonalDictionary(url: dictionaryURL)
    let retainedTouch = TouchModel(url: touchURL)
    XCTAssertEqual(retained.persistenceResult, .ok)
    XCTAssertEqual(retainedTouch.persistenceResult, .ok)
    XCTAssertEqual(retained.count(of: "r41Café"), 1, "This precommit fault must retain the durable seed after release")
    XCTAssertEqual(retainedTouch.weight, 3)

    // Retry the same public UI operation; no result/cache/model injection.
    try confirmClear()
    try expectSuccess(expectedCopy)
    XCTAssertFalse(app.alerts["Couldn’t Clear Learned Words"].exists)
    let cleared = try readableModels(dictionaryURL: dictionaryURL, touchURL: touchURL)
    XCTAssertEqual(cleared.personal.count(of: "r41Café"), 0)
    XCTAssertEqual(cleared.touch.weight, 0)
    try record(caseKey + "-success", in: directory)
    app.alerts.buttons["OK"].tap()
    XCTAssertEqual(toggle.value as? String, learning ? "1" : "0")
    app.terminate()
    app.launchArguments = ["-PKSettings"] // Relaunch without resetting settings or learning.
    app.launch()
    try openPrivacy()
    XCTAssertEqual(toggle.value as? String, learning ? "1" : "0")
    let reopened = try readableModels(dictionaryURL: dictionaryURL, touchURL: touchURL)
    XCTAssertEqual(reopened.personal.count(of: "r41Café"), 0)
    XCTAssertEqual(reopened.touch.weight, 0)
  }

  /// A busy fresh reader exposes an empty projection, not confirmed removal.
  /// Only read observations retry; the clear mutation above fires exactly once.
  private func readableModels(dictionaryURL: URL, touchURL: URL) throws -> (personal: PersonalDictionary, touch: TouchModel) {
    let deadline = Date().addingTimeInterval(5)
    repeat {
      let personal = PersonalDictionary(url: dictionaryURL)
      let touch = TouchModel(url: touchURL)
      if personal.persistenceResult == .ok && touch.persistenceResult == .ok {
        return (personal, touch)
      }
      try require([LearningPersistenceResult.ok, .busy].contains(personal.persistenceResult)
        && [LearningPersistenceResult.ok, .busy].contains(touch.persistenceResult),
        "Fresh durable-zero observation failed rather than reporting busy")
      RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    } while Date() < deadline
    throw NSError(domain: "R48NativeFixture", code: 1,
      userInfo: [NSLocalizedDescriptionKey: "Fresh durable-zero observation remained unavailable"])
  }

  private func openPrivacy() throws {
    let find = app.buttons["find-setting"]
    try require(find.waitForExistence(timeout: 5), "Root settings navigation unavailable")
    find.tap()
    app.buttons["Privacy & Learning"].tap()
    try require(app.buttons["clear-learned-words"].isHittable, "Clear control unavailable")
  }
  private func confirmClear() throws {
    app.buttons["clear-learned-words"].tap()
    let confirm = app.sheets.buttons["Clear Learned Words"]
    try require(confirm.waitForExistence(timeout: 3) && confirm.isHittable, "Native confirmation unavailable")
    confirm.tap()
  }
  private func expectSuccess(_ expectedCopy: String? = nil) throws {
    let success = app.alerts["Learned Words Cleared"]
    try require(success.waitForExistence(timeout: 5), "Uncontended clear did not show confirmed success")
    if let expectedCopy {
      let message = success.staticTexts.matching(NSPredicate(format: "label == %@", expectedCopy)).firstMatch
      XCTAssertTrue(message.exists)
      try assertLearningMessageReadable(message, in: success, action: success.buttons["OK"]) { phase in
        snapshot("r41-clear-success-" + phase)
      }
    }
    XCTAssertTrue(success.buttons["OK"].isHittable)
  }
  private func require(_ condition: Bool, _ message: String) throws {
    guard condition else {
      XCTFail(message)
      throw NSError(domain: "R33NativeFixture", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
  }
  private func write(_ value: [String: String], to url: URL) throws {
    try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]).write(to: url, options: .atomic)
  }
  private func waitFor<T: Decodable>(_ type: T.Type, at url: URL, timeout: TimeInterval) throws -> T {
    let end = Date().addingTimeInterval(timeout)
    while Date() < end {
      if let data = try? Data(contentsOf: url), let value = try? JSONDecoder().decode(T.self, from: data) { return value }
      RunLoop.current.run(until: Date().addingTimeInterval(0.02))
    }
    throw NSError(domain: "R33NativeFixture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Fixture barrier unavailable: " + url.lastPathComponent])
  }
  private func record(_ name: String, in directory: URL) throws {
    let screenshot = XCUIScreen.main.screenshot()
    let attachment = XCTAttachment(screenshot: screenshot)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    try screenshot.pngRepresentation.write(to: directory.appendingPathComponent(name + ".png"))
    try app.debugDescription.write(to: directory.appendingPathComponent(name + ".txt"), atomically: true, encoding: .utf8)
  }
}
