import XCTest
final class PerformanceUITests: XCTestCase {
  func testLargeHistorySwipe() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
    app.launch()
    XCTAssertTrue(app.buttons["Open chats"].waitForExistence(timeout: 30))
    // Run with EXPO_PUBLIC_PERF_HISTORY_COUNT=5000 when exporting the fixture.
    for _ in 0..<5 {
      let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.04, dy: 0.45))
      let end = app.coordinate(withNormalizedOffset: CGVector(dx: 0.8, dy: 0.45))
      start.press(forDuration: 0.01, thenDragTo: end)
      let row = app.staticTexts["Performance chat 2"].firstMatch
      XCTAssertTrue(row.waitForExistence(timeout: 3))
      row.tap()
      XCTAssertTrue(app.buttons["Open chats"].waitForExistence(timeout: 3))
    }
    app.buttons["Open chats"].tap()
    app.buttons["Search chats"].tap()
    let search = app.textFields.firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 3))
    search.tap(); search.typeText("Performance chat 5000")
    XCTAssertTrue(app.staticTexts["Performance chat 5000"].firstMatch.waitForExistence(timeout: 5))
  }
  func testPreviewAndResume() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
    app.launch()
    let history = app.buttons["Open chats"]
    XCTAssertTrue(history.waitForExistence(timeout: 30))
    history.tap()
    let row = app.staticTexts["Performance chat 2"].firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 10))
    row.press(forDuration: 1.2)
    let pin = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'pin'")).firstMatch
    XCTAssertTrue(pin.waitForExistence(timeout: 10), app.debugDescription)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "native-history-preview"; shot.lifetime = .keepAlways; add(shot)
    app.coordinate(withNormalizedOffset: CGVector(dx: 0.96, dy: 0.9)).tap()
    if row.exists { row.tap() }
    XCTAssertTrue(history.waitForExistence(timeout: 10))
    XCUIDevice.shared.press(.home)
    Thread.sleep(forTimeInterval: 1)
    app.activate()
    let foreground = XCTNSPredicateExpectation(predicate: NSPredicate(format: "state == %d", XCUIApplication.State.runningForeground.rawValue), object: app)
    XCTAssertEqual(XCTWaiter.wait(for: [foreground], timeout: 10), .completed)
    XCTAssertTrue(history.waitForExistence(timeout: 10))
    let resumed = XCTAttachment(screenshot: app.screenshot())
    resumed.name = "foreground-restored"; resumed.lifetime = .keepAlways; add(resumed)
  }
  func testStreamingWhileTyping() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
    app.launch()
    XCTAssertTrue(app.buttons["Open chats"].waitForExistence(timeout: 30))
    app.buttons["Open chats"].tap()
    app.staticTexts["Performance 1000 turns"].firstMatch.tap()
    Thread.sleep(forTimeInterval: 2)
    app.swipeUp(); app.swipeUp()
    let stream = app.descendants(matching: .any).matching(identifier: "Fixture stream").firstMatch
    XCTAssertTrue(stream.waitForExistence(timeout: 10))
    stream.tap()
    let input = app.textViews.firstMatch
    XCTAssertTrue(input.waitForExistence(timeout: 10), app.debugDescription)
    input.tap(); input.typeText("Typing during streaming")
    XCTAssertTrue((input.value as? String)?.contains("Typing during streaming") == true)
    // The reader is scrolled away from the tail. This fixture marker is set only
    // after ProductionBridge projects streamed text, even when its row is virtualized.
    let output = app.staticTexts["Fixture projection streaming"].firstMatch
    XCTAssertTrue(output.waitForExistence(timeout: 10))
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "streaming-while-typing"; shot.lifetime = .keepAlways; add(shot)
  }

  func testRepeatedChatSwitching() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
    app.launch()
    for _ in 0..<2 {
      for number in 2...9 {
        let history = app.buttons["Open chats"]
        XCTAssertTrue(history.waitForExistence(timeout: 15))
        history.tap()
        let row = app.staticTexts["Performance chat \(number)"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        row.tap()
        Thread.sleep(forTimeInterval: 1.2)
      }
    }
    Thread.sleep(forTimeInterval: 3)
    XCTAssertTrue(app.buttons["Open chats"].exists)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "chat-switching-settled"; shot.lifetime = .keepAlways; add(shot)
  }

}
