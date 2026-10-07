import Foundation
import Testing
@testable import KeyboardCore

struct LexiconTests {
  let lexicon = Fixtures.lexicon

  @Test func loadsTheCompiledDictionary() {
    #expect(lexicon.wordCount > 150_000)
    #expect(lexicon.nodeCount > 100_000)
  }

  @Test func looksUpWordsByKeyAndDisplay() throws {
    let hello = try #require(lexicon.id(of: "hello"))
    #expect(lexicon.display(hello) == "hello")
    #expect(lexicon.words(forKey: "dont").map(lexicon.display).contains("don't"))
    #expect(lexicon.id(of: "iPhone").map(lexicon.display) == "iPhone")
    #expect(lexicon.id(of: "zzzzqx") == nil)
  }

  @Test func ranksCommonWordsAboveRareOnes() throws {
    let the = try #require(lexicon.id(of: "the"))
    let rare = try #require(lexicon.id(of: "abaft"))
    #expect(lexicon.unigramLogProbability(the) > -4)
    #expect(lexicon.unigramLogProbability(the) > lexicon.unigramLogProbability(rare) + 8)
  }

  @Test func storesNextWordStatistics() throws {
    let thank = try #require(lexicon.id(of: "thank"))
    let you = try #require(lexicon.id(of: "you"))
    let banana = try #require(lexicon.id(of: "banana"))
    #expect(lexicon.logProbability(of: you, after: thank) > -2)
    #expect(lexicon.logProbability(of: you, after: thank) > lexicon.logProbability(of: banana, after: thank) + 6)
  }

  @Test func keepsOnlySafeShortcuts() {
    #expect(lexicon.shortcuts["im"] == "I'm")
    #expect(lexicon.shortcuts["dont"] == "don't")
    // AOSP maps "hid" to "his"; both are words, so that swap is dropped.
    #expect(lexicon.shortcuts["hid"] == nil)
  }

  @Test func normalizesKeys() {
    #expect(TextNormalizer.key("Don’t") == "dont")
    #expect(TextNormalizer.key("Café") == "cafe")
  }
}
