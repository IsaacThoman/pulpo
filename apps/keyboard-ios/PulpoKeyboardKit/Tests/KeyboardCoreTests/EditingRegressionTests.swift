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

  @Test func wordDeleteRemovesOnlyTheSelection() {
    let (engine, document) = Fixtures.engine()
    let host = SelectingDocument(document)
    let selecting = KeyboardEngine(document: host, suggester: engine.suggester, glide: engine.glide)
    selecting.documentDidChange()
    selecting.type("te5")
    host.select(last: 1)
    selecting.documentDidChange()
    selecting.deleteWordBackward()
    #expect(host.text == "Te")
    // A selection whose callback has not arrived yet is still the whole deletion.
    host.select(last: 1)
    selecting.deleteWordBackward()
    #expect(host.text == "T")
  }
}

/// A mock field whose selection is real: insertion and deletion replace it.
private final class SelectingDocument: TextDocument {
  let backing: MockDocument
  var selection = 0

  init(_ backing: MockDocument) { self.backing = backing }

  var text: String { backing.text }
  var documentIdentifier: UUID? { backing.documentIdentifier }
  var documentContextBeforeInput: String? { String(backing.text[..<start]) }
  var documentContextAfterInput: String? { String(backing.text[backing.cursor...]) }
  var selectedText: String? { selection > 0 ? String(backing.text[start..<backing.cursor]) : nil }
  var hasText: Bool { backing.hasText }
  private var start: String.Index { backing.text.index(backing.cursor, offsetBy: -selection) }

  func select(last count: Int) { selection = count }

  func insertText(_ text: String) {
    removeSelection()
    backing.insertText(text)
  }

  func deleteBackward() {
    if selection > 0 { removeSelection() } else { backing.deleteBackward() }
  }

  private func removeSelection() {
    guard selection > 0 else { return }
    let from = start
    backing.text.removeSubrange(from..<backing.cursor)
    backing.cursor = from
    selection = 0
  }
}
