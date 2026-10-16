import Foundation
import Testing
@testable import KeyboardCore

/// Frozen protocol H1–H4, first evaluated after implementation commit f6d1df0e.
/// Core acceptance only: native gestures and visible mode feedback are separate.
@Suite(.serialized)
struct SpanishEntryAcceptanceTests {
  private func stack(_ language: KeyboardLanguage) throws -> LanguageStack {
    try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(language.rawValue + ".pkdict"), personalURL: nil)
  }

  private func engine(_ language: KeyboardLanguage, text: String = "") throws -> (KeyboardEngine, MockDocument) {
    let data = try stack(language)
    let document = MockDocument(text)
    var settings = KeyboardSettings()
    settings.language = language
    let engine = KeyboardEngine(document: document, suggester: data.suggester, glide: data.glide, settings: settings)
    engine.documentDidChange()
    return (engine, document)
  }

  @Test func h1SpanishPunctuationAccentsAndDeliberateCaps() throws {
    for language in [KeyboardLanguage.spanish, .bilingual] {
      let (engine, document) = try engine(language)
      engine.clock = { 100 }
      engine.insertCharacter("¡")
      engine.type("qué vergüenza!")
      engine.insertSpace()
      engine.insertCharacter("¿")
      engine.shiftDown(); engine.shiftUp()
      engine.shiftDown(); engine.shiftUp()
      #expect(engine.shift == .locked)
      engine.type("mañana?")
      #expect(document.text == "¡Qué vergüenza! ¿MAÑANA?")
      engine.insertSpace()
      engine.insertCharacter("ü")
      engine.insertCharacter("ñ")
      engine.shiftDown(); engine.shiftUp()
      engine.insertCharacter("ü")
      engine.insertCharacter("ñ")
      #expect(document.text == "¡Qué vergüenza! ¿MAÑANA? ÜÑüñ")

      // Verify routes exist in the actual layout, rather than a test-only list.
      for (page, base, alternate) in [(KeyboardPage.numbers, "?", "¿"), (.numbers, "!", "¡"), (.letters, "e", "é"), (.letters, "u", "ü"), (.letters, "n", "ñ")] {
        let layout = KeyboardLayout.make(page: page, traits: InputTraits(), needsGlobe: false, digitHints: false)
        let key = try #require(layout.rows.flatMap(\.keys).first { $0.action == .character(base) })
        #expect(key.alternates.contains(alternate))
      }
    }
  }

  @Test func h2InsertingPunctuationAmongHostTextPreservesTheText() throws {
    for language in [KeyboardLanguage.spanish, .bilingual] {
      let (engine, document) = try engine(language, text: "uno dos")
      document.moveCursor(to: 4)
      engine.documentDidChange()
      engine.insertCharacter("¿")
      engine.insertCharacter("¡")
      #expect(document.text == "uno ¿¡dos")
      document.moveCursor(to: document.text.count)
      engine.documentDidChange()
      engine.insertCharacter("?")
      engine.insertCharacter("!")
      #expect(document.text == "uno ¿¡dos?!")
      #expect(document.deletions == 0)
    }
  }

  @Test func h3SwitchesPreserveCommittedTextAndSubsequentEntry() throws {
    let (engine, document) = try engine(.english)
    engine.type("my ")
    #expect(document.text == "My ")
    engine.useLanguageStack(try stack(.bilingual))
    engine.settings.language = .bilingual
    #expect(document.text == "My ")
    engine.type("año ")
    #expect(document.text == "My año ")
    engine.useLanguageStack(try stack(.spanish))
    engine.settings.language = .spanish
    #expect(document.text == "My año ")
    engine.type("is ")
    #expect(document.text == "My año is ")
    engine.useLanguageStack(try stack(.english))
    engine.settings.language = .english
    #expect(document.text == "My año is ")
    engine.type("2026")
    #expect(document.text == "My año is 2026")
  }

  @Test func h4EnglishPunctuationAndShiftRemainUsable() throws {
    let (engine, document) = try engine(.english)
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    engine.shiftDown(); engine.shiftUp()
    engine.type("why?")
    #expect(document.text == "WHY?")
    engine.shiftDown(); engine.shiftUp()
    engine.insertSpace()
    engine.type("wow!")
    #expect(document.text == "WHY? Wow!")
    #expect(engine.shift != .locked)
  }
}
