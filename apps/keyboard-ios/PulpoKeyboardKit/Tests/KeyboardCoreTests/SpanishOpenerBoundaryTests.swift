import Foundation
import Testing
@testable import KeyboardCore

/// Reviewer integration cases, added after the blind sweep. These characterize
/// shared punctuation policy and are not additional held-out acceptance.
@Suite(.serialized)
struct SpanishOpenerBoundaryTests {
  private func engine(_ language: KeyboardLanguage, text: String = "") throws -> (KeyboardEngine, MockDocument) {
    let stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(language.rawValue + ".pkdict"), personalURL: nil)
    var settings = KeyboardSettings()
    settings.language = language
    let document = MockDocument(text)
    let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: nil, settings: settings)
    engine.documentDidChange()
    engine.clock = { 100 }
    return (engine, document)
  }

  @Test(arguments: KeyboardLanguage.allCases, ["¿", "¡"])
  func manualShiftOffAfterAnOpenerAllowsDeliberateLowercase(language: KeyboardLanguage, opener: String) throws {
    let (engine, document) = try engine(language)
    engine.insertCharacter(opener)
    #expect(engine.shift == .once(automatic: true))
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .off)
    engine.insertCharacter("a")
    #expect(document.text == opener + "a")
    #expect(engine.shift == .off)
  }

  @Test(arguments: KeyboardLanguage.allCases, ["¿", "¡", "“", "("])
  func manualOffBeforeAnOpenerFollowsExistingQuoteAndBracketPolicy(language: KeyboardLanguage, opener: String) throws {
    let (engine, document) = try engine(language)
    #expect(engine.shift == .once(automatic: true))
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .off)
    engine.insertCharacter(opener)
    // Existing quotes/brackets rederive automatic Shift after punctuation.
    // The fix extends that policy to ¿/¡; this is characterization, not a new
    // policy that manual Shift-off persists until the next letter.
    #expect(engine.shift == .once(automatic: true))
    engine.insertCharacter("a")
    #expect(document.text == opener + "A")
  }

  @Test(arguments: KeyboardLanguage.allCases, [
    ("Hola.” ", true), ("Hola.”\n", true), ("Hola\n", true),
    ("Hola... ", true), ("Hola...” ", true),
    ("Hola… ", false), ("Hola…” ", false), ("Dime, ", false),
  ])
  func existingSentenceBoundariesRemainTheOracle(language: KeyboardLanguage, boundary: (String, Bool)) throws {
    for opener in ["¿", "¡"] {
      let (engine, document) = try engine(language, text: boundary.0)
      engine.insertCharacter(opener)
      #expect(engine.shift == (boundary.1 ? .once(automatic: true) : .off))
      engine.insertCharacter("a")
      #expect(document.text == boundary.0 + opener + (boundary.1 ? "A" : "a"))
    }
    // Unicode ellipsis is not currently a sentence ender. The opener change
    // must neither hide that limitation nor silently add a new ellipsis rule.
  }

  @Test(arguments: ["¿", "¡"], [
    ("", true), ("Please, ", false), ("Done.” ", true),
    ("Done... ", true), ("Done… ", false), ("Done\n", true),
  ])
  func transcriptCasingSharesTheBoundaryRuleAndJoinsInsideOpeners(opener: String, boundary: (String, Bool)) {
    // English supplies a known lowercase spelling of Hello, so a mid-sentence
    // transcript exercises the real lowercase decision rather than a name guard.
    let (engine, document) = Fixtures.engine(boundary.0 + opener)
    engine.insertTranscript("Hello again")
    let transcript = boundary.1 ? "Hello again" : "hello again"
    // The separate inserted-text spacing refinement removes only the unwanted
    // post-opener space; the shared-helper casing expectations stay the same.
    #expect(document.text == boundary.0 + opener + transcript)
  }
}
