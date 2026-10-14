import Foundation
import Testing

@testable import KeyboardCore

/// Frozen independently before reviewing the emoji selection implementation.
/// Only real engine slots can be selected; no injected emoji choices are used.
struct BlindEmojiWorkflowTests {
  private static let matcher = try! EmojiSuggester(
    catalog: EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json")))
  private final class Time { var now = 100.0 }
  private struct Driver {
    let engine: KeyboardEngine
    let document: MockDocument
    let time: Time
    func type(_ text: String) {
      for c in text {
        // Explicit Shift taps for capital letters must not be mistaken for a
        // deliberate double-tap Caps Lock by the shared test typing helper.
        time.now += c.isUppercase ? 0.4 : 0.02
        engine.type(String(c))
      }
    }
    func swipe(_ word: String) {
      var generator = SeededGenerator(state: 1009)
      engine.insertGlide(SyntheticSwipe.points(for: word, noise: 0, generator: &generator))
    }
    func emoji() throws -> Suggestion {
      try #require(engine.suggestions.slots.first { $0.kind == .emoji })
    }
  }
  private func make(_ text: String) -> Driver {
    let (e, d) = Fixtures.engine(text)
    let time = Time()
    e.clock = { time.now }
    e.emojiSuggester = Self.matcher
    return Driver(engine: e, document: d, time: time)
  }

  @Test(arguments: [
    ("I want ", "coffee"), ("That was ", "funny"), ("I love ", "red heart"),
    ("We need ", "hot beverage"), ("A café ", "coffee"), ("Family 👨‍👩‍👧‍👦 ", "heart"),
  ])
  func explicitComposingChoicesPreserveTheirWholePrefix(prefix: String, query: String) throws {
    let d = make(prefix)
    d.type(query)
    let choice = try d.emoji()
    #expect(d.document.text == prefix + query)
    #expect(!choice.isAutocorrection)
    d.engine.select(choice)
    #expect(d.document.text == prefix + choice.text)
    #expect(d.engine.composingText.isEmpty)
  }

  @Test func selectedEmojiHasANormalNextWordBoundary() throws {
    let d = make("My ")
    d.type("cat")
    let choice = try d.emoji()
    d.engine.select(choice)
    d.type(" sleeps")
    #expect(d.document.text == "My " + choice.text + " sleeps")
  }

  @Test func choosingAnEmojiForASwipeDoesNotRetainWordDeletion() throws {
    let d = make("Great ")
    d.swipe("coffee")
    let choice = try d.emoji()
    d.engine.select(choice)
    #expect(d.document.text == "Great " + choice.text)
    d.engine.deleteBackward()
    #expect(d.document.text == "Great ")
  }

  @Test(arguments: ["Need coffee ", "Need coffee  "])
  func committedWordsArePreservedWhenAppendingAnEmoji(prefix: String) throws {
    let d = make(prefix)
    let choice = try d.emoji()
    d.engine.select(choice)
    #expect(d.document.text == prefix + choice.text)
  }

  @Test(arguments: [
    ("Need ", "coffee "), ("I said ", "coffee, "), ("At ", "8pm "), ("Use ", "coffee.json "),
    ("Email ", "heart@example.com "), ("Open ", "https://example.com/coffee "),
  ])
  func ordinaryCommitsNeverApplyAnEmojiOrChangeLiterals(prefix: String, text: String) {
    let d = make(prefix)
    d.type(text)
    #expect(d.document.text == prefix + text)
    #expect(!d.document.text.unicodeScalars.contains { $0.properties.isEmojiPresentation })
  }

  @Test func choicesFromBeforeNewTypingAreIgnored() throws {
    let d = make("Need ")
    d.type("coffee")
    let choice = try d.emoji()
    d.type("x")
    d.engine.select(choice)
    #expect(d.document.text == "Need coffeex")
  }

  @Test func sameTextInAnotherFieldRejectsOldEmojiChoices() throws {
    let d = make("I love ")
    d.document.documentIdentifier = UUID()
    d.engine.documentDidChange()
    d.type("heart")
    let choice = try d.emoji()
    d.document.documentIdentifier = UUID()
    d.engine.documentDidChange()
    d.engine.select(choice)
    #expect(d.document.text == "I love heart")
  }

  @Test func cursorChangesCannotReplaceAnEarlierWord() throws {
    let d = make("My ")
    d.type("cat")
    let choice = try d.emoji()
    d.document.moveCursor(to: 1)
    d.engine.documentDidChange()
    d.engine.select(choice)
    #expect(d.document.text == "My cat")
    #expect(d.engine.suggestions.slots.isEmpty)
  }

  @Test func privateFieldsRejectCapturedChoices() throws {
    let d = make("Need ")
    d.type("coffee")
    let choice = try d.emoji()
    d.engine.traits.contentType = "password"
    d.engine.select(choice)
    #expect(d.document.text == "Need coffee")
    #expect(d.engine.suggestions.slots.isEmpty)
  }

  @Test func delayedOwnAcknowledgmentPreservesTheCurrentEmojiChoice() throws {
    let d = make("Need ")
    d.document.contextBeforeOverride = d.document.text
    d.type("coffee")
    let choice = try d.emoji()
    d.engine.documentDidChange()
    d.document.contextBeforeOverride = nil
    d.engine.documentDidChange()
    d.engine.select(choice)
    #expect(d.document.text == "Need " + choice.text)
  }
  @Test(arguments: [
    ("Thanks ", "thumbs up"), ("The emoji is 🧑🏽‍💻 ", "smile"), ("Cafe\u{0301} ", "heart"),
  ])
  func heldOutNamesAndUnicodePrefixes(prefix: String, query: String) throws {
    let d = make(prefix)
    d.type(query)
    let choice = try d.emoji()
    d.engine.select(choice)
    #expect(d.document.text == prefix + choice.text)
  }

  @Test func heldOutPunctuationAttachesToTheChosenEmoji() throws {
    let d = make("See ")
    d.type("dog")
    let choice = try d.emoji()
    d.engine.select(choice)
    d.engine.insertCharacter("!")
    #expect(d.document.text == "See " + choice.text + "!")
  }

  @Test func heldOutSwipeSelectionSeparatesTheNextWord() throws {
    let d = make("Bring ")
    d.swipe("pizza")
    let choice = try d.emoji()
    d.engine.select(choice)
    d.type("tomorrow")
    #expect(d.document.text == "Bring " + choice.text + " tomorrow")
  }

  @Test func heldOutCommittedFoodWordSurvivesAppending() throws {
    let d = make("I love pizza ")
    let choice = try d.emoji()
    d.engine.select(choice)
    #expect(d.document.text == "I love pizza " + choice.text)
  }

  @Test(arguments: ["snake_case", "HTTPServer"])
  func heldOutCleanLiteralsRemainTyped(text: String) {
    let d = make("Use ")
    d.type(text + " ")
    #expect(d.document.text == "Use " + text + " ")
  }

  @Test func heldOutNewSwipeRejectsACapturedEmoji() throws {
    let d = make("Need ")
    d.type("coffee")
    let choice = try d.emoji()
    d.swipe("tea")
    let intended = d.document.text
    d.engine.select(choice)
    #expect(d.document.text == intended)
    #expect(d.engine.phantomSpace)
  }

  @Test func heldOutExternalSuffixRejectsACapturedEmojiEvenBeforeCallback() throws {
    let d = make("I love ")
    d.type("heart")
    let choice = try d.emoji()
    d.document.text = "I love left"
    d.document.moveCursor(to: d.document.text.count)
    // Selection itself must reconcile the host's edit before the host callback.
    d.engine.select(choice)
    #expect(d.document.text == "I love left")
  }

  @Test func heldOutPredictionSettingsRejectCapturedChoices() throws {
    let d = make("My ")
    d.type("cat")
    let choice = try d.emoji()
    d.engine.settings.predictions = false
    d.engine.select(choice)
    #expect(d.document.text == "My cat")
    #expect(d.engine.suggestions.slots.isEmpty)
  }

  @Test func heldOutAppendChoiceCannotEraseANewlyComposingWord() throws {
    let d = make("Need coffee ")
    let choice = try d.emoji()
    d.type("now")
    d.engine.select(choice)
    #expect(d.document.text == "Need coffee now")
  }

}
