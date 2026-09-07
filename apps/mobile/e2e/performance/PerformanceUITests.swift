import XCTest
final class PerformanceUITests: XCTestCase {
  func testNewChatKeepsComposerFocused() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
    // Isolate each entry point so prior keyboard/draft state cannot mask failure.
    for source in ["drawer", "header", "unsaved"] {
      app.launch()
      XCTAssertTrue(app.buttons["Open chats"].waitForExistence(timeout: 30))
      if source != "unsaved" {
        app.buttons["Open chats"].tap()
        let row = app.staticTexts["Performance chat 2"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let transcript = app.descendants(matching: .any).matching(identifier: "chat-transcript-00000000-0000-4000-8000-000000000101").firstMatch
        XCTAssertTrue(transcript.waitForExistence(timeout: 10))
      }
      if source == "header" {
        app.buttons["New chat"].tap()
      } else {
        app.buttons["Open chats"].tap()
        app.buttons["New Chat"].tap()
      }
      XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
      // Catch a late drawer-completion cleanup dismissing newly acquired focus.
      Thread.sleep(forTimeInterval: 1)
      XCTAssertTrue(app.keyboards.firstMatch.exists)
      let input = app.textViews.firstMatch
      XCTAssertTrue(input.isHittable, app.debugDescription)
      XCTAssertLessThanOrEqual(input.frame.maxY, app.keyboards.firstMatch.frame.minY + 2)
      // Do not tap the composer: typing must use the automatic focus.
      let marker = "Autofocus " + source
      app.typeText(marker)
      XCTAssertTrue((input.value as? String)?.contains(marker) == true)
      XCTAssertTrue(app.keyboards.firstMatch.exists)
      app.terminate()
    }
  }

  func testSelectedChatCover() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
    app.launch()
    // Export with EXPO_PUBLIC_PERF_COLD_CHAT=1: chat 3 has no offline
    // document and its network response takes five seconds.
    XCTAssertTrue(app.buttons["Open chats"].waitForExistence(timeout: 30))
    app.buttons["Open chats"].tap()
    app.staticTexts["Performance chat 2"].firstMatch.tap()
    let previous = app.descendants(matching: .any).matching(identifier: "chat-transcript-00000000-0000-4000-8000-000000000101").firstMatch
    XCTAssertTrue(previous.waitForExistence(timeout: 10))
    app.buttons["Open chats"].tap()
    app.staticTexts["Performance chat 3"].firstMatch.tap()
    let cover = app.descendants(matching: .any).matching(identifier: "chat-opening-00000000-0000-4000-8000-000000000102").firstMatch
    XCTAssertTrue(cover.waitForExistence(timeout: 2))
    let model = app.buttons["Model, Fixture model"]
    let composer = app.textViews.firstMatch
    XCTAssertTrue(model.isHittable)
    XCTAssertTrue(composer.isHittable, app.debugDescription)
    XCTAssertGreaterThan(cover.frame.minY, model.frame.maxY)
    XCTAssertLessThan(cover.frame.maxY, composer.frame.minY)
    XCTAssertFalse(previous.exists)
    XCTAssertFalse(app.descendants(matching: .any).matching(identifier: "Loading conversation").firstMatch.exists)
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.name = "selected-chat-loading-cover"; shot.lifetime = .keepAlways; add(shot)
    let selected = app.descendants(matching: .any).matching(identifier: "chat-transcript-00000000-0000-4000-8000-000000000102").firstMatch
    XCTAssertTrue(selected.waitForExistence(timeout: 10))
    XCTAssertFalse(cover.exists)
    // Reselecting an already measured transcript must not leave a stuck cover.
    app.buttons["Open chats"].tap()
    app.staticTexts["Performance chat 3"].firstMatch.tap()
    XCTAssertTrue(selected.waitForExistence(timeout: 5))
    XCTAssertFalse(cover.exists)
    // Loaded empty chats have no list layout callback. Returning from one
    // must also wait for the next transcript's own measurement.
    app.buttons["Open chats"].tap()
    app.staticTexts["Performance chat 4"].firstMatch.tap()
    let emptyCover = app.descendants(matching: .any).matching(identifier: "chat-opening-00000000-0000-4000-8000-000000000103").firstMatch
    let revealed = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: emptyCover)
    XCTAssertEqual(XCTWaiter.wait(for: [revealed], timeout: 5), .completed)
    XCTAssertFalse(selected.exists)
    app.buttons["Open chats"].tap()
    app.staticTexts["Performance chat 3"].firstMatch.tap()
    XCTAssertTrue(selected.waitForExistence(timeout: 5))
    XCTAssertFalse(cover.exists)
  }
  func testSelectLongAndCachedChats() {
    continueAfterFailure = false
    let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
    app.launch()
    // The second pass reopens resident transcripts. The first uses local disk
    // detail while the fixture deliberately delays network revalidation.
    for _ in 0..<2 {
      for (title, suffix) in [("Performance 1000 turns", "000000000100"), ("Performance chat 2", "000000000101")] {
        let open = app.buttons["Open chats"]
        XCTAssertTrue(open.waitForExistence(timeout: 30))
        open.tap()
        let row = app.staticTexts[title].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let transcript = app.descendants(matching: .any).matching(identifier: "chat-transcript-00000000-0000-4000-8000-\(suffix)").firstMatch
        XCTAssertTrue(transcript.waitForExistence(timeout: 10))
        XCTAssertFalse(app.keyboards.firstMatch.exists)
      }
    }
  }
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
    XCTAssertEqual(search.value as? String, "Performance chat 5000")
    XCTAssertTrue(app.staticTexts["Performance chat 5000"].firstMatch.waitForExistence(timeout: 5), app.debugDescription)
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
