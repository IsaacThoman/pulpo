import XCTest

@MainActor
final class KeyboardLanguageTests: PreviewTypingTestCase {
  private func choose(_ title: String) {
    app.chooseTypingLanguage(title)
  }

  func testSwitchesTypingAndSwipeLanguageFromSettings() throws {
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
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8))
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

  func testTopBarHasNoLanguageControl() {
    XCTAssertFalse(app.key("keyboard-language").exists)
  }

  func testSettingsPickerKeepsLanguageSelection() {
    choose("Español")
    app.typeOnPreview("graciss ")
    waitForText("Gracias ")
    app.navigationBars.buttons.element(boundBy: 0).tap()
    let picker = app.key("typing-language")
    for _ in 0..<12 where !picker.isHittable { app.swipeUp() }
    XCTAssertTrue((picker.label + (picker.value as? String ?? "")).contains("Español"), app.debugDescription)
  }
}
