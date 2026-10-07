import XCTest

/// Drives the installed Pulpo TV app with the Siri Remote against a live server.
/// Run through `apps/tv/scripts/e2e.sh`, which passes the account below.
@MainActor
final class RemoteTests: XCTestCase {
  let app = XCUIApplication(bundleIdentifier: "com.isaacthoman.pulpo")
  let remote = XCUIRemote.shared
  var email: String { ProcessInfo.processInfo.environment["PULPO_EMAIL"] ?? "" }
  var password: String { ProcessInfo.processInfo.environment["PULPO_PASSWORD"] ?? "" }

  override func setUp() async throws {
    continueAfterFailure = false
    XCTAssertFalse(email.isEmpty, "Set PULPO_EMAIL and PULPO_PASSWORD")
    app.launch()
    XCTAssertTrue(element("email").waitForExistence(timeout: 90) || element("ask").exists, "The app did not start")
  }

  override func tearDown() async throws {
    let shot = XCTAttachment(screenshot: app.screenshot())
    shot.lifetime = .keepAlways
    add(shot)
  }

  // MARK: Helpers

  func element(_ identifier: String) -> XCUIElement {
    app.descendants(matching: .any).matching(identifier: identifier).firstMatch
  }

  var focused: XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
  }

  /// Move focus with the remote until `target` has it.
  func moveFocus(to target: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
    XCTAssertTrue(target.waitForExistence(timeout: 20), "Missing \(target)", file: file, line: line)
    for _ in 0..<24 {
      if target.hasFocus { return }
      let from = focused.frame
      let to = target.frame
      // Change rows first, then move along the row.
      let sameRow = from.minY < to.maxY && to.minY < from.maxY
      if !sameRow {
        remote.press(to.midY > from.midY ? .down : .up)
      } else {
        remote.press(to.midX > from.midX ? .right : .left)
      }
    }
    XCTAssertTrue(target.hasFocus, "Could not focus \(target)", file: file, line: line)
  }

  func select(_ identifier: String, file: StaticString = #filePath, line: UInt = #line) {
    moveFocus(to: element(identifier), file: file, line: line)
    remote.press(.select)
  }

  /// Open a field's keyboard, type, and submit.
  func enter(_ text: String, into identifier: String, file: StaticString = #filePath, line: UInt = #line) {
    select(identifier, file: file, line: line)
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "Keyboard did not open", file: file, line: line)
    submit(text, file: file, line: line)
  }

  /// Type into the open keyboard and press Done.
  func submit(_ text: String, file: StaticString = #filePath, line: UInt = #line) {
    app.typeText(text)
    let typed = app.keyboards.firstMatch
    _ = typed.waitForExistence(timeout: 1)
    app.typeText("\n")
    // Secure keyboards ignore a typed return; select Done like a viewer would.
    if !app.keyboards.firstMatch.waitForNonExistence(timeout: 2) {
      let done = app.buttons.matching(NSPredicate(format: "label ==[c] 'done'")).firstMatch
      moveFocus(to: done, file: file, line: line)
      remote.press(.select)
    }
    XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 10), file: file, line: line)
  }

  func wait(_ predicate: String, _ object: Any, timeout: TimeInterval = 60, file: StaticString = #filePath, line: UInt = #line) {
    let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: predicate), object: object)
    XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: timeout), .completed, "Timed out: \(predicate)", file: file, line: line)
  }

  func signInIfNeeded() {
    if element("ask").waitForExistence(timeout: 5) { return }
    enter(email, into: "email")
    // Done on the password keyboard signs in.
    enter(password, into: "password")
    XCTAssertTrue(element("ask").waitForExistence(timeout: 30), "Home did not open after signing in")
  }

  func signOut() {
    select("settings")
    select("sign-out")
    XCTAssertTrue(element("email").waitForExistence(timeout: 30))
  }

  /// Start a chat from Home and wait for the whole reply.
  func ask(_ prompt: String) {
    enter(prompt, into: "ask")
    XCTAssertTrue(element("reply").waitForExistence(timeout: 10), "The chat did not open")
    XCTAssertTrue(element("assistant-page").waitForExistence(timeout: 90), "No reply streamed")
    wait("exists == false", element("stop"), timeout: 120)
  }

  // MARK: Tests

  func testSignInRejectsWrongPasswordThenSucceeds() {
    if element("ask").waitForExistence(timeout: 5) { signOut() }
    enter(email, into: "email")
    // Submitting the email moves focus on to the password.
    wait("hasFocus == true", element("password"), timeout: 5)
    remote.press(.select)
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10))
    submit("not-the-password")
    wait("label != ''", element("sign-in-error"), timeout: 20)
    XCTAssertTrue(element("email").exists)
    enter(password, into: "password")
    XCTAssertTrue(element("ask").waitForExistence(timeout: 30))
    wait("hasFocus == true", element("ask"), timeout: 5)
  }

  func testConversationStreamsAndContinues() {
    signInIfNeeded()
    ask("Reply with exactly the word banana.")
    let page = element("assistant-page")
    wait("label CONTAINS[c] 'banana'", page, timeout: 30)
    XCTAssertTrue(element("reply").hasFocus, "The reply field should keep focus")

    enter("Now reply with exactly the word cherry.", into: "reply")
    let pages = app.descendants(matching: .any).matching(identifier: "assistant-page")
    wait("count >= 2", pages, timeout: 90)
    wait("label CONTAINS[c] 'cherry'", pages.element(boundBy: pages.count - 1), timeout: 90)
    XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "user-message").count, 2)

    // Up moves into the transcript; Menu returns to Home with the chat listed first.
    remote.press(.up)
    XCTAssertFalse(element("reply").hasFocus)
    remote.press(.menu)
    XCTAssertTrue(element("ask").waitForExistence(timeout: 10))
    wait("label CONTAINS[c] 'banana' OR label CONTAINS[c] 'cherry' OR label CONTAINS[c] 'word'", element("chat-card"), timeout: 60)
  }

  func testRegenerateAddsAVersion() {
    signInIfNeeded()
    ask("Say a random fruit, one word.")
    select("assistant-page")
    select("action-regenerate")
    wait("exists == true", app.staticTexts["2/2"], timeout: 30)
    wait("exists == false", element("stop"), timeout: 120)
    select("assistant-page")
    select("action-previous")
    wait("exists == true", app.staticTexts["1/2"], timeout: 30)
  }

  func testStopEndsAReply() {
    signInIfNeeded()
    enter("Count slowly from 1 to 400, one number per line.", into: "ask")
    XCTAssertTrue(element("stop").waitForExistence(timeout: 60), "Stop did not appear while streaming")
    select("stop")
    wait("exists == false", element("stop"), timeout: 30)
    XCTAssertTrue(element("reply").exists)
  }

  func testReplyWhileStreamingWaitsForTheAnswer() {
    signInIfNeeded()
    enter("Count from 1 to 80, one number per line.", into: "ask")
    XCTAssertTrue(element("stop").waitForExistence(timeout: 60))
    enter("Now reply with exactly the word kiwi.", into: "reply")
    let pages = app.descendants(matching: .any).matching(identifier: "assistant-page")
    wait("count >= 2", pages, timeout: 180)
    wait("exists == false", element("stop"), timeout: 120)
    XCTAssertEqual(app.descendants(matching: .any).matching(identifier: "user-message").count, 2)
    XCTAssertTrue(pages.element(boundBy: pages.count - 1).label.localizedCaseInsensitiveContains("kiwi"))
  }

  func testModelPickerOpensAndCloses() {
    signInIfNeeded()
    select("model")
    let option = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'model-'")).firstMatch
    XCTAssertTrue(option.waitForExistence(timeout: 10))
    wait("hasFocus == true", option, timeout: 5)
    remote.press(.menu)
    wait("exists == false", option, timeout: 5)
    XCTAssertTrue(element("ask").exists, "Menu should close the picker, not leave Home")
    select("model")
    XCTAssertTrue(option.waitForExistence(timeout: 10))
    remote.press(.select)
    wait("exists == false", option, timeout: 5)
  }

  func card(titled title: String) -> XCUIElement {
    app.descendants(matching: .any).matching(NSPredicate(format: "identifier == 'chat-card' AND label == %@", title)).firstMatch
  }

  func longPress(_ target: XCUIElement) {
    moveFocus(to: target)
    remote.press(.select, forDuration: 1.2)
  }

  func testSearchFindsChats() {
    signInIfNeeded()
    ask("Name one planet, one word.")
    remote.press(.menu)
    let first = element("chat-card")
    XCTAssertTrue(first.waitForExistence(timeout: 30))
    let word = first.label.split(separator: " ").first { $0.allSatisfy(\.isLetter) }.map(String.init) ?? ""
    XCTAssertFalse(word.isEmpty, "Card has no title: \(first.label)")

    select("search")
    enter(word, into: "search-field")
    let cards = app.descendants(matching: .any).matching(identifier: "chat-card")
    wait("count > 0", cards, timeout: 10)
    for index in 0..<cards.count {
      XCTAssertTrue(cards.element(boundBy: index).label.localizedCaseInsensitiveContains(word))
    }
    moveFocus(to: cards.firstMatch)
    remote.press(.select)
    XCTAssertTrue(element("reply").waitForExistence(timeout: 10), "A search result should open its chat")
  }

  func testPinThenDeleteFromHome() {
    signInIfNeeded()
    ask("Name one color, one word.")
    // Wait for the generated title, then find this chat's card by it.
    let header = element("chat-title")
    wait("label != 'Name one color, one word.' AND label != ''", header, timeout: 60)
    let title = header.label
    remote.press(.menu)
    XCTAssertTrue(card(titled: title).waitForExistence(timeout: 30))

    longPress(card(titled: title))
    let pin = element("action-pin")
    XCTAssertTrue(pin.waitForExistence(timeout: 5))
    let wasPinned = pin.label.contains("Unpin")
    remote.press(.select)
    wait("exists == false", pin, timeout: 5)

    longPress(card(titled: title))
    XCTAssertTrue(pin.waitForExistence(timeout: 5))
    XCTAssertEqual(pin.label.contains("Unpin"), !wasPinned, "Pin should toggle")
    select("action-delete")
    wait("exists == false", card(titled: title), timeout: 15)
  }

  func testSignOutReturnsToSignIn() {
    signInIfNeeded()
    signOut()
    XCTAssertTrue(element("email").hasFocus)
  }
}
