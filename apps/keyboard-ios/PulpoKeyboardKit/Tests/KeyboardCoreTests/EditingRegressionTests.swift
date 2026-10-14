import Foundation
import Testing
@testable import KeyboardCore

/// Minimal editing repros found by the randomized editing fuzzer (`EngineFuzz`).
struct EditingRegressionTests {
  @Test func suggestionBeforeExistingSpaceDoesNotDoubleIt() throws {
    let (engine, document) = Fixtures.engine("I like beau world")
    document.moveCursor(to: 11)
    engine.documentDidChange()
    #expect(engine.composingText == "beau")
    let pick = try #require(engine.suggestions.slots.first { $0.text == "beautiful" })
    engine.select(pick)
    #expect(document.text == "I like beautiful world")
    engine.insertCharacter(",")
    #expect(document.text == "I like beautiful, world")
  }

  @Test func keptLiteralBeforeExistingSpaceAddsNothing() throws {
    let (engine, document) = Fixtures.engine("say teh now")
    document.moveCursor(to: 7)
    engine.documentDidChange()
    let literal = try #require(engine.suggestions.slots.first { $0.kind == .literal })
    engine.select(literal)
    #expect(document.text == "say teh now")
  }

  @Test func typingAfterInsertedTextContinuesTheWholeWord() {
    let (engine, document) = Fixtures.engine("so ")
    engine.insertTranscript("I said the")
    engine.type("ir")
    #expect(engine.composingText == "their")
    engine.insertSpace()
    #expect(document.text == "so I said their ")
    // The same holds after a whole-word delete leaves an untracked word behind.
    let (other, otherDocument) = Fixtures.engine("we saw teh.")
    other.deleteWordBackward()
    #expect(otherDocument.text == "we saw teh")
    other.type("n")
    #expect(other.composingText == "tehn")
  }

  @Test func replacingASelectionContinuesTheWordBeforeIt() {
    let (engine, document) = Fixtures.engine("Bl")
    document.cursor = document.text.index(after: document.text.startIndex)
    document.selectionOverride = "l"
    engine.documentDidChange()
    document.text = "B"
    document.cursor = document.text.endIndex
    document.selectionOverride = nil
    engine.type("dnt")
    #expect(engine.composingText == "Bdnt")
    // Retyping a contraction's last letter continues across its apostrophe.
    let (other, otherDocument) = Fixtures.engine("say don\u{2019}t")
    otherDocument.selectionOverride = "t"
    otherDocument.text = "say don\u{2019}"
    otherDocument.cursor = otherDocument.text.endIndex
    other.documentDidChange()
    otherDocument.selectionOverride = nil
    other.type("teh")
    #expect(other.composingText == "don\u{2019}teh")
  }
}
