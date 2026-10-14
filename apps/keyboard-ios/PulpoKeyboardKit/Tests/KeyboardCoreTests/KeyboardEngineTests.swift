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
    #expect(document.text == "I think the cat is weird.", "Actual text: \(document.text)")
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

  @Test func doubleSpaceAfterAPauseStaysTwoSpaces() {
    let (engine, document) = Fixtures.engine()
    var time = 10.0
    engine.clock = { time }
    engine.type("hello ")
    time += 2
    engine.insertSpace()
    #expect(document.text == "Hello  ")
  }

  @Test func disabledSwipeDoesNotEditOrLearn() {
    var settings = KeyboardSettings()
    settings.swipeTyping = false
    let (engine, document) = Fixtures.engine("and ", settings: settings)
    var generator = SeededGenerator(state: 1)
    #expect(engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator)).isEmpty)
    #expect(document.text == "and ")
    #expect(engine.suggester!.model.personal.totalCount == 0)
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

  @Test func replacingOrDeletingASwipeDoesNotTeachTheWrongWord() throws {
    let (engine, _) = Fixtures.engine("I want ")
    var generator = SeededGenerator(state: 9)
    engine.insertGlide(SyntheticSwipe.points(for: "to", noise: 0, generator: &generator))
    let personal = engine.suggester!.model.personal
    #expect(personal.count(of: "to") == 0)
    let alternative = try #require(engine.suggestions.slots.first { $0.text != "to" })
    engine.select(alternative)
    engine.insertSpace()
    #expect(personal.count(of: "to") == 0)
    #expect(personal.pairCount("want", alternative.text) == 1)
    #expect(personal.pairCount("to", alternative.text) == 0)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    engine.deleteBackward()
    engine.save()
    #expect(personal.count(of: "hello") == 0)
  }

  @Test func undoingAutocorrectDoesNotTeachTheCorrection() {
    let (engine, _) = Fixtures.engine("and ")
    engine.type("teh ")
    let personal = engine.suggester!.model.personal
    #expect(personal.count(of: "the") == 0)
    engine.deleteBackward()
    engine.insertSpace()
    #expect(personal.count(of: "the") == 0)
    #expect(personal.isKnown("teh"))
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

  @Test func cursorContextIncludesTwoWordsButStopsAtSentenceBoundaries() {
    let (engine, _) = Fixtures.engine("on my ")
    #expect(engine.suggestions.slots.map(\.text).contains("way"))
    #expect(engine.languageContext().trigram != nil)
    let (separate, _) = Fixtures.engine("on. my ")
    #expect(separate.languageContext().trigram == nil)
    let (newline, _) = Fixtures.engine("on\nmy ")
    #expect(newline.languageContext().trigram == nil)
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

  @Test(arguments: ["test@exmaple.com", "https://exmaple.com", "www.exmaple.com", "@recieve", "#recieve", "my_recieve"])
  func identifiersInsideChatAreKeptLiteral(token: String) {
    let (engine, document) = Fixtures.engine("and ")
    engine.type(token + " ")
    #expect(document.text == "and " + token + " ")
    #expect(engine.suggester!.model.personal.count(of: "exmaple") == 0)
    #expect(engine.suggester!.model.personal.count(of: "recieve") == 0)
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

  @Test func cursorMoveDuringFastTypingIsNotMistakenForProxyLag() {
    let (engine, document) = Fixtures.engine()
    engine.clock = { 100 }
    engine.type("hello teh")
    document.moveCursor(to: 5)
    engine.documentDidChange()
    #expect(engine.composingText == "Hello")
    #expect(engine.laggingContextUpdates == 0)
    engine.select(Suggestion(text: "hello", kind: .correction))
    #expect(document.text == "hello  teh")
  }

  @Test func delayedSwipeAcknowledgmentPreservesAlternativesAndWordDeletion() throws {
    let (engine, document) = Fixtures.engine("say ")
    document.contextBeforeOverride = document.text
    let points = "helo".utf8.compactMap { engine.glide!.geometry.center($0) }
    let candidates = engine.insertGlide(points)
    #expect(candidates.first?.text == "hello")
    let alternatives = engine.suggestions
    document.contextBeforeOverride = nil
    engine.documentDidChange()
    #expect(engine.phantomSpace)
    #expect(engine.composingText.isEmpty)
    #expect(engine.suggestions == alternatives)
    let alternative = try #require(alternatives.slots.first { $0.text != candidates.first?.text })
    engine.select(alternative)
    #expect(document.text == "say " + alternative.text)
    engine.deleteBackward()
    #expect(document.text == "say ")
  }

  @Test func delayedAutocorrectAcknowledgmentPreservesUndo() {
    let (engine, document) = Fixtures.engine("say ")
    engine.type("teh")
    document.contextBeforeOverride = document.text
    engine.insertSpace()
    #expect(document.text == "say the ")
    document.contextBeforeOverride = nil
    engine.documentDidChange()
    engine.deleteBackward()
    #expect(document.text == "say teh")
  }

  @Test func initiallyAttachingToLongContextFindsTheComposingWord() {
    let (engine, document) = Fixtures.engine("this is a long enough message with teh")
    #expect(engine.composingText == "teh")
    engine.insertSpace()
    #expect(document.text == "this is a long enough message with the ")
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

  @Test func synchronousStaleCallbackAfterIdlePreservesTheRequestedEdit() {
    let (engine, document) = Fixtures.engine("say ")
    engine.clock = { 200 }
    document.onWillEdit = { engine.documentDidChange() }
    engine.type("teh ")
    #expect(document.text == "say the ")
    #expect(engine.before == document.text)
    document.onWillEdit = nil
    engine.deleteBackward()
    #expect(document.text == "say teh")
  }
  @Test func expiredOwnSnapshotIsAcceptedAsAnExternalChange() {
    let (engine, document) = Fixtures.engine("say ")
    var now = 100.0
    engine.clock = { now }
    engine.type("teh ")
    now += 2
    document.text = "say teh"
    document.cursor = document.text.endIndex
    engine.documentDidChange()
    #expect(engine.composingText == "teh")
    #expect(engine.before == "say teh")
    #expect(engine.externalContextChanges == 1)
  }

  @Test func staleSnapshotAfterAutocorrectionPreservesUndo() {
    let (engine, document) = Fixtures.engine("say ")
    engine.type("teh")
    let old = document.text
    engine.insertSpace()
    #expect(document.text == "say the ")
    document.contextBeforeOverride = old
    engine.documentDidChange()
    document.contextBeforeOverride = nil
    engine.deleteBackward()
    #expect(document.text == "say teh")
  }
  @Test func staleSnapshotAfterSwipeAlternativePreservesPhantomSpace() throws {
    let (engine, document) = Fixtures.engine("say ")
    let points = "helo".utf8.compactMap { engine.glide!.geometry.center($0) }
    let candidates = engine.insertGlide(points)
    #expect(candidates.first?.text == "hello")
    let old = document.text
    let alternative = try #require(engine.suggestions.slots.first { $0.text != "hello" })
    engine.select(alternative)
    let chosen = document.text
    document.contextBeforeOverride = old
    engine.documentDidChange()
    document.contextBeforeOverride = nil
    engine.insertCharacter("a")
    #expect(document.text == chosen + " a")
  }
  @Test func staleEmptySnapshotDoesNotRecapitalizeSecondLetter() {
    let (engine, document) = Fixtures.engine()
    engine.insertCharacter("a")
    document.contextBeforeOverride = ""
    engine.documentDidChange()
    document.contextBeforeOverride = nil
    engine.insertCharacter("b")
    #expect(document.text == "Ab")
  }

  @Test func selectionChangeIsNotMistakenForAnEarlierOwnSnapshot() {
    let (engine, document) = Fixtures.engine()
    engine.type("hi")
    // Selecting the whole field has the same before/after text as its initial
    // empty state, but its nonempty selection makes it a new cursor context.
    document.contextBeforeOverride = ""
    document.selectionOverride = document.text
    engine.documentDidChange()
    #expect(engine.composingText.isEmpty)
    #expect(engine.externalContextChanges == 1)
    #expect(engine.laggingContextUpdates == 0)
  }

  @Test func anotherDocumentWithIdenticalTextDoesNotInheritAutocorrectUndo() {
    let (engine, document) = Fixtures.engine("say ")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    engine.type("teh ")
    #expect(document.text == "say the ")
    // Another field can contain precisely the same text as the previous field.
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    let deletions = document.deletions
    engine.deleteBackward()
    #expect(document.text == "say the")
    #expect(document.deletions == deletions + 1)
    #expect(engine.suggester!.model.personal.count(of: "the") == 0)
  }

  @Test func anotherDocumentMatchingARecentPrefixGetsItsOwnComposition() {
    let (engine, document) = Fixtures.engine("say ")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    engine.type("teh")
    document.text = "say t"
    document.cursor = document.text.endIndex
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    #expect(engine.composingText == "t")
    #expect(engine.laggingContextUpdates == 0)
    engine.insertSpace()
    #expect(document.text == "say t ")
  }

  @Test(arguments: [false, true])
  func hiddenDocumentDoesNotInheritWordUndo(swipe: Bool) {
    let (engine, document) = Fixtures.engine()
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    if swipe {
      engine.insertGlide("helo".utf8.compactMap { engine.glide!.geometry.center($0) })
    } else {
      engine.type("teh ")
    }
    document.text = "secret"
    document.cursor = document.text.endIndex
    document.hidesContext = true
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    let deletions = document.deletions
    engine.deleteBackward()
    #expect(document.text == "secre")
    #expect(document.deletions == deletions + 1)
    #expect(engine.composingText.isEmpty)
    #expect(engine.laggingContextUpdates == 0)
  }

  @Test func anotherDocumentDoesNotInheritSwipeSpacingOrTentativeLearning() {
    let (engine, document) = Fixtures.engine()
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    engine.insertGlide("helo".utf8.compactMap { engine.glide!.geometry.center($0) })
    #expect(engine.phantomSpace)
    document.text = "secret"
    document.cursor = document.text.endIndex
    document.hidesContext = true
    document.documentIdentifier = UUID()
    var traits = engine.traits
    traits.capitalization = .none
    engine.traits = traits
    engine.documentDidChange()
    #expect(!engine.phantomSpace)
    engine.insertCharacter("a")
    #expect(document.text == "secreta")
    #expect(engine.suggester!.model.personal.count(of: "hello") == 0)
  }

  @Test func identifiedDocumentStillIgnoresItsOwnDelayedSnapshots() {
    let (engine, document) = Fixtures.engine("say ")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    engine.type("teh")
    document.contextBeforeOverride = document.text
    engine.insertSpace()
    engine.documentDidChange()
    #expect(engine.laggingContextUpdates == 1)
    document.contextBeforeOverride = nil
    engine.deleteBackward()
    #expect(document.text == "say teh")
  }

  @Test func identifiedDocumentCanStillBeExplicitlyCleared() {
    let (engine, document) = Fixtures.engine()
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    engine.type("hi there")
    document.text = ""
    document.cursor = document.text.endIndex
    engine.documentDidChange()
    #expect(engine.composingText.isEmpty)
    #expect(engine.shift == .once(automatic: true))
    #expect(engine.laggingContextUpdates == 0)
  }
}
