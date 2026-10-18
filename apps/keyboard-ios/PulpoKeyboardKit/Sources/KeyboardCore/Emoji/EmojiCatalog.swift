import Foundation

public struct Emoji: Decodable, Equatable, Hashable, Sendable {
  public let value: String
  public let name: String
  /// Unicode emoji version that introduced it.
  public let version: Double
  /// Light through dark skin tone variants, when the emoji has them.
  public let tones: [String]?
  /// English Unicode CLDR annotations, when present in the catalog.
  public let keywords: [String]?

  enum CodingKeys: String, CodingKey {
    case value = "e", name = "n", version = "v", tones = "t", keywords = "k"
  }

  public init(value: String, name: String, version: Double, tones: [String]?, keywords: [String]? = nil) {
    self.value = value
    self.name = name
    self.version = version
    self.tones = tones
    self.keywords = keywords
  }
}

public struct EmojiCategory: Decodable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let emoji: [Emoji]
}

public struct EmojiCatalog: Decodable, Sendable {
  public let version: String
  public let categories: [EmojiCategory]

  public static func load(url: URL) throws -> EmojiCatalog {
    try JSONDecoder().decode(EmojiCatalog.self, from: Data(contentsOf: url))
  }

  /// Keeps only emoji the current OS can draw as a single glyph.
  public func filtered(_ isSupported: (Emoji) -> Bool) -> EmojiCatalog {
    EmojiCatalog(version: version, categories: categories.map { category in
      EmojiCategory(id: category.id, name: category.name, emoji: category.emoji.filter(isSupported))
    })
  }

  init(version: String, categories: [EmojiCategory]) {
    self.version = version
    self.categories = categories
  }
}

/// An immutable, bounded English name and keyword index for the suggestion bar.
/// Build once after filtering the catalog for glyph support, then share it across
/// keystrokes. It returns base emoji so the caller can apply the person's tone.
public struct EmojiSuggester: Sendable {
  public static let maximumSuggestions = 12
  private struct Match: Sendable {
    let id: Int
    let rank: Int
  }
  private struct Term: Sendable {
    let key: String
    let matches: [Match]
  }
  private let emoji: [Emoji]
  private let exactNames: [String: Int]
  /// Every value, including skin-tone variants, to its base emoji.
  private let byValue: [String: Int]
  private let index: [Term]
  private static let locale = Locale(identifier: "en_US_POSIX")
  private static let minimumLength = 3
  private static let maximumLength = 80
  private static let ignoredWords: Set<String> = ["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]

  public init(catalog: EmojiCatalog) {
    let emoji = catalog.categories.flatMap(\.emoji)
    self.emoji = emoji
    exactNames = Dictionary(emoji.enumerated().map { (Self.foldedName($0.element.name), $0.offset) },
                            uniquingKeysWith: min)
    var byValue: [String: Int] = [:]
    for (id, entry) in emoji.enumerated() {
      byValue[entry.value] = byValue[entry.value] ?? id
      for tone in entry.tones ?? [] { byValue[tone] = byValue[tone] ?? id }
    }
    self.byValue = byValue
    var matches: [String: [Int: Int]] = [:]

    func add(_ term: String, id: Int, rank: Int) {
      guard term.count >= Self.minimumLength, term.count <= Self.maximumLength,
            !Self.ignoredWords.contains(term) else { return }
      matches[term, default: [:]][id] = min(matches[term]?[id] ?? Int.max, rank)
    }

    for (id, entry) in emoji.enumerated() {
      let name = Self.normalized(entry.name)
      add(name, id: id, rank: 0)
      let words = name.split(separator: " ").map(String.init)
      if words.count > 1 {
        // Compact names support ordinary shortcodes such as "thumbsup" without
        // a separate, manually maintained list of permitted query words.
        add(words.joined(), id: id, rank: 10)
        for start in words.indices {
          add(words[start], id: id, rank: 40 + words.count)
          if start > 0 { add(words[start...].joined(separator: " "), id: id, rank: 20 + start) }
        }
      }
      for keyword in entry.keywords ?? [] {
        let term = Self.normalized(keyword)
        add(term, id: id, rank: 80)
        if term.contains(" ") { add(term.replacingOccurrences(of: " ", with: ""), id: id, rank: 90) }
      }
    }
    // Keep complete terms once, with bounded postings. Prefixes are located by
    // binary search instead of retaining a separate array for every keystroke.
    index = matches.keys.sorted().map { key in
      let candidates = matches[key]!
      let best = candidates.keys.sorted {
        let left = candidates[$0]!, right = candidates[$1]!
        return left != right ? left < right : $0 < $1
      }.prefix(Self.maximumSuggestions).map { Match(id: $0, rank: candidates[$0]!) }
      return Term(key: key, matches: best)
    }
  }

  /// Matches complete names, individual name words, CLDR keywords and prefixes.
  /// At least three letters are required; unrelated substrings and spelling
  /// mistakes are never expanded. Selection remains an explicit user action.
  /// Without `prefixes`, only complete terms match.
  public func suggestions(for query: String, limit: Int = 3, prefixes: Bool = true) -> [Emoji] {
    guard limit > 0, query.count <= Self.maximumLength else { return [] }
    let key = Self.normalized(query)
    guard key.count >= Self.minimumLength, !Self.ignoredWords.contains(key) else { return [] }
    let exact = exactNames[Self.foldedName(query)]
    // Known names can include commas, digits or periods ("Mrs. Claus",
    // "family: woman, woman, boy"). Other technical input stays excluded.
    // Preserve punctuation here so "keycap: #" and "keycap: *" stay distinct.
    guard Self.isSearchText(query) else { return exact.map { [emoji[$0]] } ?? [] }
    let count = min(limit, Self.maximumSuggestions)
    var lower = 0, upper = index.count
    while lower < upper {
      let middle = lower + (upper - lower) / 2
      if index[middle].key < key { lower = middle + 1 } else { upper = middle }
    }
    var best: [Match] = []
    func add(_ candidate: Match) {
      if let existing = best.firstIndex(where: { $0.id == candidate.id }) {
        guard best[existing].rank > candidate.rank else { return }
        best.remove(at: existing)
      }
      let insertion = best.firstIndex {
        $0.rank > candidate.rank || ($0.rank == candidate.rank && $0.id > candidate.id)
      } ?? best.count
      guard insertion < count else { return }
      best.insert(candidate, at: insertion)
      if best.count > count { best.removeLast() }
    }
    if let exact { add(Match(id: exact, rank: -1)) }
    for position in lower..<index.count {
      let term = index[position]
      guard term.key.hasPrefix(key), prefixes || term.key == key else { break }
      let penalty = term.key == key ? 0 : 200
      for match in term.matches { add(Match(id: match.id, rank: match.rank + penalty)) }
      if best.count == count, best.last!.rank < 200 { break }
    }
    return best.map { emoji[$0.id] }
  }

  /// The base emoji for `value`, which may also be one of its skin-tone variants.
  public func emoji(for value: String) -> Emoji? {
    byValue[value].map { emoji[$0] }
  }

  public static let maximumSearchResults = 60

  /// Matches for the emoji picker's search field. Unlike `suggestions`, any
  /// query searches from its first letter, because the person asked to search:
  /// names, name words, compact names, CLDR keywords and their prefixes. A
  /// phrase continues names in order ("red hea"). When too few names continue
  /// the whole phrase, emoji with a term starting every word are added after
  /// them ("heart red"). Complete terms rank before prefixes. `preferred`
  /// gives recent or popular emoji a small lead (1-2) over equally good matches.
  public func search(_ query: String, limit: Int = 48, preferring preferred: [String: Int] = [:]) -> [Emoji] {
    let count = min(limit, Self.maximumSearchResults)
    guard count > 0, query.count <= Self.maximumLength else { return [] }
    let key = Self.normalized(query)
    guard !key.isEmpty else { return [] }
    var ranks: [Int: Int] = [:]
    if let exact = exactNames[Self.foldedName(query)] { ranks[exact] = -1 }
    if Self.isSearchText(query) {
      collect(prefix: key, into: &ranks)
      let words = key.split(separator: " ").map(String.init).filter { !Self.ignoredWords.contains($0) }
      if ranks.count < count, words.count > 1 {
        // Postings are bounded per term, so candidates come from any word and
        // are then checked against every word of their own name and keywords.
        let found = words.map { word -> [Int: Int] in
          var matches: [Int: Int] = [:]
          collect(prefix: word, into: &matches)
          return matches
        }
        let candidates = Set(found.flatMap(\.keys)).subtracting(ranks.keys).sorted().prefix(Self.maximumWordCandidates)
        for id in candidates {
          let terms = Self.searchWords(of: emoji[id])
          guard words.allSatisfy({ word in terms.contains { $0.hasPrefix(word) } }) else { continue }
          ranks[id] = 300 + found.reduce(0) { $0 + ($1[id] ?? 250) }
        }
      }
    }
    if !preferred.isEmpty {
      for (id, rank) in ranks { if let lead = preferred[emoji[id].value] { ranks[id] = rank - min(max(lead, 0), 2) } }
    }
    return ranks.sorted { $0.value != $1.value ? $0.value < $1.value : $0.key < $1.key }
      .prefix(count).map { emoji[$0.key] }
  }

  private static let maximumWordCandidates = 800

  /// The words of an emoji's name and keywords, as the index normalizes them.
  private static func searchWords(of entry: Emoji) -> Set<String> {
    var words: Set<String> = []
    for text in [entry.name] + (entry.keywords ?? []) {
      for word in normalized(text).split(separator: " ") { words.insert(String(word)) }
    }
    return words
  }

  /// Every emoji with a term starting with `key`, at its best rank.
  private func collect(prefix key: String, into ranks: inout [Int: Int]) {
    var lower = 0, upper = index.count
    while lower < upper {
      let middle = lower + (upper - lower) / 2
      if index[middle].key < key { lower = middle + 1 } else { upper = middle }
    }
    for position in lower..<index.count {
      let term = index[position]
      guard term.key.hasPrefix(key) else { break }
      let penalty = term.key == key ? 0 : 200
      for match in term.matches where match.rank + penalty < ranks[match.id] ?? .max {
        ranks[match.id] = match.rank + penalty
      }
    }
  }

  private static func foldedName(_ text: String) -> String {
    text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale)
      .split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  private static func normalized(_ text: String) -> String {
    let folded = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale)
    // Punctuation separates words rather than merging "ice-cream" into a new
    // spelling. Apostrophes are ignored, matching Unicode's country names.
    let letters = folded.unicodeScalars.map { scalar -> String in
      if CharacterSet.alphanumerics.contains(scalar) { return String(scalar) }
      if scalar == "'" || scalar == "\u{2019}" { return "" }
      return " "
    }.joined()
    return letters.split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  private static func isSearchText(_ text: String) -> Bool {
    text.unicodeScalars.allSatisfy { scalar in
      CharacterSet.letters.contains(scalar) || CharacterSet.nonBaseCharacters.contains(scalar)
        || CharacterSet.whitespaces.contains(scalar) || "'-’:&()“”".unicodeScalars.contains(scalar)
    }
  }
}

/// Recently used emoji and each emoji's chosen skin tone.
public final class EmojiHistory {
  public static let limit = 32
  private let defaults: UserDefaults
  public private(set) var recents: [String]
  private var tones: [String: String]

  public init(defaults: UserDefaults) {
    self.defaults = defaults
    recents = defaults.stringArray(forKey: "emojiRecents") ?? []
    tones = defaults.dictionary(forKey: "emojiTones") as? [String: String] ?? [:]
  }

  public func use(_ emoji: String) {
    recents.removeAll { $0 == emoji }
    recents.insert(emoji, at: 0)
    if recents.count > Self.limit { recents.removeLast(recents.count - Self.limit) }
    defaults.set(recents, forKey: "emojiRecents")
  }

  /// The variant to insert for `base`, remembering the last tone picked.
  public func preferred(for base: Emoji) -> String {
    guard base.tones != nil, let tone = tones[base.value] else { return base.value }
    return tone
  }

  public func setPreferred(_ variant: String, for base: Emoji) {
    tones[base.value] = variant == base.value ? nil : variant
    defaults.set(tones, forKey: "emojiTones")
  }
}
