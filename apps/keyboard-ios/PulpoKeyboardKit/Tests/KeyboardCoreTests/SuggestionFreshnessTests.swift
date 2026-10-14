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
