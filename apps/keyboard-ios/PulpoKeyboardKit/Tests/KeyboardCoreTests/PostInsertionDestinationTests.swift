import Foundation
import Testing
@testable import KeyboardCore

struct PostInsertionDestinationTests {
  private final class Document: TextDocument {
    let base = MockDocument("Bring supplies")
    var afterInsertion: ((String) -> Void)?
    var replacedByHost = false
    var subsequentEdits = 0

    var documentIdentifier: UUID? { base.documentIdentifier }
    var documentContextBeforeInput: String? { base.documentContextBeforeInput }
    var documentContextAfterInput: String? { base.documentContextAfterInput }
    var selectedText: String? { base.selectedText }
    var hasText: Bool { base.hasText }

    func insertText(_ text: String) {
      if replacedByHost { subsequentEdits += 1 }
      base.insertText(text)
      afterInsertion?(text)
    }

    func deleteBackward() {
      if replacedByHost { subsequentEdits += 1 }
      base.deleteBackward()
    }
  }

  /// A host can change during a primitive without immediately sending a
  /// callback. Later automatic edits must examine the newly visible context.
  @Test(arguments: KeyboardLanguage.allCases)
  func visibleHostReplacementAfterPunctuationReceivesNoAutomaticWrites(language: KeyboardLanguage) throws {
    let document = Document()
    let identifier = UUID()
    document.base.documentIdentifier = identifier
    document.base.moveCursor(to: 6)
    let stack = try LanguageStack(
      dictionaryURL: Fixtures.languageData.appendingPathComponent(language.rawValue + ".pkdict"),
      personalURL: nil)
    var settings = KeyboardSettings()
    settings.language = language
    let engine = KeyboardEngine(document: document, suggester: stack.suggester,
      glide: stack.glide, settings: settings)
    var traits = InputTraits()
    traits.capitalization = .none
    engine.traits = traits
    engine.documentDidChange()
    engine.insertTranscript("fresh")

    document.afterInsertion = { [weak document] text in
      guard let document, text == "," else { return }
      document.afterInsertion = nil
      document.base.text = "FOREIGNsupplies"
      document.base.moveCursor(to: 7)
      document.replacedByHost = true
      // No documentDidChange: both proxy sides already expose the replacement.
    }
    engine.insertCharacter(",")

    try #require(document.replacedByHost)
    #expect(document.documentIdentifier == identifier)
    #expect(document.documentContextBeforeInput == "FOREIGN")
    #expect(document.documentContextAfterInput == "supplies")
    #expect(document.base.text == "FOREIGNsupplies")
    #expect(document.subsequentEdits == 0)
    #expect(document.base.text.distance(from: document.base.text.startIndex,
      to: document.base.cursor) == 7)
  }
}
