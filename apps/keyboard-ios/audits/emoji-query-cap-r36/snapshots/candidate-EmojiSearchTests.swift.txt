import Foundation
import Testing
@testable import KeyboardCore

/// The picker's search field: its typed buffer and the results strip.
struct EmojiSearchTests {
  static let suggester = EmojiSuggesterTests.suggester

  private func values(_ query: String) -> [String] {
    Self.suggester.search(query).map(\.value)
  }

  private func history() -> EmojiHistory {
    EmojiHistory(defaults: UserDefaults(suiteName: "EmojiSearchTests-\(UUID().uuidString)")!)
  }

  // MARK: Query buffer

  @Test func queryCollapsesSpacesAndIgnoresLeadingOnes() {
    var query = EmojiSearchQuery()
    query.append(" ")
    #expect(query.text.isEmpty)
    query.append("red")
    query.append(" ")
    query.append(" ")
    query.append("heart")
    #expect(query.text == "red heart")
    query.append("\n")
    query.append("\t")
    #expect(query.text == "red heart ")
  }

  @Test func queryDeletesCharactersAndWords() {
    var query = EmojiSearchQuery("face with tears")
    query.deleteBackward()
    #expect(query.text == "face with tear")
    query.deleteWordsBackward(1)
    #expect(query.text == "face with")
    query.append(" ")
    query.deleteWordsBackward(1)
    #expect(query.text == "face")
    query.deleteWordsBackward(3)
    #expect(query.isEmpty)
    query.deleteBackward()
    #expect(query.isEmpty)
  }

  @Test func queryStopsAtItsMaximumLength() {
    var query = EmojiSearchQuery(String(repeating: "a", count: 100))
    #expect(query.text.count == EmojiSearchQuery.maximumLength)
    let full = query.text
    query.append("more")
    query.append(" ")
    #expect(query.text == full)
    query.deleteBackward()
    query.append("bc")
    #expect(query.text == String(repeating: "a", count: 39) + "b")
    query.deleteWordsBackward(1)
    #expect(query.isEmpty)
    query.append("red heart")
    #expect(query.text == "red heart")
  }

  @Test(arguments: [
    ("a", "\u{301}", "a\u{301}"),
    ("👩", "\u{200D}🚀", "👩‍🚀"),
    ("🇦", "🇧", "🇦🇧"),
    (" ", "\u{301}", " \u{301}"),
    ("👋", "🏽", "👋🏽"),
  ])
  func queryCanExtendItsFinalUnicodeCharacterAtTheLimit(last: String, continuation: String, expected: String) {
    let prefix = String(repeating: "x", count: 39)
    var query = EmojiSearchQuery(prefix + last)
    query.append(continuation)
    #expect(query.text.unicodeScalars.elementsEqual((prefix + expected).unicodeScalars))
    #expect(query.text.count == EmojiSearchQuery.maximumLength)
    query.append("z")
    #expect(query.text.unicodeScalars.elementsEqual((prefix + expected).unicodeScalars))
    query.deleteBackward()
    #expect(query.text == prefix)
  }

  // MARK: Matching

  @Test func completeNamesLead() {
    #expect(values("pizza").first == "🍕")
    #expect(values("red heart").first == "❤️")
    #expect(values("thumbs up").first == "👍")
  }

  @Test(arguments: [
    ("heart", "❤️"), ("smil", "🙂"), ("thumbs", "👍"), ("laugh", "😂"), ("cat", "🐈"),
    ("fire", "🔥"), ("party", "🎉"), ("thumbsup", "👍"), ("pizz", "🍕"),
  ])
  func wordsKeywordsAndPrefixesFind(query: String, expected: String) {
    #expect(values(query).contains(expected), "\(query): \(values(query))")
  }

  @Test func searchStartsFromTheFirstLetter() {
    #expect(!values("p").isEmpty)
    #expect(!values("pi").isEmpty)
    #expect(values("pi").contains("🍕"))
  }

  @Test func searchIgnoresCaseAndAccents() {
    #expect(values("PIZZA") == values("pizza"))
    #expect(values("Éléphant").first == "🐘")
  }

  // Informed regression controls from the rejected multilingual picker. These
  // are established English aliases, including useful alternatives, rather
  // than expectations about how a Spanish query should be interpreted.
  @Test(arguments: [
    ("vicuna", "vicuña", "🦙"),
    ("sao", "são", "🇸🇹"),
    ("pina", "piña", "🥥"),
  ])
  func englishDiacriticAliasesKeepUsefulResults(plain: String, marked: String, expected: String) {
    let queries = Set([plain, plain.uppercased(), marked, marked.uppercased(),
      marked.decomposedStringWithCanonicalMapping])
    for query in queries.sorted() {
      #expect(values(query).prefix(8).contains(expected), "\(query): \(values(query))")
    }
  }

  @Test func moreWordsNarrowTheResults() {
    let heart = values("heart")
    let red = values("red heart")
    #expect(!red.isEmpty)
    #expect(red.count < heart.count)
    #expect(red.first == "❤️")
    #expect(values("red hea").contains("❤️"))
  }

  @Test func wordsMatchInAnyOrderAfterPhrases() {
    #expect(values("heart red").contains("❤️"), "\(values("heart red"))")
    #expect(values("face cat").contains("🐱"), "\(values("face cat"))")
  }

  @Test func unrelatedTextFindsNothing() {
    #expect(values("xqzqx").isEmpty)
    #expect(values("").isEmpty)
    #expect(values("   ").isEmpty)
  }

  @Test func resultsAreUniqueAndBounded() {
    for query in ["s", "a", "face", "heart"] {
      let found = values(query)
      #expect(found.count <= 48)
      #expect(Set(found).count == found.count, "\(query) repeats an emoji")
    }
    #expect(Self.suggester.search("s", limit: 500).count == EmojiSuggester.maximumSearchResults)
  }

  @Test func searchIsFastEnoughForEveryKeystroke() {
    let start = Date()
    for query in ["s", "a", "c", "f", "h", "sm", "smi", "smil", "smile", "heart red"] {
      _ = Self.suggester.search(query)
    }
    // Ten searches, including the widest one-letter ones.
    #expect(Date().timeIntervalSince(start) < 0.5)
  }

  @Test func skinToneVariantsLookUpTheirBase() {
    let thumbs = Self.suggester.emoji(for: "👍")
    #expect(thumbs?.name == "thumbs up")
    let tone = thumbs?.tones?.last
    #expect(tone != nil)
    #expect(Self.suggester.emoji(for: tone!)?.value == "👍")
  }

  // MARK: Results strip

  @Test func emptyQueryShowsRecentsThenPopularEmoji() {
    let history = history()
    history.use("🍕")
    history.use("🐈")
    let results = EmojiSearch.results(for: EmojiSearchQuery(), suggester: Self.suggester, history: history)
    #expect(results.prefix(2).map(\.value) == ["🐈", "🍕"])
    #expect(results.count == 2 + EmojiSearch.popular.count)
    #expect(Set(results.map(\.base.value)).count == results.count)
    let fresh = EmojiSearch.results(for: EmojiSearchQuery(" "), suggester: Self.suggester, history: nil)
    #expect(fresh.first?.value == EmojiSearch.popular.first)
  }

  @Test func resultsUseTheChosenSkinTone() throws {
    let history = history()
    let thumbs = try #require(Self.suggester.emoji(for: "👍"))
    let tone = try #require(thumbs.tones?[2])
    history.setPreferred(tone, for: thumbs)
    let results = EmojiSearch.results(for: EmojiSearchQuery("thumbs up"), suggester: Self.suggester, history: history)
    #expect(results.first?.value == tone)
    #expect(results.first?.name == "thumbs up")
    // A toned recent stays as it was used, without a second untoned copy.
    history.use(tone)
    let recents = EmojiSearch.results(for: EmojiSearchQuery(), suggester: Self.suggester, history: history)
    #expect(recents.first?.value == tone)
    #expect(recents.filter { $0.base.value == "👍" }.count == 1)
  }

  @Test func recentAndPopularEmojiBreakTiesBetweenEqualMatches() {
    let strip = { (query: String, history: EmojiHistory?) in
      EmojiSearch.results(for: EmojiSearchQuery(query), suggester: Self.suggester, history: history).map(\.value)
    }
    #expect(strip("heart", nil).first == "❤️")
    #expect(strip("pizza", nil).first == "🍕", "A better match still leads")
    let history = history()
    history.use("💚")
    #expect(strip("heart", history).first == "💚")
  }

  @Test func resultsTrimTheTrailingSpace() {
    let typed = EmojiSearch.results(for: EmojiSearchQuery("pizza "), suggester: Self.suggester, history: nil)
    #expect(typed.first?.value == "🍕")
  }
}
