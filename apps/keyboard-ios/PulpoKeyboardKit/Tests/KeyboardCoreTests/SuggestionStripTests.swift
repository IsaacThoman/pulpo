import Foundation
import Testing
@testable import KeyboardCore

/// How the three-slot strip is shared between the literal, completions,
/// predictions, learned words and emoji. Found by the keystroke-savings benchmark.
struct SuggestionStripTests {
  static let emoji = try! EmojiSuggester(catalog: EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json")))

  private final class Time { var now = 100.0 }

  /// Engines that share one language stack, like consecutive messages.
  private struct Session {
    let suggester: Suggester
    let glide: GlideDecoder
    let time = Time()

    init() {
      let (_, suggester, glide) = Fixtures.stack()
      self.suggester = suggester
      self.glide = glide
    }

    func message(_ text: String = "") -> (KeyboardEngine, MockDocument) {
      let document = MockDocument(text)
      let engine = KeyboardEngine(document: document, suggester: suggester, glide: glide)
      let time = time
      engine.clock = { time.now }
      engine.emojiSuggester = SuggestionStripTests.emoji
      engine.documentDidChange()
      return (engine, document)
    }

    /// Types with pauses, so separate capitals are never a Caps Lock double tap.
    func type(_ text: String, into engine: KeyboardEngine) {
      for character in text {
        time.now += 0.5
        engine.type(String(character))
      }
      engine.save()
    }
  }

  private func words(_ engine: KeyboardEngine) -> [String] {
    engine.suggestions.slots.filter { $0.kind != .emoji }.map(\.text)
  }

  @Test(arguments: [("In any case, ", "tha"), ("I wonder about ", "thi"), ("Do you know ", "wha")])
  func partialEmojiKeywordsDoNotHideTheOnlyCompletion(prefix: String, typed: String) {
    // "tha", "thi" and "wha" start emoji keywords (thanks, thinking, whale), but
    // the strip already holds the literal and an autocorrection.
    let (engine, _) = Session().message(prefix)
    engine.type(typed)
    let slots = engine.suggestions.slots
    #expect(slots.count == 3 && !slots.contains { $0.kind == .emoji }, "Strip: \(slots.map(\.text))")
    #expect(slots.contains { $0.kind == .completion || ($0.kind == .correction && !$0.isAutocorrection) })
  }

  @Test(arguments: ["I think you ", "It was from ", "Yeah but "])
  func everydayWordsKeepAllThreePredictions(prefix: String) {
    let (engine, _) = Session().message(prefix)
    #expect(engine.suggestions.slots.count == 3)
    #expect(!engine.suggestions.slots.contains { $0.kind == .emoji })
  }

  @Test func partialWordsBesideTheirWordStillOfferTheEmoji() throws {
    let (engine, _) = Session().message("I want ")
    engine.type("piz")
    #expect(words(engine).contains("pizza"))
    #expect(engine.suggestions.slots.contains { $0.kind == .emoji })
  }

  @Test func learningThePronounKeepsItsAutocorrection() {
    let session = Session()
    let (engine, document) = session.message()
    session.type("i think i can and i will and i ", into: engine)
    #expect(document.text == "I think I can and I will and I ")
    #expect(session.suggester.model.personal.count(of: "i") == 0)
    #expect(!words(engine).contains("i"))
  }

  @Test func learnedNamesKeepTheirCapital() {
    let session = Session()
    let (engine, _) = session.message("We watched ")
    session.type("Netflix and Netflix ", into: engine)
    let personal = session.suggester.model.personal
    #expect(personal.count(of: "netflix") == 0)
    #expect(personal.count(of: "Netflix") == 2)
  }

  @Test func dictionaryWordsUsedOnceBecomeCompletionCandidates() {
    let (model, suggester, _) = Fixtures.stack()
    let context = model.context(previousWord: "another", sentenceStart: false)
    let word = TypedWord(text: "cap")
    #expect(!suggester.candidates(for: word, context: context).contains { $0.text == "cappuccino" })
    model.personal.learn("cappuccino", after: "a")
    model.personal.learn("zorblax", after: "a")
    #expect(!model.personal.isKnown("cappuccino"))
    #expect(suggester.candidates(for: word, context: context).contains { $0.text == "cappuccino" && $0.isCompletion })
    // A one-off unknown token may be a typo; it stays out until it is known.
    #expect(!suggester.candidates(for: TypedWord(text: "zor"), context: context).contains { $0.text == "zorblax" })
  }

  @Test(arguments: ["th", "wh", "pl"])
  func shortUnknownPrefixesOfferThreeCompletions(prefix: String) {
    let (model, suggester, _) = Fixtures.stack()
    let set = suggester.suggestions(for: TypedWord(text: prefix), context: model.context(previousWord: "and", sentenceStart: false), autocorrect: true)
    #expect(set.autocorrection == nil)
    #expect(set.slots.count == 3)
    #expect(!set.slots.contains { $0.kind == .literal })
  }

  @Test func messagesLearnHowThePersonOpensThem() {
    let session = Session()
    let (fresh, _) = session.message()
    #expect(!words(fresh).contains("Okay"))
    for _ in 0..<6 {
      let (engine, _) = session.message()
      session.type("okay, sounds good. ", into: engine)
    }
    let (engine, _) = session.message()
    #expect(words(engine).contains("Okay"), "Strip: \(words(engine))")
  }

  @Test(arguments: ["left-", "and/"])
  func predictionsJoinHyphenatedAndSlashedWords(prefix: String) throws {
    let (engine, document) = Session().message("I am ")
    engine.type(prefix)
    let prediction = try #require(engine.suggestions.slots.first { $0.kind == .prediction })
    engine.select(prediction)
    #expect(document.text == "I am " + prefix + prediction.text + " ")
  }

  @Test func curlyApostrophesDoNotDuplicateTheTypedWord() {
    let (model, suggester, _) = Fixtures.stack()
    for typed in ["I\u{2019}m", "there\u{2019}s", "don\u{2019}t"] {
      let set = suggester.suggestions(for: TypedWord(text: typed), context: model.context(previousWord: "and", sentenceStart: false), autocorrect: true)
      let shown = set.slots.map { $0.text.replacingOccurrences(of: "\u{2019}", with: "'") }
      #expect(Set(shown).count == shown.count, "Strip: \(shown)")
    }
  }
}
