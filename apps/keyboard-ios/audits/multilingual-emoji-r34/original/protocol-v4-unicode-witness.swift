import Foundation

// Independent contract-v4 witness. Links baseline sources only; no candidate.
@main struct Witness {
  static let locale = Locale(identifier: "en_US_POSIX")
  static let ignored: Set<String> = ["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]

  static func legacy(_ text: String) -> String {
    text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale)
      .unicodeScalars.map { s in
        CharacterSet.alphanumerics.contains(s) ? String(s) : ((s == "'" || s == "\u{2019}") ? "" : " ")
      }.joined().split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  static func canonical(_ text: String) -> [String] {
    var normalized = ""
    var afterVowel = false
    for s in text.lowercased(with: locale).decomposedStringWithCanonicalMapping.unicodeScalars {
      // This is the inherited vowel-mark rule, before letter admission.
      if CharacterSet.nonBaseCharacters.contains(s) {
        if !afterVowel { normalized.unicodeScalars.append(s) }
      } else {
        afterVowel = "aeiou".unicodeScalars.contains(s)
        normalized.unicodeScalars.append(s)
      }
    }
    var words: [String] = []
    var token = ""
    for s in normalized.precomposedStringWithCanonicalMapping.unicodeScalars {
      if CharacterSet.letters.contains(s) || (!token.isEmpty && CharacterSet.nonBaseCharacters.contains(s)) {
        token.unicodeScalars.append(s)
      } else if !token.isEmpty {
        words.append(token); token = ""
      }
    }
    if !token.isEmpty { words.append(token) }
    return Array(Set(words)).sorted()
  }

  static func project(_ text: String) -> String {
    let folded = text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale)
      .decomposedStringWithCanonicalMapping
    // Exact v4 predicate; no Swift Unicode category / isLetter filter.
    return String(String.UnicodeScalarView(folded.unicodeScalars.filter { CharacterSet.letters.contains($0) }))
  }

  static func envelope(_ catalog: EmojiCatalog, _ tokens: [String]) -> [String] {
    let projected = tokens.map(project)
    let required = Set(projected).subtracting(ignored)
    return catalog.categories.flatMap(\.emoji).filter { entry in
      if projected.contains("") || required.isEmpty { return true }
      let terms = ([entry.name] + (entry.keywords ?? [])).flatMap { text -> [String] in
        let normalized = legacy(text)
        let words = normalized.split(separator: " ").map(String.init)
        return words + [normalized, words.joined()]
      }.map(project)
      return required.allSatisfy { token in terms.contains { $0.contains(token) } }
    }.map(\.value)
  }

  static func fixture(stem: String, spanish: String, englishCount: Int) throws -> EmojiCatalog {
    var entries: [[String: Any]] = (0..<englishCount).map { index in
      ["e": "E\(index)", "n": stem + (englishCount == 1 ? "" : " suffix\(index)"), "k": [], "v": 1]
    }
    entries.append(["e": "🐙", "n": "unrelated", "k": [], "v": 1, "s": spanish])
    let object: [String: Any] = ["version": "fixture", "categories": [["id": "fixture", "name": "Fixture", "emoji": entries]]]
    return try JSONDecoder().decode(EmojiCatalog.self, from: JSONSerialization.data(withJSONObject: object))
  }

  static func main() throws {
    guard CommandLine.arguments.count == 2 else { fatalError("usage: witness OUTPUT") }
    let stem = "a\u{093E}b"
    precondition(canonical(stem) == ["ab"])
    precondition(project(legacy(stem)) == stem)
    var rows: [[String: Any]] = []
    for englishCount in [1, 60] {
      let catalog = try fixture(stem: stem, spanish: "ab", englishCount: englishCount)
      let search = EmojiSuggester(catalog: catalog)
      for query in [stem, "ab", "ab ab"] {
        let tokens = canonical(query)
        let reserved = envelope(catalog, tokens)
        precondition(tokens == ["ab"] && reserved.isEmpty)
        // The independent s:"ab" oracle is exactly eligible for every query.
        let eligible = tokens.allSatisfy { t in canonical("ab").contains { $0.hasPrefix(t) } }
        precondition(eligible)
        for cap in [1, 48, 60] {
          let baseline = search.search(query, limit: cap).map(\.value)
          let expected = query == stem ? (0..<min(cap, englishCount)).map { "E\($0)" } : []
          precondition(baseline == expected)
          let tranche = min(1, cap - min(cap, reserved.count))
          precondition(tranche == 1)
          rows.append(["englishCount": englishCount, "query": query, "canonical": tokens,
            "limit": cap, "legacyValues": baseline, "envelope": reserved,
            "localizedOracle": ["🐙"], "requiredAppendValues": baseline + ["🐙"],
            "exceedsCap": baseline.count + tranche > cap,
            "legacyOutsideEnvelope": !Set(baseline).isSubset(of: Set(reserved))])
        }
      }
    }
    // Verify v1's join and v3's newly assigned-letter controls independently.
    var inherited: [[String: Any]] = []
    for stem in ["foo'bar", "foo9bar", "a\u{105C0}b extra"] {
      let catalog = try fixture(stem: stem, spanish: "placeholder", englishCount: 1)
      let tokens = canonical(stem)
      let reserved = envelope(catalog, tokens)
      let baseline = EmojiSuggester(catalog: catalog).search(stem, limit: 1).map(\.value)
      precondition(baseline == ["E0"] && reserved.contains("E0"))
      inherited.append(["query": stem, "canonical": tokens, "envelope": reserved, "legacyValues": baseline])
    }
    let classifications: [[String: Any]] = [0x093E, 0x0301, 0x20DD, 0x105C0].map { value in
      let s = Unicode.Scalar(value)!
      return ["scalar": String(format: "U+%04X", value), "foundationLetters": CharacterSet.letters.contains(s),
        "foundationAlphanumerics": CharacterSet.alphanumerics.contains(s),
        "foundationNonBase": CharacterSet.nonBaseCharacters.contains(s),
        "legacyContext": legacy("a" + String(s) + "b"), "projectedLegacyContext": project(legacy("a" + String(s) + "b")),
        "canonicalContext": canonical("a" + String(s) + "b")]
    }
    let output: [String: Any] = ["contractVersion": 4, "baselineOnly": true,
      "rows": rows, "inheritedChecks": inherited, "classifications": classifications,
      "verifiedRows": rows.count, "overCapRows": rows.filter { $0["exceedsCap"] as! Bool }.count]
    let data = try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    let violations = rows.filter { $0["exceedsCap"] as! Bool }.count
    print("verified \(rows.count) rows; \(violations) violate cap under required append")
  }
}
