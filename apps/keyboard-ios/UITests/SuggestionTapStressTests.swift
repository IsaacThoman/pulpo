import XCTest

/// Repeats suggestion taps in the installed extension, where host callbacks,
/// proxy updates and bar refreshes interleave with touches. A tap on a choice
/// the person can see must apply; under load an occasional tap was ignored.
/// `PK_STRESS_ITERATIONS` sets the repetitions (default 30).
@MainActor
final class SuggestionTapStressTests: XCTestCase {
  var app: XCUIApplication!
  let iterations = Int(ProcessInfo.processInfo.environment["PK_STRESS_ITERATIONS"] ?? "") ?? 30

  /// Opens the Try It field with the installed keyboard.
  func launchInstalledKeyboard() {
    continueAfterFailure = true
    app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKSystemKeyboard", "-PKResetLearning", "-PKResetSettings"]
    app.launch()
    XCTAssertTrue(field.waitForExistence(timeout: 8))
    // On a loaded machine the field can miss its first focus, and a fresh
    // simulator's system keyboard first shows a slide-to-type tip.
    for _ in 0..<8 {
      if app.key("key-q").waitForExistence(timeout: 2) { break }
      let tip = app.buttons["Continue"]
      let globe = app.buttons["Next keyboard"].firstMatch
      if !app.keyboards.firstMatch.exists, !globe.exists {
        field.tap()
      } else if tip.exists {
        tip.tap()
      } else if globe.exists {
        globe.tap()
      }
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 3), "Pulpo Keyboard isn't active:\n\(app.debugDescription)")
  }

  var field: XCUIElement {
    app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
  }

  var fieldText: String {
    let value = field.value as? String ?? ""
    return value == "Type here" ? "" : value
  }

  func waitForText(_ expected: String, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if fieldText == expected { return true }
      usleep(100_000)
    }
    return fieldText == expected
  }

  func type(_ text: String) {
    for character in text {
      app.key(character == " " ? "key-space" : "key-\(character)").tap()
    }
  }

  func testInstalledEmojiSuggestionTapsAlwaysApply() {
    repeatTap(typed: "i want red heart", label: "\u{2764}\u{FE0F}", exact: false, expected: "I want \u{2764}\u{FE0F}", name: "emoji")
  }

  func testInstalledWordSuggestionTapsAlwaysApply() {
    repeatTap(typed: "i want beau", label: "beautiful", exact: true, expected: "I want beautiful ", name: "word")
  }

  /// Counts taps that were ignored (the text never changed), applied late, or
  /// applied the wrong text, and reports a rate rather than stopping at the first.
  private func repeatTap(typed: String, label: String, exact: Bool, expected: String, name: String) {
    launchInstalledKeyboard()
    let predicate = exact
      ? NSPredicate(format: "identifier BEGINSWITH 'suggestion-' AND label == %@", label)
      : NSPredicate(format: "identifier BEGINSWITH 'suggestion-' AND label CONTAINS %@", label)
    let typedText = typed.prefix(1).uppercased() + typed.dropFirst()
    var ignored: [Int] = [], held: [Int] = [], late: [Int] = [], wrong: [String] = [], missing: [Int] = []
    for iteration in 0..<iterations {
      let clear = app.buttons["Clear"]
      if clear.exists, clear.isEnabled { clear.tap() }
      if !waitForText("", timeout: 4) {
        wrong.append("\(iteration): field not cleared (\(fieldText.debugDescription))")
        continue
      }
      type(typed)
      let suggestion = app.buttons.matching(predicate).firstMatch
      guard suggestion.waitForExistence(timeout: 8) else {
        missing.append(iteration)
        continue
      }
      suggestion.tap()
      // Progress survives an XCTest interaction failure that ends the test early.
      defer { print("STRESS-ITER \(name) \(iteration) ignored=\(ignored.count) held=\(held.count) late=\(late.count) wrong=\(wrong.count)") }
      if waitForText(expected, timeout: 4) { continue }
      // A tap read as a hold offers to forget the word instead of applying it.
      let notice = app.key("notice")
      if notice.exists {
        held.append(iteration)
        app.key("notice-dismiss").tap()
      } else if waitForText(expected, timeout: 6) {
        late.append(iteration)
      } else if fieldText == typedText {
        ignored.append(iteration)
      } else {
        wrong.append("\(iteration): \(fieldText.debugDescription)")
      }
    }
    let summary = "STRESS \(name) iterations=\(iterations) ignored=\(ignored.count) held=\(held.count) late=\(late.count) wrong=\(wrong.count) missing=\(missing.count) ignoredAt=\(ignored) heldAt=\(held) lateAt=\(late) wrongAt=\(wrong) missingAt=\(missing)"
    print(summary)
    let attachment = XCTAttachment(string: summary)
    attachment.name = "stress-\(name)"
    attachment.lifetime = .keepAlways
    add(attachment)
    XCTAssertEqual(ignored.count + held.count + late.count + wrong.count + missing.count, 0, summary)
  }
}
