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

  func testSpanishOpeningPunctuationAlternatesKeepTheNextLetterCapitalized() {
    for language in ["Español", "English + Español"] {
      choose(language)
      for (base, inverted) in [("?", "¿"), ("!", "¡")] {
        clearText()
        app.key("key-numbers").tap()
        let key = app.key("key-\(base)")
        XCTAssertTrue(key.waitForExistence(timeout: 3))
        let start = key.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        // Both two-option strips fit to the right at the preview's full width.
        let alternate = start.withOffset(CGVector(dx: key.frame.width * 1.05, dy: -8))
        start.press(forDuration: 0.8, thenDragTo: alternate)
        waitForText(inverted)
        app.key("key-letters").tap()
        app.typeOnPreview("hola")
        waitForText(inverted + "Hola")
      }
    }
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
    // Returning from Settings restores the draft without forcing the keyboard
    // open. Explicitly focus before checking the keyboard's language label.
    app.textViews["preview-text"].tap()
    let language = app.key("keyboard-language")
    XCTAssertTrue(language.waitForExistence(timeout: 5))
    XCTAssertTrue(language.label.contains("English + Español"))
  }
}
