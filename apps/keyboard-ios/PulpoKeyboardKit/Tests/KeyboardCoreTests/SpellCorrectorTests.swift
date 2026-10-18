import Foundation
import Testing
@testable import KeyboardCore

struct SpellCorrectorTests {
  @Test(arguments: ["the", "now", "you", "can", "get", "out", "not", "and", "for", "but", "had", "she", "him", "her", "any", "all", "say", "see", "one", "our", "who", "how", "why", "two", "new", "old", "way", "day", "use", "man"])
  func threeLetterWordsAdmitAFirstAdjacentKeySlip(expected: String) {
    let corrector = SpellCorrector(lexicon: Fixtures.lexicon)
    let target = Array(expected.utf8)
    let center = LetterGeometry.qwerty.center(target[0])!
    for neighbor in UInt8(ascii: "a")...UInt8(ascii: "z") {
      guard let point = LetterGeometry.qwerty.center(neighbor),
            abs(point.distanceSquared(to: center) - 1) < 0.000_001 else { continue }
      let word = TypedWord(text: String(decoding: [neighbor] + target.dropFirst(), as: UTF8.self))
      let cost = corrector.cost(of: word, against: expected)
      #expect(cost <= SpellCorrector.bound(forLength: target.count))
      let matches = corrector.search(word).words.filter {
        TextNormalizer.key(Fixtures.lexicon.display($0.id)) == expected
      }
      #expect(!matches.isEmpty, "\(word.text) should retrieve \(expected)")
      #expect(matches.allSatisfy { abs($0.cost - cost) < 0.000_001 })
    }
  }

  @Test(arguments: [("yhe", "the"), ("jow", "now")])
  func firstKeySlipsCanReachAutocorrection(input: String, expected: String) {
    let (_, suggester, _) = Fixtures.stack()
    #expect(suggester.suggestions(for: TypedWord(text: input), context: .unknown, autocorrect: true).autocorrection == expected)
  }

  @Test(arguments: ["on", "no", "at", "to", "of", "in", "is", "it", "am", "an", "as", "be", "by", "do", "go", "he", "if", "me", "my", "or", "so", "up", "us", "we", "qa", "ty", "mc", "mi", "fr", "ngl", "af", "ui", "vr", "cpu", "gpu", "pdf", "ssl", "tls", "dns", "tcp", "udp", "jwt", "api", "url", "css", "git", "vim", "npm", "sql", "lol", "brb", "btw", "tbh", "fyi", "idk", "omg", "wtf", "irl"])
  func firstKeySearchKeepsExistingLiteralProtection(input: String) {
    let (model, suggester, _) = Fixtures.stack()
    for context in [LanguageContext.unknown, model.context(previousWord: "and", sentenceStart: false)] {
      #expect(suggester.suggestions(for: TypedWord(text: input), context: context, autocorrect: true).autocorrection == nil)
    }
  }
}
