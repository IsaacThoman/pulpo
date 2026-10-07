import Foundation
import Testing
@testable import KeyboardCore

struct KeyboardEngineTests {
  @Test func capitalizesTheStartOfSentences() {
    let (engine, document) = Fixtures.engine()
    #expect(engine.shift == .once(automatic: true))
    engine.type("hello there. how are you")
    #expect(document.text == "Hello there. How are you")
  }

  @Test func autocorrectsOnSpaceAndPunctuation() {
    let (engine, document) = Fixtures.engine()
    engine.type("i think teh cat is wierd.")
    #expect(document.text == "I think the cat is weird.")
  }

  @Test func deleteRightAfterAutocorrectRestoresTheTypedWord() {
    let (engine, document) = Fixtures.engine()
    engine.type("and teh ")
    #expect(document.text == "And the ")
    engine.deleteBackward()
    #expect(document.text == "And teh")
    engine.insertSpace()
    // Kept as typed; the person meant it.
    #expect(document.text == "And teh ")
  }

  @Test func doubleSpaceTypesAPeriod() {
    let (engine, document) = Fixtures.engine()
    engine.type("ok  so")
    #expect(document.text == "Ok. So")
  }

  @Test func doubleSpaceCanBeTurnedOff() {
    var settings = KeyboardSettings()
    settings.doubleSpacePeriod = false
    let (engine, document) = Fixtures.engine(settings: settings)
    engine.type("ok  so")
    #expect(document.text == "Ok  so")
  }

  @Test func shiftTapAndCapsLock() {
    var time = 10.0
    let (engine, document) = Fixtures.engine("x ")
    engine.clock = { time }
    engine.shiftDown(); engine.shiftUp()
    engine.insertCharacter("a")
    engine.insertCharacter("b")
    #expect(document.text == "x Ab")
    time = 20
    engine.shiftDown(); engine.shiftUp()
    time = 20.2
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .locked)
    engine.insertCharacter("c")
    engine.insertCharacter("d")
    #expect(document.text == "x AbCD")
    time = 21
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .off)
  }

  @Test func holdingShiftWorksAsAChord() {
    let (engine, document) = Fixtures.engine("x ")
    engine.shiftDown()
    engine.insertCharacter("a")
    engine.insertCharacter("b")
    engine.shiftUp()
    engine.insertCharacter("c")
    #expect(document.text == "x ABc")
    #expect(engine.shift == .off)
  }

  @Test func curlsQuotesAndApostrophes() {
    let (engine, document) = Fixtures.engine("x ")
    engine.insertCharacter("\"")
    engine.type("hi")
    engine.insertCharacter("\"")
    engine.insertSpace()
    engine.type("its")
    engine.insertCharacter("'")
    #expect(document.text == "x \u{201C}hi\u{201D} its\u{2019}")
  }

  @Test func straightQuotesWhenTheFieldOptsOut() {
    var traits = InputTraits()
    traits.smartQuotes = false
    let (engine, document) = Fixtures.engine("x ", traits: traits)
    engine.insertCharacter("'")
    #expect(document.text == "x '")
  }

  @Test func swipesGetAutomaticSpaces() {
    let (engine, document) = Fixtures.engine()
    var generator = SeededGenerator(state: 3)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    #expect(document.text == "Hello")
    engine.insertGlide(SyntheticSwipe.points(for: "world", noise: 0, generator: &generator))
    #expect(document.text == "Hello world")
    // Punctuation attaches to the word; the owed space is dropped.
    engine.insertCharacter(".")
    #expect(document.text == "Hello world.")
    engine.insertSpace()
    engine.insertGlide(SyntheticSwipe.points(for: "thanks", noise: 0, generator: &generator))
    #expect(document.text == "Hello world. Thanks")
    // Typing a letter after a swipe starts a new word.
    engine.type("a")
    #expect(document.text == "Hello world. Thanks a")
  }

  @Test func deleteAfterASwipeRemovesTheWholeWord() {
    let (engine, document) = Fixtures.engine("I said ")
    var generator = SeededGenerator(state: 5)
    engine.insertGlide(SyntheticSwipe.points(for: "something", noise: 0, generator: &generator))
    #expect(document.text == "I said something")
    engine.deleteBackward()
    #expect(document.text == "I said ")
  }

  @Test func pickingASwipeAlternativeReplacesTheWord() throws {
    let (engine, document) = Fixtures.engine("I want ")
    var generator = SeededGenerator(state: 9)
    engine.insertGlide(SyntheticSwipe.points(for: "to", noise: 0, generator: &generator))
    let alternative = try #require(engine.suggestions.slots.first { $0.text != "to" })
    engine.select(alternative)
    #expect(document.text == "I want \(alternative.text)")
  }

  @Test func suggestionTapAddsASpaceThatPunctuationTakesBack() throws {
    let (engine, document) = Fixtures.engine("I like ")
    engine.type("beau")
    let pick = try #require(engine.suggestions.slots.first { $0.text == "beautiful" })
    engine.select(pick)
    #expect(document.text == "I like beautiful ")
    engine.insertCharacter("!")
    #expect(document.text == "I like beautiful!")
  }

  @Test func predictionsAppearAfterASpace() {
    let (engine, _) = Fixtures.engine("Thank ")
    #expect(engine.suggestions.slots.map(\.text).contains("you"))
  }

  @Test func deleteWordRemovesThePreviousWord() {
    let (engine, document) = Fixtures.engine("one two three  ")
    engine.deleteWordBackward()
    #expect(document.text == "one two ")
    engine.deleteWordBackward()
    #expect(document.text == "one ")
  }

  @Test func numbersPageReturnsToLettersAfterSpace() {
    let (engine, document) = Fixtures.engine("Meet at ")
    engine.page = .numbers
    engine.insertCharacter("5")
    engine.insertSpace()
    #expect(engine.page == .letters)
    #expect(document.text == "Meet at 5 ")
  }

  @Test func privateFieldsAreNotCorrectedOrLearned() {
    var traits = InputTraits()
    traits.contentType = "username"
    traits.capitalization = .none
    let (engine, document) = Fixtures.engine(traits: traits)
    engine.type("teh ")
    #expect(document.text == "teh ")
    #expect(engine.suggestions.slots.isEmpty)
    #expect(engine.suggester!.model.personal.count(of: "teh") == 0)
  }

  @Test func emailFieldsSkipCapitalsAndCorrections() {
    var traits = InputTraits()
    traits.keyboard = .email
    let (engine, document) = Fixtures.engine(traits: traits)
    engine.type("teh")
    engine.insertCharacter("@")
    #expect(document.text == "teh@")
  }

  @Test func transcriptsJoinTheSurroundingText() {
    let (engine, document) = Fixtures.engine("so")
    engine.insertTranscript("Then we left.")
    #expect(document.text == "so then we left.")
    let (fresh, freshDocument) = Fixtures.engine("")
    fresh.insertTranscript("Hello there.")
    #expect(freshDocument.text == "Hello there.")
  }

  @Test func externalCursorMovesResetTheWord() {
    let (engine, document) = Fixtures.engine("hello wor")
    #expect(engine.composingText == "wor")
    document.moveCursor(to: 5)
    engine.documentDidChange()
    #expect(engine.composingText == "hello")
  }

  @Test func noCorrectionsInTheMiddleOfAWord() {
    let (engine, document) = Fixtures.engine("tehx")
    document.moveCursor(to: 3)
    engine.documentDidChange()
    engine.insertSpace()
    #expect(document.text == "teh x")
  }

  @Test func fastTypingSurvivesALaggingTextProxy() {
    let (engine, document) = Fixtures.engine("I said ")
    engine.type("hel")
    // The host reports the document one character behind while typing continues.
    document.lag = 1
    engine.documentDidChange()
    document.lag = 0
    engine.type("lo teh ")
    #expect(document.text == "I said hello the ")
    #expect(engine.laggingContextUpdates == 1)
  }

  @Test func clearedFieldIsNotMistakenForLag() {
    let (engine, document) = Fixtures.engine()
    engine.type("hi there")
    document.text = ""
    document.cursor = document.text.endIndex
    engine.documentDidChange()
    #expect(engine.composingText == "")
    #expect(engine.shift == .once(automatic: true))
  }

  @Test func swipeThatFitsNoWordChangesNothing() {
    let (engine, document) = Fixtures.engine("so ")
    engine.type("ab")
    // A tiny wobble on one key decodes to nothing.
    let result = engine.insertGlide([KeyPoint(x: 5.5, y: 1.0), KeyPoint(x: 5.6, y: 1.05)])
    #expect(result.isEmpty)
    #expect(document.text == "so ab")
    #expect(engine.composingText == "ab")
  }

  @Test func learnsWordsTypedTwice() {
    let (engine, _) = Fixtures.engine()
    let personal = engine.suggester!.model.personal
    engine.type("zorbly ")
    engine.deleteBackward()
    engine.type(" ")
    engine.type("zorbly ")
    #expect(personal.count(of: "zorbly") >= 1)
  }
}
