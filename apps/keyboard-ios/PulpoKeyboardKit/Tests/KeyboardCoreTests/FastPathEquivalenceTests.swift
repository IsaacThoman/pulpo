import Foundation
import Testing
@testable import KeyboardCore

/// Hot-path shortcuts must give exactly the results of the general code they skip.
struct FastPathEquivalenceTests {
  @Test func asciiKeysMatchTheUnicodeNormalization() {
    let lexicon = Fixtures.lexicon
    let printable = (32...126).map { String(UnicodeScalar(UInt8($0))) }
    var samples = printable + ["", "Don't", "I'M", "rock'n'roll", "e-mail", "A1B2", "MiXeD CaSe", "\t\n\r\n"]
    for id in stride(from: 0, to: lexicon.wordCount, by: 97) { samples.append(lexicon.display(id)) }
    for sample in samples {
      #expect(TextNormalizer.key(sample) == TextNormalizer.unicodeKey(sample), "\(sample)")
    }
  }

  @Test func lastTokenMatchesSplitting() {
    let samples = [
      "", " ", "   ", "word", "two words", "trailing  ", "  leading", "tab\tseparated", "line\nbreak\n",
      "mixed \u{00A0}nbsp", "emoji 👍🏽 end", "café olé ", "e\u{301}\u{301} x", "a\r\nb", "\u{2003}em space\u{2003}",
      "http://example.com/path?q=1", "user@example.com", "#hashtag", "snake_case_name ",
    ]
    for sample in samples {
      for end in sample.indices + [sample.endIndex] {
        let text = sample[..<end]
        #expect(KeyboardEngine.lastToken(of: text) == text.split(whereSeparator: \.isWhitespace).last, "\(text)")
      }
    }
  }

  @Test func limitedSuccessorsMatchTheSortedPrefix() {
    let personal = PersonalDictionary(url: nil)
    var generator = SeededGenerator(state: 5)
    for _ in 0..<3_000 {
      let history = ["the", "i", "you", "zorbex"].randomElement(using: &generator)!
      // Few distinct counts, so ties are ordered by word.
      personal.learn("w\(Int.random(in: 0..<400, using: &generator))", after: history)
    }
    for history in ["the", "I", "you", "zorbex", "missing"] {
      let sorted = personal.successors(of: history)
      for limit in [0, 1, 6, 50, 1_000] {
        let fast = personal.successors(of: history, limit: limit)
        #expect(fast.map(\.word) == sorted.prefix(limit).map(\.word))
        #expect(fast.map(\.count) == sorted.prefix(limit).map(\.count))
      }
    }
  }

  @Test func pruningKeepsIndexesEqualToARebuild() throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pk-prune-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("PersonalDictionary.json")
    let personal = PersonalDictionary(url: url)
    var generator = SeededGenerator(state: 77)
    var previous: String?
    // Past both limits, so words and pairs are pruned several times.
    for _ in 0..<(PersonalDictionary.maximumWords * 5) {
      let word = "w" + String(Int.random(in: 0..<(PersonalDictionary.maximumWords * 2), using: &generator), radix: 36)
      personal.learn(word, after: previous)
      previous = Bool.random(using: &generator) ? word : "w" + String(Int.random(in: 0..<300, using: &generator), radix: 36)
    }
    personal.forget(previous!)
    personal.save()
    // A fresh load builds every index from the stored words and pairs.
    let rebuilt = PersonalDictionary(url: url)
    #expect(personal.knownWords == rebuilt.knownWords)
    #expect(personal.totalCount == rebuilt.totalCount)
    for history in (0..<300).map({ "w" + String($0, radix: 36) }) {
      #expect(personal.historyCount(history) == rebuilt.historyCount(history))
      #expect(personal.successors(of: history).map { "\($0.word)\($0.count)" } == rebuilt.successors(of: history).map { "\($0.word)\($0.count)" })
    }
  }

  @Test func boundedPersonalCostsAgreeWithinTheBound() {
    let corrector = SpellCorrector(lexicon: Fixtures.lexicon)
    let candidates = ["hello", "help", "yellow", "hell", "hollow", "jello", "he", "helloo", "ehllo", "world", "h", ""]
    for typed in ["hello", "hlelo", "helo", "hrllo", "hi", "jello", "xylophone"] {
      let word = TypedWord(text: typed)
      let bound = SpellCorrector.bound(forLength: typed.count)
      let bounded = corrector.costEvaluator(for: word, bound: bound)
      for candidate in candidates {
        let exact = corrector.cost(of: word, against: candidate)
        let fast = bounded(candidate)
        if exact <= bound {
          #expect(fast == exact, "\(typed) \(candidate)")
        } else {
          #expect(fast > bound, "\(typed) \(candidate)")
        }
      }
    }
  }
}
