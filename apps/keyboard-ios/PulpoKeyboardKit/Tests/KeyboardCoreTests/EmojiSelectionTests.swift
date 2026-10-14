import Foundation
import Testing
@testable import KeyboardCore

struct EmojiSelectionTests {
  static let catalog = try! EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json"))
  static let index = EmojiSuggester(catalog: catalog)

  private func engine(_ text: String = "", settings: KeyboardSettings = KeyboardSettings(), traits: InputTraits = InputTraits()) -> (KeyboardEngine, MockDocument) {
    let pair = Fixtures.engine(text, settings: settings, traits: traits)
    pair.0.emojiSuggester = Self.index
    return pair
  }

  private func choice(_ engine: KeyboardEngine) throws -> Suggestion {
    try #require(engine.suggestions.slots.first { $0.kind == .emoji })
  }

  @Test(arguments: [("pizza", "🍕"), ("happy", "😀"), ("thanks", "🙏"), ("coffee", "☕"), ("thumbsup", "👍")])
  func namesAndRelatedWordsOfferExplicitEmoji(query: String, value: String) throws {
    let (engine, document) = engine()
    engine.type(query)
    let emoji = try choice(engine)
    #expect(emoji.text == value)
    #expect(emoji.accessibilityLabel?.hasSuffix(" emoji") == true)
    #expect(!emoji.isAutocorrection)
    #expect(engine.suggestions.slots.contains { $0.kind == .literal })
    #expect(engine.suggestions.slots.count <= 3)
    engine.select(emoji)
    #expect(document.text == value)
    #expect(engine.composingText.isEmpty)
    #expect(engine.suggester?.model.personal.totalCount == 0)
  }

  @Test(arguments: [("I want red hea", "I want ❤️"), ("try black cat", "try 🐈‍⬛"), ("need woman technologist", "need 👩‍💻")])
  func replacesOnlyTheMatchingPhrase(input: String, expected: String) throws {
    let (engine, document) = engine(input)
    engine.select(try choice(engine))
    #expect(document.text == expected)
  }

  @Test func keepsAutocorrectionAndNeverAppliesEmojiOnSpace() throws {
    let (engine, document) = engine("I want ")
    engine.type("piz")
    let before = engine.suggestions
    #expect(before.slots.contains { $0.kind == .emoji })
    let correction = before.autocorrection
    if let correction {
      #expect(before.slots.contains { $0.text == correction && $0.isAutocorrection })
    }
    engine.insertSpace()
    #expect(!document.text.contains("🍕"))
    let (plain, plainDocument) = Fixtures.engine("I want ")
    plain.type("piz ")
    #expect(document.text == plainDocument.text)
  }

  @Test func emojiSpacingWorksWithWordsPunctuationSpaceAndBackspace() throws {
    for (suffix, expected) in [("next", "🍕 next"), ("!", "🍕!"), (" next", "🍕 next"), ("\n", "🍕\n")] {
      let (engine, document) = engine("pizza")
      engine.select(try choice(engine))
      engine.type(suffix)
      #expect(document.text == expected)
    }
    let (engine, document) = engine("woman technologist")
    engine.select(try choice(engine))
    engine.deleteBackward()
    #expect(document.text.isEmpty)
    #expect(document.deletions == "woman technologist".count + 1)
  }

  @Test func completedWordsArePreservedWhenAppendingEmoji() throws {
    for input in ["happy ", "I want red heart ", "coffee   "] {
      let (engine, document) = engine(input)
      let emoji = try choice(engine)
      engine.select(emoji)
      #expect(document.text == input + emoji.text)
      #expect(document.deletions == 0)
    }
  }

  @Test func sharesRecentEmojiAndPreferredSkinTone() throws {
    let suite = "EmojiSelectionTests-\(UUID())"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let history = EmojiHistory(defaults: defaults)
    let base = try #require(Self.index.suggestions(for: "thumbsup").first)
    history.setPreferred("👍🏽", for: base)
    let (engine, document) = engine("thumbsup")
    engine.emojiHistory = history
    let emoji = try choice(engine)
    #expect(emoji.text == "👍🏽")
    engine.select(emoji)
    #expect(document.text == "👍🏽")
    #expect(history.recents.first == "👍🏽")
    engine.deleteBackward()
    #expect(document.text.isEmpty)
  }

  @Test func swipeEmojiReplacementDoesNotLearnTheDiscardedWord() throws {
    let (engine, document) = engine("I want ")
    var random = SeededGenerator(state: 47)
    let decoded = engine.insertGlide(SyntheticSwipe.points(for: "pizza", noise: 0, generator: &random))
    #expect(decoded.first?.text == "pizza")
    engine.select(try choice(engine))
    #expect(document.text == "I want 🍕")
    engine.type("please ")
    #expect(document.text == "I want 🍕 please ")
    #expect(engine.suggester?.model.personal.count(of: "pizza") == 0)
  }

  @Test(arguments: ["alice@happy", "#happy", "my_happy", "https://happy", "www.happy", "coffee.js", "happy()=true", "unhappy_variable", "happy. ", "happy\n", "", "I "])
  func technicalOrUnrelatedContextsDoNotOfferEmoji(input: String) {
    let (engine, _) = engine(input)
    #expect(!engine.suggestions.slots.contains { $0.kind == .emoji }, "\(input)")
  }

  @Test func fieldAndSettingsPoliciesSuppressEmoji() {
    for contentType in ["password", "username", "oneTimeCode", "emailAddress"] {
      var traits = InputTraits()
      traits.contentType = contentType
      let (engine, _) = engine("happy", traits: traits)
      #expect(!engine.suggestions.slots.contains { $0.kind == .emoji })
    }
    for keyboard in [InputTraits.Keyboard.email, .url, .numberPad, .decimalPad] {
      var traits = InputTraits()
      traits.keyboard = keyboard
      let (engine, _) = engine("happy", traits: traits)
      #expect(!engine.suggestions.slots.contains { $0.kind == .emoji })
    }
    var settings = KeyboardSettings()
    settings.predictions = false
    let (engine, _) = engine("happy", settings: settings)
    #expect(!engine.suggestions.slots.contains { $0.kind == .emoji })
  }

  @Test func staleAndForgedEmojiCannotDeleteNewText() throws {
    let (engine, document) = engine("pizza")
    let old = try choice(engine)
    engine.type("s")
    let typed = document.text
    engine.select(old)
    #expect(document.text == typed)
    engine.select(Suggestion(text: "🍕", kind: .emoji))
    #expect(document.text == typed)
    let (other, otherDocument) = self.engine("pizza")
    other.select(old)
    #expect(otherDocument.text == "pizza")
  }

  @Test func externalEditsAndCursorSelectionAreReconciledBeforeEmojiTap() throws {
    for change in 0..<4 {
      let (engine, document) = engine("happy")
      document.documentIdentifier = UUID()
      engine.documentDidChange()
      let old = try choice(engine)
      switch change {
      case 0: document.insertText(" yesterday") // Callback has not arrived yet.
      case 1: document.documentIdentifier = UUID() // Same text in another field.
      case 2: document.moveCursor(to: 2)
      default: document.selectionOverride = "happy"
      }
      let expected = document.text
      engine.select(old)
      #expect(document.text == expected)
      #expect(document.deletions == 0)
    }
  }

  @Test func privateTransitionInvalidatesEmojiAndMidWordOffersNothing() throws {
    let (engine, document) = engine("happy")
    let old = try choice(engine)
    engine.traits.isSecure = true
    engine.select(old)
    #expect(document.text == "happy")
    engine.traits.isSecure = false
    document.moveCursor(to: 3)
    engine.documentDidChange()
    #expect(!engine.suggestions.slots.contains { $0.kind == .emoji })
  }

  @Test func delayedOwnCallbacksPreserveValidEmojiSelection() throws {
    let (engine, document) = engine("I want ")
    engine.type("pizza")
    let emoji = try choice(engine)
    document.contextBeforeOverride = "I want piz"
    document.onWillEdit = { engine.documentDidChange() }
    engine.select(emoji)
    #expect(document.text == "I want 🍕")
    document.contextBeforeOverride = nil
    engine.documentDidChange()
    engine.insertCharacter("!")
    #expect(document.text == "I want 🍕!")
  }
}
