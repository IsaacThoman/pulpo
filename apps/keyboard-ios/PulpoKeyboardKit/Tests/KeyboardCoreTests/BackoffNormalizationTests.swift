import Foundation
import Testing
@testable import KeyboardCore

/// Bounded bigram and trigram tables keep only their strongest continuations.
/// Everything they omit shares the omitted probability mass instead of falling
/// to a backoff weight meant only for words never seen after the history.
struct BackoffNormalizationTests {
  let lexicon = Fixtures.lexicon
  let model = LanguageModel(lexicon: Fixtures.lexicon, personal: PersonalDictionary(url: nil))

  func logP(_ word: String, _ context: LanguageContext) -> Double {
    model.logProbability(of: word, id: lexicon.id(of: word), in: context)
  }

  @Test(arguments: [("of", "the", "players"), ("against", "the", "men"), ("used", "to", "walked")])
  func frequentWordsMissingFromATrigramTableKeepTheirPrior(preceding: String, previous: String, word: String) throws {
    let context = model.context(previousWord: previous, sentenceStart: false, precedingWord: preceding)
    let unigram = lexicon.unigramLogProbability(try #require(lexicon.id(of: word)))
    #expect(logP(word, context) > unigram - 3, "\(preceding) \(previous) \(word)")
  }

  @Test func sentenceInitialMaybeIsNotBuriedBelowItsPrior() throws {
    let start = model.context(previousWord: nil, sentenceStart: true)
    let unigram = lexicon.unigramLogProbability(try #require(lexicon.id(of: "maybe")))
    #expect(logP("maybe", start) > unigram - 2)
  }

  @Test(arguments: ["the", "I", "think", "you"])
  func omittedContinuationsNeverOutrankListedOnes(history: String) throws {
    let id = try #require(lexicon.id(of: history))
    let listed = lexicon.successors(of: id).map { lexicon.successor(at: $0) }
    let weakest = try #require(listed.map(\.logProbability).min())
    let listedIDs = Set(listed.map(\.id))
    for word in ["and", "the", "of", "zebra", "players", "a"] {
      guard let candidate = lexicon.id(of: word), !listedIDs.contains(candidate) else { continue }
      #expect(lexicon.logProbability(of: candidate, after: id) <= weakest + 1e-9, "\(history) \(word)")
    }
  }

  @Test func listedContinuationsAreUnchanged() throws {
    let id = try #require(lexicon.id(of: "of"))
    for position in lexicon.successors(of: id) {
      let entry = lexicon.successor(at: position)
      #expect(lexicon.logProbability(of: entry.id, after: id) == entry.logProbability)
    }
  }
}
