import XCTest
import UIKit
@testable import KeyboardUI

@MainActor
final class EmojiSuggestionTests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
  }

  func testEmojiSlotUsesReadableGlyphAndFriendlyAccessibility() throws {
    for landscape in [false, true] {
      let style = KeyboardStyle(modern: true, dark: false, landscape: landscape, inset: true)
      let bar = SuggestionBarView(style: style)
      bar.frame = CGRect(x: 0, y: 0, width: landscape ? 667 : 320, height: style.barHeight)
      let emoji = Suggestion(text: "🍕", kind: .emoji, accessibilityLabel: "pizza")
      bar.setSuggestions([Suggestion(text: "pizza", kind: .literal), emoji])
      bar.layoutIfNeeded()
      let slot = try XCTUnwrap(bar.subviews.compactMap { $0 as? SlotControl }.first { $0.suggestion?.kind == .emoji })
      slot.layoutIfNeeded()
      let label = try XCTUnwrap(slot.subviews.compactMap { $0 as? UILabel }.first)
      XCTAssertEqual(label.font.pointSize, 24)
      XCTAssertLessThanOrEqual(label.font.lineHeight, label.bounds.height + 1)
      XCTAssertEqual(slot.accessibilityLabel, "pizza, 🍕")
      XCTAssertTrue(bar.bounds.contains(slot.frame))
      var selected: Suggestion?
      bar.onSelect = { selected = $0 }
      slot.sendActions(for: .touchUpInside)
      XCTAssertEqual(selected, emoji)
    }
  }

  func testPreviewEmojiSuggestionsReplaceAndAppend() throws {
    try exerciseEmojiSuggestions(installed: false)
  }

  func testInstalledEmojiSuggestionsReplaceAndAppend() throws {
    try exerciseEmojiSuggestions(installed: true)
  }

  private func exerciseEmojiSuggestions(installed: Bool) throws {
    let app = XCUIApplication()
    app.launchArguments = ["-PKPreview", "-PKResetLearning", "-PKResetSettings"]
    if installed { app.launchArguments.append("-PKSystemKeyboard") }
    app.launch()
    if installed {
      let field = app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]
      XCTAssertTrue(field.waitForExistence(timeout: 8))
      if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
      for _ in 0..<4 {
        if app.key("key-q").waitForExistence(timeout: 2) { break }
        let globe = app.buttons["Next keyboard"].firstMatch
        if globe.exists { globe.tap() } else { break }
      }
    }
    XCTAssertTrue(app.key("key-q").waitForExistence(timeout: 8), app.debugDescription)
    let cases = [
      (typed: "pizza", emoji: "🍕", name: "pizza", expected: "🍕"),
      (typed: "happy", emoji: "😀", name: "grinning face", expected: "😀"),
      (typed: "i want red heart", emoji: "❤️", name: "red heart", expected: "I want ❤️"),
      (typed: "happy ", emoji: "😀", name: "grinning face", expected: "Happy 😀"),
    ]
    for (index, item) in cases.enumerated() {
      if index > 0 { app.buttons["Clear"].tap() }
      app.typeOnPreview(item.typed)
      let suggestion = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'suggestion-' AND label CONTAINS %@", item.emoji)).firstMatch
      XCTAssertTrue(suggestion.waitForExistence(timeout: 6), "No emoji for \(item.typed):\n\(app.debugDescription)")
      XCTAssertTrue(suggestion.label.contains(item.name), suggestion.label)
      XCTAssertTrue(suggestion.label.contains(item.emoji), suggestion.label)
      if index == 0 {
        snapshot("\(installed ? "installed" : "preview")-emoji-suggestion")
        suggestion.press(forDuration: 0.6)
        XCTAssertFalse(app.key("notice").exists, "Emoji must not offer Forget Word")
      }
      suggestion.tap()
      let field = installed ? (app.textViews["system-text"].exists ? app.textViews["system-text"] : app.textFields["system-text"]) : app.textViews["preview-text"]
      let matches = NSPredicate(format: "value == %@", item.expected)
      expectation(for: matches, evaluatedWith: field)
      waitForExpectations(timeout: 4)
      XCTAssertEqual(field.value as? String, item.expected)
    }
  }
}
