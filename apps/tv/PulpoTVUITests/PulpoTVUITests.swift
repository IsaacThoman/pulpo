import XCTest

/// End-to-end flows driven with the Siri Remote against the in-process mock
/// server (`-PulpoMock`), so they need no network and no Pulpo instance.
@MainActor
final class PulpoTVUITests: XCTestCase {
    private var app: XCUIApplication!
    private var remote: XCUIRemote { XCUIRemote.shared }

    override nonisolated func setUp() {
        continueAfterFailure = false
    }

    private func launch(signedIn: Bool, fast: Bool = true, arguments: [String] = []) {
        app = XCUIApplication()
        app.launchArguments = ["-PulpoMock"] + (signedIn ? ["-PulpoSignedIn"] : []) + (fast ? ["-PulpoMockFast"] : []) + arguments
        app.launch()
    }

    private func element(_ identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    /// List rows take focus as cells containing the identified control.
    private func row(_ identifier: String) -> XCUIElement {
        app.cells.containing(NSPredicate(format: "identifier == %@", identifier)).firstMatch
    }

    /// Sidebar tabs take focus as cells containing the tab's label on tvOS
    /// 27, and as buttons on tvOS 26.
    private func sidebarTab(_ title: String) -> XCUIElement {
        let cell = app.cells.containing(NSPredicate(format: "label == %@", title)).firstMatch
        return cell.waitForExistence(timeout: 1) ? cell : app.buttons.matching(NSPredicate(format: "label == %@", title)).firstMatch
    }

    private func button(_ identifier: String, label: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier == %@ AND label == %@", identifier, label)).firstMatch
    }

    private func waitForFocus(on element: XCUIElement, timeout: TimeInterval = 5, file: StaticString = #filePath, line: UInt = #line) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "hasFocus == true"), object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: timeout), .completed, "\(element) never took focus", file: file, line: line)
    }

    private func waitFor(_ element: XCUIElement, toMatch format: String, timeout: TimeInterval = 8, file: StaticString = #filePath, line: UInt = #line) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: format), object: element)
        XCTAssertEqual(XCTWaiter().wait(for: [expectation], timeout: timeout), .completed, "\(element) never matched \(format)", file: file, line: line)
    }

    /// Presses `direction` until `element` has focus.
    private func move(_ direction: XCUIRemote.Button, to element: XCUIElement, limit: Int = 12, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(element.waitForExistence(timeout: 5), "\(element) doesn't exist", file: file, line: line)
        for _ in 0..<limit where !element.hasFocus {
            remote.press(direction)
            Thread.sleep(forTimeInterval: 0.25)
        }
        XCTAssertTrue(element.hasFocus, "Couldn't move focus to \(element)", file: file, line: line)
    }

    /// Types into the field `identifier` and presses the keyboard's
    /// on-screen submit key, as a viewer would. Some steps open their keyboard
    /// on their own; otherwise the field is selected first.
    private func type(_ text: String, into identifier: String, file: StaticString = #filePath, line: UInt = #line) {
        let keyboard = app.keyboards.firstMatch
        // A keyboard handed on from the previous field can take a moment.
        if !keyboard.waitForExistence(timeout: 3) {
            waitForFocus(on: element(identifier), file: file, line: line)
            remote.press(.select)
            // Email fields first offer previously used addresses.
            let enterNew = app.descendants(matching: .any).matching(NSPredicate(format: "label == 'Enter New…'")).firstMatch
            if enterNew.waitForExistence(timeout: 1.5) {
                move(.down, to: app.cells.containing(NSPredicate(format: "label == 'Enter New…'")).firstMatch, file: file, line: line)
                remote.press(.select)
            }
            XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "The keyboard didn't appear", file: file, line: line)
        }
        Thread.sleep(forTimeInterval: 0.5)
        app.typeText(text)
        let submit = app.buttons.matching(NSPredicate(format: "label IN %@", ["send", "go", "next", "done", "continue"])).firstMatch
        move(.down, to: submit, limit: 5, file: file, line: line)
        remote.press(.select)
        _ = keyboard.waitForNonExistence(timeout: 3)
    }

    /// Presses `direction` until `element` exists and has focus; lazy grids
    /// only create cards as they scroll into view.
    private func scroll(_ direction: XCUIRemote.Button, to element: XCUIElement, limit: Int = 12, file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<limit where !(element.exists && element.hasFocus) {
            remote.press(direction)
            Thread.sleep(forTimeInterval: 0.3)
        }
        XCTAssertTrue(element.exists && element.hasFocus, "Couldn't reach \(element)", file: file, line: line)
    }

    // MARK: Signing in

    func testSignInWithTwoFactorCode() {
        launch(signedIn: false)
        type("grace@pulpo.test", into: "email")
        type("pulpo-tv", into: "password")

        type("000000", into: "two-factor-code")
        XCTAssertTrue(element("sign-in-error").waitForExistence(timeout: 5))
        type("123456", into: "two-factor-code")

        waitForFocus(on: element("new-chat"), timeout: 8)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label ENDSWITH ', Ada'")).firstMatch.exists)
    }

    func testWrongPasswordShowsAnError() {
        launch(signedIn: false)
        type("ada@pulpo.test", into: "email")
        type("wrong password", into: "password")
        let error = element("sign-in-error")
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        XCTAssertTrue(error.label.contains("don’t match"))
    }

    // MARK: Chatting

    func testStartsAChatAndStreamsTheReply() {
        launch(signedIn: true)
        waitForFocus(on: element("new-chat"))
        remote.press(.select)

        let composer = element("composer")
        type("Write a haiku about octopuses", into: "composer")
        let reply = app.buttons.matching(identifier: "reply-segment").firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 8))
        waitFor(reply, toMatch: "label CONTAINS 'the reef keeps its secrets'")

        // Focus returns to the field without reopening the keyboard, and the
        // sent text doesn't reappear in it.
        waitForFocus(on: composer)
        XCTAssertFalse(app.keyboards.firstMatch.exists)
        XCTAssertNotEqual(composer.value as? String, "Write a haiku about octopuses")

        // The server names the chat once the first reply completes.
        waitFor(element("conversation-title"), toMatch: "label == 'Write A Haiku About'")
        remote.press(.menu)
        waitForFocus(on: element("new-chat"))
        scroll(.down, to: button("chat-card", label: "Write A Haiku About"))
    }

    func testAFailedFirstMessageExplainsWhyAndKeepsTheText() {
        launch(signedIn: true, arguments: ["-PulpoMockLowBalance"])
        waitForFocus(on: element("new-chat"))
        remote.press(.select)
        type("Write a haiku about octopuses", into: "composer")

        let error = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Your balance is too low'")).firstMatch
        XCTAssertTrue(error.waitForExistence(timeout: 5))
        let composer = element("composer")
        waitFor(composer, toMatch: "value == 'Write a haiku about octopuses'")

        // Sending the kept text again works once the problem is resolved.
        move(.right, to: element("send"))
        remote.press(.select)
        let reply = app.buttons.matching(identifier: "reply-segment").firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 8))
        waitFor(reply, toMatch: "label CONTAINS 'the reef keeps its secrets'")
        XCTAssertFalse(error.exists)
    }

    func testStoppingKeepsThePartialReply() {
        launch(signedIn: true, fast: false)
        waitForFocus(on: element("new-chat"))
        remote.press(.select)
        type("Write a long essay please", into: "composer")

        let stop = element("stop")
        waitForFocus(on: stop, timeout: 6)
        let reply = app.buttons.matching(identifier: "reply-segment").firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 8))
        remote.press(.select)

        waitForFocus(on: element("composer"))
        XCTAssertTrue(app.staticTexts["Stopped"].waitForExistence(timeout: 5))
        XCTAssertTrue(reply.exists, "The partial reply should stay on screen")
        XCTAssertTrue(reply.label.hasPrefix("Paragraph 1."))
    }

    func testRegenerateAddsAVersion() {
        launch(signedIn: true)
        waitForFocus(on: element("new-chat"))
        scroll(.down, to: button("chat-card", label: "Launch Checklist for Pulpo TV"))
        remote.press(.select)

        waitForFocus(on: element("composer"))
        move(.up, to: app.buttons.matching(identifier: "reply-segment").firstMatch)
        remote.press(.select)
        move(.down, to: app.buttons["Regenerate"].firstMatch)
        remote.press(.select)

        XCTAssertTrue(app.staticTexts["Version 2 of 2"].waitForExistence(timeout: 8))
        waitForFocus(on: element("composer"))
    }

    // MARK: Other tabs

    func testSearchFindsAChat() {
        launch(signedIn: true)
        waitForFocus(on: element("new-chat"))
        remote.press(.left)
        move(.down, to: sidebarTab("Search"))
        remote.press(.select)

        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.typeText("ramen")
        XCTAssertTrue(button("chat-card", label: "Weeknight Ramen").waitForExistence(timeout: 5))
        XCTAssertEqual(app.buttons.matching(identifier: "chat-card").count, 1)
    }

    func testSignOutReturnsToSignIn() {
        launch(signedIn: true)
        waitForFocus(on: element("new-chat"))
        remote.press(.left)
        move(.down, to: sidebarTab("Settings"))
        remote.press(.select)

        let defaultModel = row("default-model")
        XCTAssertTrue(defaultModel.waitForExistence(timeout: 5))
        if !defaultModel.hasFocus { remote.press(.right) }
        waitForFocus(on: defaultModel)
        move(.down, to: row("sign-out"))
        remote.press(.select)
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'Sign Out' AND identifier != 'sign-out'")).firstMatch
        move(.right, to: confirm)
        remote.press(.select)

        waitForFocus(on: element("email"), timeout: 6)
    }
}
