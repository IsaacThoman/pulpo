import Foundation
import Testing
@testable import KeyboardCore

/// Exercises the same engine entry point used by native alternate selection.
@Suite(.serialized)
struct SpanishEntryTests {
  private func engine(_ language: KeyboardLanguage, text: String = "", traits: InputTraits = InputTraits()) throws -> (KeyboardEngine, MockDocument) {
    let stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(language.rawValue + ".pkdict"), personalURL: nil)
    var settings = KeyboardSettings()
    settings.language = language
    let document = MockDocument(text)
    let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
    engine.traits = traits
    engine.documentDidChange()
    return (engine, document)
  }

  @Test func invertedPunctuationPreservesSentenceCapitalization() throws {
    for language in KeyboardLanguage.allCases {
      for prefix in ["", "Hola. ", "Hola\n", "Hola. (“"] {
        for (opener, letter, expected) in [("¿", "d", "D"), ("¡", "s", "S")] {
          let (engine, document) = try engine(language, text: prefix)
          engine.page = .numbers
          engine.insertCharacter(opener)
          #expect(engine.shift == .once(automatic: true), "\(language): \(prefix)\(opener)")
          engine.page = .letters
          engine.insertCharacter(letter)
          #expect(document.text == prefix + opener + expected)
          #expect(engine.shift == .off)
        }
      }
    }
  }

  @Test func invertedPunctuationWithinASentenceDoesNotForceUppercase() throws {
    for prefix in ["Dime, ", "Entonces ", "Hola"] {
      for opener in ["¿", "¡"] {
        let (engine, document) = try engine(.bilingual, text: prefix)
        engine.insertCharacter(opener)
        #expect(engine.shift == .off)
        engine.insertCharacter("c")
        #expect(document.text == prefix + opener + "c")
      }
    }
  }

  @Test func hostCapitalizationOptOutStillApplies() throws {
    for capitalization in [InputTraits.Capitalization.none, .words] {
      var traits = InputTraits()
      traits.capitalization = capitalization
      let (engine, document) = try engine(.spanish, traits: traits)
      engine.insertCharacter("¿")
      engine.insertCharacter("d")
      #expect(document.text == "¿d")
    }
  }

  @Test func shiftedAndLockedAccentsKeepTheirCase() throws {
    for locked in [false, true] {
      let (engine, document) = try engine(.spanish, text: "texto ")
      engine.clock = { 100 }
      engine.shiftDown(); engine.shiftUp()
      if locked { engine.shiftDown(); engine.shiftUp() }
      engine.insertCharacter("ñ")
      engine.insertCharacter("á")
      engine.insertCharacter("ü")
      #expect(document.text == (locked ? "texto ÑÁÜ" : "texto Ñáü"))
      #expect(engine.shift == (locked ? .locked : .off))
    }
  }
}
