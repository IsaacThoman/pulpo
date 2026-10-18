import Foundation
import Testing
@testable import KeyboardCore

/// Integration regressions against the real dictionaries, separate from the
/// frozen English completion benchmark. These cases are not a new holdout.
struct MultilingualAccentCompletionTests {
  private static let lexicons = Dictionary(uniqueKeysWithValues: ["es", "en_es"].map {
    ($0, try! Lexicon(url: Fixtures.languageData.appendingPathComponent($0 + ".pkdict")))
  })

  private func suggester(_ mode: String) -> Suggester {
    let lexicon = Self.lexicons[mode]!
    return Suggester(model: LanguageModel(lexicon: lexicon, personal: PersonalDictionary(url: nil)),
                     corrector: SpellCorrector(lexicon: lexicon))
  }

  private func preserves(_ candidate: String, prefix: String) -> Bool {
    candidate.precomposedStringWithCanonicalMapping.lowercased()
      .hasPrefix(prefix.precomposedStringWithCanonicalMapping.lowercased())
  }

  @Test(arguments: ["es", "en_es"], ["mañ", "man\u{303}", "pingü", "pingu\u{308}", "café", "cafe\u{301}", "está", "esta\u{301}"])
  func retrievedAccentedContinuationsLeadTheExplicitChoices(mode: String, prefix: String) throws {
    let suggester = suggester(mode)
    let word = TypedWord(text: prefix)
    let retrieved = suggester.candidates(for: word, context: .unknown)
    // Require an actual competition in retrieval, rather than expecting the
    // ranker to invent an accented word absent from its bounded candidate pool.
    let preserving = try #require(retrieved.first { $0.text != prefix && preserves($0.text, prefix: prefix) })
    #expect(retrieved.contains { !preserves($0.text, prefix: prefix) })
    let set = suggester.suggestions(for: word, context: .unknown, autocorrect: false)
    let literal = try #require(set.slots.first { $0.kind == .literal })
    #expect(Array(literal.text.utf8) == Array(prefix.utf8))
    let choices = set.slots.filter { $0.kind != .literal }
    #expect(choices.first?.text == preserving.text)
    #expect(choices.allSatisfy { choice in retrieved.contains { $0.text == choice.text } })
    if let firstNonpreserving = choices.firstIndex(where: { !preserves($0.text, prefix: prefix) }) {
      #expect(choices.dropFirst(firstNonpreserving).allSatisfy { !preserves($0.text, prefix: prefix) })
    }
    #expect(set.slots.count <= 3)
    #expect(set.autocorrection == nil)
  }

  @Test(arguments: ["es", "en_es"], ["mañ", "pingü", "café"])
  func selectingARealDictionaryContinuationPreservesItsSpelling(mode: String, prefix: String) throws {
    for written in [prefix, prefix.decomposedStringWithCanonicalMapping] {
      let document = MockDocument(written)
      let engine = KeyboardEngine(document: document, suggester: suggester(mode), glide: nil)
      engine.documentDidChange()
      let choice = try #require(engine.suggestions.slots.first {
        $0.kind != .literal && !$0.isAutocorrection && $0.text != written && preserves($0.text, prefix: written)
      })
      engine.select(choice)
      #expect(document.text == choice.text + " ")
      #expect(Array(document.text.utf8) == Array((choice.text + " ").utf8))
    }
  }

  @Test(arguments: ["es", "en_es"], ["mañ", "niñ", "pingü", "vergü", "agü", "canció", "está", "café", "rés", "holaa"])
  func automaticCorrectionsMatchThePrePartitionImplementation(mode: String, prefix: String) {
    // Public-API reference captured from pre-partition Suggester (286763eb)
    // against these same es/en_es assets. Preserve even surprising existing
    // corrections: this display-only patch must not make automatic edits.
    let reference: [String: [String: String]] = [
      "es": ["mañ": "mano", "niñ": "niño", "agü": "agua", "canció": "canción", "holaa": "hola"],
      "en_es": ["niñ": "non", "vergü": "verge", "agü": "agua", "canció": "canción", "holaa": "hola"],
    ]
    let suggester = suggester(mode)
    for written in [prefix, prefix.decomposedStringWithCanonicalMapping] {
      let set = suggester.suggestions(for: TypedWord(text: written), context: .unknown, autocorrect: true)
      #expect(set.autocorrection == reference[mode]?[prefix])
      #expect(set.slots.first(where: \.isAutocorrection)?.text == set.autocorrection)
    }
  }
}
