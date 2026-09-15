import XCTest

final class PulpoTVUITests: XCTestCase {
    let app = XCUIApplication()
    let remote = XCUIRemote.shared
    override func setUp() {
        continueAfterFailure = false
        let ready = expectation(description: "Reset fixture")
        var request = URLRequest(url: URL(string: "http://127.0.0.1:8371/__control")!)
        request.httpMethod = "POST"; request.httpBody = Data(#"{"reset":true}"#.utf8)
        URLSession.shared.dataTask(with: request) { _, _, _ in ready.fulfill() }.resume()
        wait(for: [ready], timeout: 5)
    }
    func launch(login: Bool = true) {
        app.launchArguments = ["-UITesting", "-TestServer", "http://127.0.0.1:8371"] + (login ? ["-UITestingAutologin"] : [])
        app.launchEnvironment = ["PULPO_TV_TEST_SERVER": "http://127.0.0.1:8371", "PULPO_TV_TEST_EMAIL": "tv@example.test", "PULPO_TV_TEST_PASSWORD": "test-password"]
        app.launch()
        XCTAssertTrue(app.buttons[login ? "new-chat" : "login-submit"].waitForExistence(timeout: 20))
    }
    func focus(_ target: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(target.waitForExistence(timeout: 10), file: file, line: line)
        var visits: [String: Int] = [:]
        for _ in 0..<40 {
            if target.hasFocus { return }
            let focused = app.descendants(matching: .any).matching(NSPredicate(format: "hasFocus == true")).firstMatch
            let f = focused.frame, t = target.frame
            let key = "\(f)"
            let revisited = visits[key, default: 0] > 0
            visits[key, default: 0] += 1
            let dx = t.midX - f.midX, dy = t.midY - f.midY
            let sameColumn = t.minX < f.maxX && t.maxX > f.minX
            // Native tvOS focus scales buttons beyond their layout bounds.
            // Neighbors in the same row can overlap without being in a column.
            let sameRow = abs(dy) < min(f.height, t.height) / 2
            if sameRow { remote.press(dx > 0 ? .right : .left) }
            else if sameColumn || (revisited && abs(dy) > 20) { remote.press(dy > 0 ? .down : .up) }
            else { remote.press(dx > 0 ? .right : .left) }
        }
        XCTFail("Could not focus \(target.identifier).\n\(app.debugDescription)", file: file, line: line)
    }
    func select(_ id: String) { focus(app.buttons[id]); remote.press(.select) }
    func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testRemoteNavigationAndBack() {
        launch(); capture("new-chat")
        select("chat-11111111-1111-4111-8111-111111111111")
        XCTAssertTrue(app.buttons["prompt-33333333-3333-4333-8333-333333333333"].waitForExistence(timeout: 10))
        capture("conversation")
        select("model-picker")
        XCTAssertTrue(app.buttons["model-second-model"].waitForExistence(timeout: 5))
        select("model-second-model")
        XCTAssertTrue(app.buttons["model-picker"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["model-picker"].label.contains("GPT"))
        remote.press(.menu)
        XCTAssertTrue(app.buttons["new-chat"].hasFocus)
        select("search")
        XCTAssertTrue(app.textFields["search-field"].waitForExistence(timeout: 5))
        remote.press(.menu)
        XCTAssertTrue(app.buttons["new-chat"].waitForExistence(timeout: 5))
        select("settings")
        XCTAssertTrue(app.switches["larger-text"].waitForExistence(timeout: 5) || app.buttons["larger-text"].exists)
        capture("settings")
        remote.press(.menu)
        select("folders")
        XCTAssertTrue(app.textFields["folder-name"].waitForExistence(timeout: 5))
        remote.press(.menu)
        select("trash")
        XCTAssertTrue(app.staticTexts["No deleted chats"].waitForExistence(timeout: 5))
        remote.press(.menu)
    }
    func enter(_ id: String, text: String, replacing: Bool = false) {
        let field = app.textFields[id]
        focus(field); remote.press(.select)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        if replacing, let value = field.value as? String {
            app.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count))
        }
        app.typeText(text); remote.press(.menu)
    }
    func testSearchAndFolderCreation() {
        launch()
        select("search"); enter("search-field", text: "coast"); select("search-submit")
        select("search-result-11111111-1111-4111-8111-111111111111")
        XCTAssertTrue(app.buttons["prompt-33333333-3333-4333-8333-333333333333"].waitForExistence(timeout: 10))
        select("folders"); enter("folder-name", text: "Trips"); select("folder-save")
        XCTAssertTrue(app.buttons["Trips"].waitForExistence(timeout: 8))
        capture("folders")
        remote.press(.menu)
    }
    func testMessageActionsAndAttachment() {
        launch(); select("chat-11111111-1111-4111-8111-111111111111")
        focus(app.buttons["Pulpo.png"]); remote.press(.select)
        XCTAssertTrue(app.buttons["panel-done"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.images["attachment-image"].waitForExistence(timeout: 8))
        capture("image-preview"); remote.press(.menu)
        select("message-actions-33333333-3333-4333-8333-333333333333")
        select("regenerate")
        XCTAssertTrue(app.buttons["model-picker"].waitForExistence(timeout: 5))
        let reply = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'reply-' AND label CONTAINS 'Reply to:'")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 10))
        capture("regenerated-reply")
    }
    func testModelOptionsAndSystemAppearance() {
        launch(); select("generation-options")
        focus(app.buttons.matching(NSPredicate(format: "label CONTAINS 'Reasoning'")).firstMatch); remote.press(.select)
        select("choice-high"); XCTAssertTrue(app.buttons["choice-high"].waitForNonExistence(timeout: 5)); remote.press(.menu)
        select("settings")
        XCTAssertTrue(app.buttons["panel-done"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["theme-picker"].exists)
        capture("settings-system")
        remote.press(.menu)
        XCTAssertTrue(app.buttons["panel-done"].waitForNonExistence(timeout: 5))
        select("chat-11111111-1111-4111-8111-111111111111")
        XCTAssertTrue(app.buttons["prompt-33333333-3333-4333-8333-333333333333"].waitForExistence(timeout: 10))
        capture("chat-system")
    }
    func testNativeSignInAndKeyboard() {
        launch(login: false); capture("sign-in")
        select("login-submit")
        XCTAssertTrue(app.buttons["new-chat"].waitForExistence(timeout: 15))
        let field = app.textFields["composer"]
        focus(field); remote.press(.select)
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 8))
        capture("system-keyboard")
        app.typeText("Hello from the remote")
        remote.press(.menu)
        XCTAssertTrue(app.buttons["new-chat"].waitForExistence(timeout: 5))
        XCTAssertEqual(field.value as? String, "Hello from the remote")
        select("send")
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Reply to: Hello from the remote")).firstMatch.waitForExistence(timeout: 10))
        capture("sent-message")
    }
}
