import XCTest

@MainActor
final class KeyboardLanguageTests: PreviewTypingTestCase {
  private func choose(_ title: String) {
    let language = app.key("keyboard-language")
    XCTAssertTrue(language.waitForExistence(timeout: 3))
    language.tap()
    let choice = app.buttons[title].firstMatch
    XCTAssertTrue(choice.waitForExistence(timeout: 3), app.debugDescription)
    choice.tap()
    XCTAssertTrue(language.label.contains(title))
  }

  func testSwitchesTypingAndSwipeLanguageWithoutLeavingTheKeyboard() throws {
    choose("Español")
    app.typeOnPreview("hols")
    let correction = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Hola")).firstMatch
    XCTAssertTrue(correction.waitForExistence(timeout: 3), app.debugDescription)
    correction.tap()
    waitForText("Hola ")
    try TouchPath.swipe(through: "gracias".map { letter in
      let frame = app.key("key-\(letter)").frame
      return CGPoint(x: frame.midX, y: frame.midY)
    })
    waitForText("Hola gracias")
    snapshot("multilingual-spanish")

    choose("English + Español")
    clearText()
    app.typeOnPreview("hello familia ")
    waitForText("Hello familia ")
    snapshot("multilingual-bilingual")

    choose("English")
    clearText()
    app.typeOnPreview("teh ")
    waitForText("The ")
  }

  func testLanguageChoicePersistsAcrossAppLaunches() {
    choose("Español")
    app.terminate()
    app.launchArguments = ["-PKPreview"]
    app.launch()
    let language = app.key("keyboard-language")
    XCTAssertTrue(language.waitForExistence(timeout: 8))
    XCTAssertTrue(language.label.contains("Español"))
    app.typeOnPreview("graciss ")
    waitForText("Gracias ")
  }

  func testHostSettingsAndKeyboardShareLanguageSelection() {
    choose("Español")
    app.key("keyboard-language").tap()
    app.buttons["Keyboard Settings"].tap()
    XCTAssertTrue(app.navigationBars["Keyboard"].waitForExistence(timeout: 5), app.debugDescription)
    let picker = app.key("typing-language")
    for _ in 0..<5 where !picker.exists || !picker.isHittable { app.swipeUp() }
    XCTAssertTrue(picker.exists, app.debugDescription)
    XCTAssertTrue((picker.label + (picker.value as? String ?? "")).contains("Español"))
    picker.tap()
    app.buttons["English + Español"].firstMatch.tap()
    let preview = app.key("try-it")
    for _ in 0..<5 where !preview.isHittable { app.swipeDown() }
    preview.tap()
    let language = app.key("keyboard-language")
    XCTAssertTrue(language.waitForExistence(timeout: 5))
    XCTAssertTrue(language.label.contains("English + Español"))
  }
}
