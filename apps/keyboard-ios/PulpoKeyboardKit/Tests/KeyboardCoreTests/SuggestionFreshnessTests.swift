import Foundation
import Testing

@testable import KeyboardCore

/// The bar paints on the next run-loop pass. A touch can therefore return a
/// captured choice after another input event or host callback changes its source.
struct SuggestionFreshnessTests {
  private func swipe(_ engine: KeyboardEngine, _ word: String) {
    var generator = SeededGenerator(state: 901)
    engine.insertGlide(SyntheticSwipe.points(for: word, noise: 0, generator: &generator))
  }

  private func pick(_ engine: KeyboardEngine, kind: Suggestion.Kind, text: String? = nil) throws
    -> Suggestion
  {
    try #require(
      engine.suggestions.slots.first { $0.kind == kind && (text == nil || $0.text == text) })
  }

  @Test func staleSwipeChoiceCannotReplaceNewlyTypedText() throws {
    let (engine, document) = Fixtures.engine("Say ")
    swipe(engine, "hello")
    let captured = try pick(engine, kind: .alternative)
    engine.type("friend")
    let intended = document.text
    engine.select(captured)
    #expect(document.text == intended)
    #expect(engine.composingText == "friend")
  }

  @Test func staleSwipeChoiceCannotReplaceANewerSwipe() throws {
    let (engine, document) = Fixtures.engine("Bring ")
    swipe(engine, "tea")
    let captured = try pick(engine, kind: .alternative)
    swipe(engine, "coffee")
    let intended = document.text
    let current = try pick(engine, kind: .alternative)
    engine.select(captured)
    #expect(document.text == intended)
    #expect(engine.phantomSpace)
    engine.select(current)
    #expect(document.text == "Bring tea " + current.text)
  }

  @Test func staleSwipeChoiceCannotDeleteExternalText() throws {
    let (engine, document) = Fixtures.engine("We saw ")
    swipe(engine, "there")
    let captured = try pick(engine, kind: .alternative)
    document.insertText(" yesterday")
    engine.documentDidChange()
    let intended = document.text
    engine.select(captured)
    #expect(document.text == intended)
    #expect(engine.composingText == "yesterday")
  }

  @Test func staleLiteralCannotAcceptAnUnrelatedComposition() throws {
    let (engine, document) = Fixtures.engine("The ")
    engine.type("cat")
    let captured = try pick(engine, kind: .literal)
    document.text = "A dog"
    document.moveCursor(to: document.text.count)
    engine.documentDidChange()
    engine.select(captured)
    #expect(document.text == "A dog")
    #expect(engine.composingText == "dog")
    #expect(!engine.suggester!.model.personal.isKnown("dog"))
  }

  @Test func staleCompletionCannotRemoveANewerPrefix() throws {
    let (engine, document) = Fixtures.engine("It is ")
    engine.type("beau")
    let captured = try pick(engine, kind: .completion, text: "beautiful")
    engine.type("t")
    engine.select(captured)
    #expect(document.text == "It is beaut")
    let current = try #require(engine.suggestions.slots.first { $0.text == "beautiful" })
    engine.select(current)
    #expect(document.text == "It is beautiful ")
  }

  @Test func staleCorrectionCannotRemoveNewCharacters() throws {
    let (engine, document) = Fixtures.engine("Please ")
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    engine.insertCharacter("x")
    engine.select(captured)
    #expect(document.text == "Please tehx")
  }

  @Test func stalePredictionCannotReplaceTheWordAlreadyStarted() throws {
    let (engine, document) = Fixtures.engine("Thank ")
    let captured = try pick(engine, kind: .prediction, text: "you")
    engine.type("her")
    engine.select(captured)
    #expect(document.text == "Thank her")
  }

  @Test func sameTextInAnotherDocumentDoesNotReuseChoices() throws {
    let (engine, document) = Fixtures.engine("Please ")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.select(captured)
    #expect(document.text == "Please teh")
    let current = try pick(engine, kind: .correction, text: "the")
    engine.select(current)
    #expect(document.text == "Please the ")
  }

  @Test func ownAcknowledgmentsAndLagDoNotInvalidateCurrentChoices() throws {
    let (engine, document) = Fixtures.engine("Say ")
    document.contextBeforeOverride = document.text
    swipe(engine, "hello")
    let captured = try pick(engine, kind: .alternative)
    engine.documentDidChange()  // The old pre-edit snapshot is still reported.
    #expect(engine.suggestions.slots.contains(captured))
    document.contextBeforeOverride = nil
    engine.documentDidChange()  // The requested edit is now acknowledged.
    #expect(engine.suggestions.slots.contains(captured))
    engine.select(captured)
    #expect(document.text == "Say " + captured.text)
  }

  @Test func policyChangesInvalidateCapturedChoices() throws {
    let (engine, document) = Fixtures.engine("Please ")
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    engine.traits.contentType = "password"
    engine.select(captured)
    #expect(document.text == "Please teh")
    #expect(engine.suggestions.slots.isEmpty)

    let (other, otherDocument) = Fixtures.engine("Please ")
    other.type("teh")
    let otherCaptured = try pick(other, kind: .correction, text: "the")
    other.settings.predictions = false
    other.select(otherCaptured)
    #expect(otherDocument.text == "Please teh")
    #expect(other.suggestions.slots.isEmpty)
  }

  @Test func differentEnginesCannotShareAChoiceAndSelectionsAreSingleUse() throws {
    let (engine, document) = Fixtures.engine("Please ")
    let (other, _) = Fixtures.engine("Please ")
    engine.type("teh")
    other.type("teh")
    engine.select(try pick(other, kind: .correction, text: "the"))
    #expect(document.text == "Please teh")
    let current = try pick(engine, kind: .correction, text: "the")
    engine.select(current)
    engine.select(current)
    #expect(document.text == "Please the ")
  }

  @Test func invalidRawSwipeChoicesDoNotFallThroughIntoCompositionReplacement() {
    let (engine, document) = Fixtures.engine("The ")
    engine.type("cat")
    engine.select(Suggestion(text: "car", kind: .alternative))
    #expect(document.text == "The cat")
    swipe(engine, "coffee")
    // Direct clients can still explicitly replace a currently owned swipe.
    engine.select(Suggestion(text: "car", kind: .alternative))
    #expect(document.text == "The cat car")
  }

  @Test func standaloneSelectionsRetainCompatibility() {
    let (engine, document) = Fixtures.engine("Please ")
    engine.type("teh")
    engine.select(Suggestion(text: "the", kind: .correction))
    engine.type("beau")
    engine.select(Suggestion(text: "beautiful", kind: .completion))
    #expect(document.text == "Please the beautiful ")
    engine.type("name")
    engine.select(Suggestion(text: "name", kind: .literal))
    #expect(document.text == "Please the beautiful name ")
  }
  @Test func pendingHostEditsInvalidateCapturedCorrectionsBeforeTheCallback() throws {
    let (engine, document) = Fixtures.engine("Please ")
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    document.text = "Please left"
    document.moveCursor(to: document.text.count)
    engine.select(captured)
    #expect(document.text == "Please left")
    #expect(engine.composingText == "left")
  }

  @Test func pendingFieldChangesRejectChoicesEvenWithIdenticalText() throws {
    let (engine, document) = Fixtures.engine("Please ")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    document.documentIdentifier = UUID()
    engine.select(captured)
    #expect(document.text == "Please teh")
  }

  @Test func pendingCursorMovesCannotApplyTheOldCompositionLength() throws {
    let (engine, document) = Fixtures.engine("Please ")
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    document.moveCursor(to: 3)
    engine.select(captured)
    #expect(document.text == "Please teh")
    #expect(document.text.distance(from: document.text.startIndex, to: document.cursor) == 3)
  }

  @Test func pendingExternalEditsInvalidateCapturedSwipeChoices() throws {
    let (engine, document) = Fixtures.engine("Say ")
    swipe(engine, "hello")
    let captured = try pick(engine, kind: .alternative)
    document.text = "Say friend"
    document.moveCursor(to: document.text.count)
    engine.select(captured)
    #expect(document.text == "Say friend")
  }

  @Test(arguments: [false, true])
  func selectionReconcilesOwnLagAndAcknowledgmentsWithoutLosingAValidChoice(acknowledged: Bool)
    throws
  {
    let (engine, document) = Fixtures.engine("Please ")
    document.contextBeforeOverride = document.text
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    if acknowledged { document.contextBeforeOverride = nil }
    // No explicit callback: select must distinguish this from an external edit.
    engine.select(captured)
    #expect(document.text == "Please the ")
  }

  /// On a loaded device the tap can land seconds after the last key while the
  /// proxy still reports the text before it. The person saw the choice for the
  /// text they typed, so it applies; a keystroke at that moment would as well.
  @Test(arguments: ["word", "emoji"])
  func displayedChoicesApplyWhileTheProxyTrailsTheTapBySeconds(kind: String) throws {
    let (engine, document) = Fixtures.engine("I want ")
    var now = 100.0
    engine.clock = { now }
    engine.emojiSuggester = EngineFuzz.emojiIndex
    let typed = kind == "word" ? "beau" : "red heart"
    engine.type(String(typed.dropLast()))
    document.contextBeforeOverride = document.text
    now += 0.3
    engine.type(String(typed.last!))
    let shown = try pick(engine, kind: kind == "word" ? .completion : .emoji, text: kind == "word" ? "beautiful" : nil)
    now += 2.5
    engine.select(shown)
    document.contextBeforeOverride = nil
    #expect(document.text == (kind == "word" ? "I want beautiful " : "I want \u{2764}\u{FE0F}"))
  }

  /// A host that reports our edits as it applies them can fall seconds behind on
  /// a loaded device. Its late report of an earlier key is lag, not an undo: the
  /// shown choice stays current and applies to the text the person typed.
  @Test func lateReportsFromAnEchoingHostKeepTheDisplayedChoice() throws {
    let (engine, document) = Fixtures.engine("I want ")
    var now = 100.0
    engine.clock = { now }
    engine.emojiSuggester = EngineFuzz.emojiIndex
    for character in "red hea" {
      now += 0.25
      engine.type(String(character))
      engine.documentDidChange()
    }
    now += 0.25
    engine.type("r")
    let reported = document.text
    now += 0.25
    engine.type("t")
    let shown = try pick(engine, kind: .emoji)
    now += 1.3
    document.contextBeforeOverride = reported
    engine.documentDidChange()
    #expect(engine.suggestions.slots.contains(shown))
    engine.select(shown)
    document.contextBeforeOverride = nil
    #expect(document.text == "I want \u{2764}\u{FE0F}")
  }

  /// The emoji index finishes off the typing path, possibly between a bar
  /// refresh and a tap. It changes what may be offered next, not the text.
  @Test func emojiIndexArrivalKeepsDisplayedChoices() throws {
    let (engine, document) = Fixtures.engine("I want ")
    engine.type("beau")
    let shown = try pick(engine, kind: .completion, text: "beautiful")
    engine.emojiSuggester = EngineFuzz.emojiIndex
    engine.select(shown)
    #expect(document.text == "I want beautiful ")
  }

  /// Hosts re-send traits with text callbacks. Changes that keep the input policy
  /// keep the shown choices; changes to the policy still void them.
  @Test func onlyPolicyChangingTraitsInvalidateDisplayedChoices() throws {
    let (engine, document) = Fixtures.engine("Please ")
    engine.type("teh")
    let shown = try pick(engine, kind: .correction, text: "the")
    var traits = engine.traits
    traits.prefersDarkAppearance = true
    traits.returnKey = .send
    engine.traits = traits
    engine.documentDidChange()
    engine.select(shown)
    #expect(document.text == "Please the ")

    let (other, otherDocument) = Fixtures.engine("Please ")
    other.type("teh")
    let otherShown = try pick(other, kind: .correction, text: "the")
    var email = other.traits
    email.keyboard = .email
    other.traits = email
    other.select(otherShown)
    #expect(otherDocument.text == "Please teh")
  }

  /// A field that starts withholding its context at the tap gives no ground for
  /// the choice, which was shown for text the keyboard can no longer see.
  @Test func newlyWithheldContextStillVoidsAChoiceAtTheTap() throws {
    let (engine, document) = Fixtures.engine("Please ")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    var now = 100.0
    engine.clock = { now }
    engine.type("teh")
    let shown = try pick(engine, kind: .correction, text: "the")
    now += 2
    document.hidesContext = true
    engine.select(shown)
    #expect(document.text == "Please teh")
  }

  @Test func selectingACurrentChoiceSurvivesReentrantOwnEditCallbacks() throws {
    let (engine, document) = Fixtures.engine("Please ")
    engine.type("teh")
    let captured = try pick(engine, kind: .correction, text: "the")
    document.onWillEdit = { engine.documentDidChange() }
    engine.select(captured)
    #expect(document.text == "Please the ")
    engine.deleteBackward()
    #expect(document.text == "Please the")
  }

}
