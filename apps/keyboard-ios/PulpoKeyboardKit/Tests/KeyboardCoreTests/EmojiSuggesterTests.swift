import Foundation
import Testing
@testable import KeyboardCore

struct EmojiSuggesterTests {
  static let catalog = try! EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json"))
  static let suggester = EmojiSuggester(catalog: catalog)

  // Frozen before inspecting matcher results: names, natural synonyms, prefixes,
  // compound names, ambiguity, Unicode normalization and unrelated input.
  @Test(arguments: [
    ("pizza", "🍕"), ("fire", "🔥"), ("thumbs up", "👍"), ("red heart", "❤️"),
    ("face with tears of joy", "😂"), ("black cat", "🐈‍⬛"), ("ice cream", "🍨"),
    ("woman technologist", "👩‍💻"), ("United States", "🇺🇸"), ("Åland Islands", "🇦🇽"),
    ("ÉLÉPHANT", "🐘"), ("Côte d’Ivoire", "🇨🇮"),
  ])
  func exactNamesLead(query: String, value: String) {
    #expect(Self.suggester.suggestions(for: query).first?.value == value)
  }

  @Test func everyCanonicalNameRemainsSearchableIncludingMeaningfulPunctuation() {
    for emoji in Self.catalog.categories.flatMap(\.emoji) where emoji.name.count >= 3 {
      #expect(Self.suggester.suggestions(for: emoji.name).first?.value == emoji.value, "\(emoji.name)")
    }
    #expect(Self.suggester.suggestions(for: "keycap: #").first?.value == "#️⃣")
    #expect(Self.suggester.suggestions(for: "keycap: *").first?.value == "*️⃣")
  }

  @Test(arguments: [
    ("happy", ["😀", "😃", "😄", "😁", "😊", "😆"]),
    ("laugh", ["😀", "😄", "😆", "😂", "🤣"]),
    ("lol", ["😄", "😆", "😂", "🤣"]),
    ("sad", ["😔", "😪", "😕", "😟", "🙁", "☹️", "😢", "😭"]),
    ("love", ["❤️", "🥰", "😍", "😘", "💌"]),
    ("thumbsup", ["👍"]), ("party", ["🎉", "🥳", "🎊"]),
    ("celebrate", ["🥳", "🎉", "🥂", "🎈", "🎊"]), ("thanks", ["🙏", "🫂"]),
    ("coffee", ["☕"]), ("dog", ["🐕", "🐶"]), ("heart", ["❤️", "💖", "💗", "💓", "💘"]),
    ("cool", ["😎", "🆒"]), ("hug", ["🤗", "🫂", "👐"]),
  ])
  func naturalKeywordsOfferRelevantChoices(query: String, expected: [String]) {
    let matches = Self.suggester.suggestions(for: query).map(\.value)
    #expect(matches.contains { expected.contains($0) }, "\(query): \(matches)")
  }

  @Test(arguments: [
    ("smil", ["😀", "😃", "😄", "😊", "🙂", "🥰"]),
    ("thumbs u", ["👍"]), ("partying f", ["🥳"]), ("red hea", ["❤️"]),
  ])
  func supportsNameAndKeywordPrefixes(query: String, expected: [String]) {
    let matches = Self.suggester.suggestions(for: query).map(\.value)
    #expect(matches.contains { expected.contains($0) }, "\(query): \(matches)")
  }

  @Test(arguments: [
    "", "a", "an", "the", "xqzq", "metadata", "firewall", "my_variable",
    "https://fire.com", "alice@example.com", "Alice", "xheart", "coffee.js", "happy()=true",
  ])
  func avoidsUnrelatedSubstringsAndTechnicalInput(query: String) {
    #expect(Self.suggester.suggestions(for: query).isEmpty)
  }

  @Test(arguments: ["joy", "cry", "heart", "star", "face"])
  func ambiguityIsBoundedAndDeterministic(query: String) {
    let first = Self.suggester.suggestions(for: query, limit: .max)
    #expect(!first.isEmpty)
    #expect(first.count <= EmojiSuggester.maximumSuggestions)
    #expect(Set(first.map(\.value)).count == first.count)
    #expect(Self.suggester.suggestions(for: query, limit: .max) == first)
    #expect(Self.suggester.suggestions(for: query, limit: 1) == Array(first.prefix(1)))
    #expect(Self.suggester.suggestions(for: query, limit: 0).isEmpty)
    #expect(Self.suggester.suggestions(for: query, limit: -1).isEmpty)
  }

  @Test func preservesOldCatalogsAndSkinTonePreferences() throws {
    let legacy = Data(#"{"version":"1","categories":[{"id":"people","name":"People","emoji":[{"e":"👍","n":"thumbs up","v":0.6,"t":["👍🏻","👍🏼","👍🏽","👍🏾","👍🏿"]}]}]}"#.utf8)
    let catalog = try JSONDecoder().decode(EmojiCatalog.self, from: legacy)
    let suggester = EmojiSuggester(catalog: catalog)
    let base = try #require(suggester.suggestions(for: "thumbsup").first)
    #expect(base.keywords == nil)
    #expect(base.tones?.count == 5)
    let suite = "EmojiSuggesterTests-\(UUID())"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    let history = EmojiHistory(defaults: defaults)
    history.setPreferred("👍🏽", for: base)
    #expect(history.preferred(for: base) == "👍🏽")
    #expect(suggester.suggestions(for: "thumbs up").first?.value == "👍")
    #expect(EmojiSuggester(catalog: catalog.filtered { _ in false }).suggestions(for: "thumbsup").isEmpty)
  }

  @Test func lookupRemainsFastAcrossRepeatedKeystrokes() {
    let queries = ["hap", "happ", "happy", "laugh", "thumbsup", "party", "coffee", "red hea", "metadata", "xqzq"]
    let clock = ContinuousClock()
    let duration = clock.measure {
      for _ in 0..<1_000 {
        for query in queries { _ = Self.suggester.suggestions(for: query) }
      }
    }
    // A generous regression ceiling for debug and loaded CI machines. The index
    // must avoid repeatedly scanning and normalizing the full catalog.
    #expect(duration < .seconds(3), "10,000 lookups took \(duration)")
  }
}
