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
