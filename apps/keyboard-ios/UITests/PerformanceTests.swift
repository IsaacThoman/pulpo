import XCTest

/// Opt-in workloads for measuring the installed keyboard. They assert nothing
/// about speed: build with `SWIFT_ACTIVE_COMPILATION_CONDITIONS=PK_PERF_LOG` so the
/// extension logs its own main-thread timings and memory (see `PerfLog`), then
/// read them from the simulator log. Run after `KeyboardSetupTests` with
/// `TEST_RUNNER_PK_PERF_UI=1`; `TEST_RUNNER_PK_PERF_WORDS` sets how many words to type
/// and `TEST_RUNNER_PK_PERF_KEEP_LEARNING=1` keeps a seeded personal dictionary.
@MainActor
final class PerformanceTests: XCTestCase {
  var app: XCUIApplication!
  var environment: [String: String] { ProcessInfo.processInfo.environment }

  override func setUpWithError() throws {
    guard environment["PK_PERF_UI"] != nil else { throw XCTSkip("Set TEST_RUNNER_PK_PERF_UI=1 to run keyboard performance workloads") }
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard"] + (environment["PK_PERF_KEEP_LEARNING"] == nil ? ["-PKResetLearning"] : [])
    app.launch()
    let field = app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
    XCTAssertTrue(field.waitForExistence(timeout: 8))
    if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
    for _ in 0..<4 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let globe = app.buttons["Next keyboard"].firstMatch
      if globe.exists { globe.tap() } else { break }
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active:\n\(app.debugDescription)")
  }

  static let words = """
  hey are you still coming to the party tonight i think it starts around eight but we can get there a bit later if you want \
  let me know what you think and i will pick you up on the way also can you bring the speaker from last time mine is broken again \
  i just got out of the meeting and it was so long the new manager wants everyone to send a weekly update by friday afternoon \
  honestly i dont mind but it feels like more work for nothing anyway how was your day did you finish the report for the client \
  we should grab lunch tomorrow if you are free there is a new place near the office that makes really good sandwiches and soup \
  my sister is visiting this weekend so i might be busy on saturday but sunday works for me maybe we can go for a walk in the park \
  the weather is supposed to be nice and sunny i need to buy groceries tonight because the fridge is basically empty right now \
  do you need anything from the store i can get milk and eggs and bread if you want oh and i forgot to tell you my phone fell \
  in the water yesterday and the screen still works but the speaker sounds weird i have to take it in for repair next week \
  thanks for helping me move last month i really appreciate it the new apartment is great and the neighbors are very friendly
  """.split(separator: " ").map(String.init)

  /// Fast typing: one synthesized tap every `interval` seconds, on real key views.
  func testTypingWorkload() throws {
    var centers: [String: CGPoint] = [:]
    for name in "abcdefghijklmnopqrstuvwxyz".map(String.init) + ["space"] {
      let frame = app.key("key-\(name)").frame
      centers[name] = CGPoint(x: frame.midX, y: frame.midY)
    }
    let count = Int(environment["PK_PERF_WORDS"] ?? "") ?? 120
    let interval = Double(environment["PK_PERF_TAP_INTERVAL"] ?? "") ?? 0.09
    var typed = 0
    while typed < count {
      let chunk = (typed..<min(count, typed + 12)).map { Self.words[$0 % Self.words.count] }
      var points: [CGPoint] = []
      for word in chunk {
        points += word.compactMap { centers[String($0)] }
        points.append(centers["space"]!)
      }
      try TouchPath.taps(points, interval: interval)
      typed += chunk.count
    }
    sleep(2)
    // Swipes through letter centers, with recorded-like timing from the synthesizer.
    for word in ["hello", "world", "keyboard", "thanks", "tomorrow", "really", "great", "people", "about", "think"] {
      try TouchPath.swipe(through: word.compactMap { centers[String($0)] }, duration: 0.5)
      usleep(400_000)
    }
    sleep(2)
    XCUIDevice.shared.press(.home)
    sleep(3)
  }

  /// Opens the emoji picker and scrolls through every category.
  func testEmojiWorkload() throws {
    app.key("key-emoji").tap()
    XCTAssertTrue(app.key("emoji-panel").waitForExistence(timeout: 6))
    sleep(1)
    let collection = app.collectionViews.firstMatch
    for _ in 0..<(Int(environment["PK_PERF_EMOJI_SWIPES"] ?? "") ?? 45) { collection.swipeLeft(velocity: .fast) }
    sleep(1)
    app.buttons["emoji-abc"].tap()
    sleep(1)
    XCUIDevice.shared.press(.home)
    sleep(3)
  }

  static let emojiQueries = ["smile", "heart", "cat", "dog", "pizza", "car", "sun", "moon", "star", "fire",
                             "party", "cry", "laugh", "love", "food", "ball", "flag", "tree", "hand", "music"]

  /// Browses every emoji: scrolls the picker to the end and back twice, runs 20
  /// searches typed on the search keys, then returns to the letters. The extension
  /// logs its footprint and peak at each stage (`emojiPanelShown`, `emojiScrollEnd`,
  /// `emojiScrollStart`, `emojiSearchEnded`, `emojiClosedSettled`) and the frame
  /// intervals while the grid scrolls. `TEST_RUNNER_PK_PERF_EMOJI_SWIPES` sets the
  /// fast swipes per direction (45 cover the catalog in the simulator).
  func testEmojiMemoryWorkload() throws {
    app.key("key-emoji").tap()
    let panel = app.key("emoji-panel")
    XCTAssertTrue(panel.waitForExistence(timeout: 6))
    sleep(2)
    let collection = app.collectionViews.firstMatch
    let swipes = Int(environment["PK_PERF_EMOJI_SWIPES"] ?? "") ?? 45
    for sweep in 1...2 {
      for _ in 0..<swipes { collection.swipeLeft(velocity: .fast) }
      sleep(2)
      print("PKPERF-UI sweep \(sweep) reached flags: \(panel.staticTexts["FLAGS"].exists)")
      for _ in 0..<swipes { collection.swipeRight(velocity: .fast) }
      sleep(2)
    }
    app.key("emoji-search-open").tap()
    XCTAssertTrue(app.key("emoji-search-field").waitForExistence(timeout: 3))
    var centers: [String: CGPoint] = [:]
    for name in "abcdefghijklmnopqrstuvwxyz".map(String.init) + ["delete"] {
      let frame = app.key("key-\(name)").frame
      centers[name] = CGPoint(x: frame.midX, y: frame.midY)
    }
    for query in Self.emojiQueries {
      try TouchPath.taps(query.compactMap { centers[String($0)] }, interval: 0.15)
      sleep(1)
      try TouchPath.taps(Array(repeating: centers["delete"]!, count: query.count), interval: 0.15)
      usleep(500_000)
    }
    app.key("emoji-search-back").tap()
    XCTAssertTrue(panel.waitForExistence(timeout: 3))
    sleep(2)
    app.buttons["emoji-abc"].tap()
    sleep(3)
    XCUIDevice.shared.press(.home)
    sleep(3)
  }

  /// Shows the keyboard, then leaves it idle so the cold path can be read from the log.
  func testAppearanceWorkload() throws {
    sleep(2)
    XCUIDevice.shared.press(.home)
    sleep(2)
  }
}

@MainActor
extension TouchPath {
  /// Separate taps at `points`, `interval` seconds apart, in one synthesized record.
  static func taps(_ points: [CGPoint], interval: TimeInterval, hold: TimeInterval = 0.05) throws {
    guard let pathClass = NSClassFromString("XCPointerEventPath") as? NSObject.Type,
          let recordClass = NSClassFromString("XCSynthesizedEventRecord") as? NSObject.Type else { throw XCTSkip("Event synthesis is unavailable") }
    typealias InitPath = @convention(c) (AnyObject, Selector, CGPoint, Double) -> AnyObject
    typealias Lift = @convention(c) (AnyObject, Selector, Double) -> Void
    typealias InitRecord = @convention(c) (AnyObject, Selector, NSString, Int) -> AnyObject
    typealias Add = @convention(c) (AnyObject, Selector, AnyObject) -> Void
    typealias Synthesize = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>?) -> Bool
    let initRecord = NSSelectorFromString("initWithName:interfaceOrientation:")
    let record = recordClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
    let recordObject = unsafeBitCast(record.method(for: initRecord), to: InitRecord.self)(record, initRecord, "taps" as NSString, 1)
    let initPath = NSSelectorFromString("initForTouchAtPoint:offset:")
    let lift = NSSelectorFromString("liftUpAtOffset:")
    let add = NSSelectorFromString("addPointerEventPath:")
    for (index, point) in points.enumerated() {
      let offset = Double(index) * interval
      let path = pathClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue()
      let pathObject = unsafeBitCast(path.method(for: initPath), to: InitPath.self)(path, initPath, point, offset)
      unsafeBitCast(pathObject.method(for: lift), to: Lift.self)(pathObject, lift, offset + hold)
      unsafeBitCast(recordObject.method(for: add), to: Add.self)(recordObject, add, pathObject)
    }
    let synthesize = NSSelectorFromString("synthesizeWithError:")
    var error: NSError?
    let ok = unsafeBitCast(recordObject.method(for: synthesize), to: Synthesize.self)(recordObject, synthesize, &error)
    if !ok { throw error ?? NSError(domain: "TouchPath", code: 2) }
  }
}
