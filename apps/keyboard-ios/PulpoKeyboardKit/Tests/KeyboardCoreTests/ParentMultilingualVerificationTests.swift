import Foundation
import Testing
@testable import KeyboardCore

/// Frozen independently by the parent before reviewing the language sweep.
/// These check exact commits and vocabulary, not general Spanish accuracy.
struct ParentMultilingualVerificationTests {
  struct Corpus: Decodable {
    var literalWords: [String]
    var codeSwitchSentences: [String]
  }

  private func corpus() throws -> Corpus {
    let url = Fixtures.languageData.deletingLastPathComponent().appendingPathComponent("audits/parent-language-holdout.json")
    return try JSONDecoder().decode(Corpus.self, from: Data(contentsOf: url))
  }

  @Test(arguments: KeyboardLanguage.allCases)
  func frozenLiteralsSurviveTheirSelectedMode(language: KeyboardLanguage) throws {
    let cases = try corpus().literalWords
    let stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(language.rawValue + ".pkdict"), personalURL: nil)
    let words = language == .english ? Array(cases.dropFirst(15))
      : language == .spanish ? Array(cases.prefix(15)) + Array(cases.dropFirst(20)) : cases
    for word in words {
      var settings = KeyboardSettings()
      settings.language = language
      settings.autoCapitalization = false
      settings.learnWords = false
      let document = MockDocument("prefix ")
      let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
      engine.documentDidChange()
      engine.type(word + " ")
      #expect(document.text == "prefix " + word + " ", "\(language): \(word) → \(document.text)")
    }
    if language != .english {
      for word in cases.prefix(15) {
        #expect(stack.suggester.isValid(word), "\(language) does not recognize \(word)")
        let decomposed = word.decomposedStringWithCanonicalMapping
        #expect(stack.suggester.isValid(decomposed), "\(language) does not recognize decomposed \(word)")
      }
    }
    #expect(stack.personal.totalCount == 0)
  }

  @Test func frozenCodeSwitchMessagesKeepBothLanguages() throws {
    let stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent("en_es.pkdict"), personalURL: nil)
    for message in try corpus().codeSwitchSentences {
      var settings = KeyboardSettings()
      settings.language = .bilingual
      settings.autoCapitalization = false
      settings.learnWords = false
      let document = MockDocument()
      let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
      engine.documentDidChange()
      engine.type(message + " ")
      #expect(document.text == message + " ", "\(message) → \(document.text)")
    }
    #expect(stack.personal.totalCount == 0)
  }
}
