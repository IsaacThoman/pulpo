import Foundation

// Independent a priori v5 policy model, linked ONLY to unchanged baseline APIs.
// Calculated localized/merge outputs are controls, never candidate/utility results.
@main struct DomainWitness {
  static let locale = Locale(identifier: "en_US_POSIX")
  static let ignored: Set<String> = ["a", "an", "and", "for", "in", "of", "on", "the", "to", "with"]
  struct Entry {
    let value: String
    let english: String
    var keywords: [String] = []
    var spanish: String? = nil
  }
  static func base(_ s: Unicode.Scalar) -> Bool {
    switch s.properties.generalCategory {
    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter:
      return CharacterSet.letters.contains(s)
    default: return false
    }
  }
  static func mark(_ s: Unicode.Scalar) -> Bool {
    [.nonspacingMark, .spacingMark, .enclosingMark].contains(s.properties.generalCategory)
  }
  static func legacy(_ text: String) -> String {
    text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale).unicodeScalars.map {
      CharacterSet.alphanumerics.contains($0) ? String($0) : ($0 == "'" || $0 == "\u{2019}" ? "" : " ")
    }.joined().split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }
  static func canonical(_ text: String) -> [String] {
    var words: [String] = [], token = "", vowel = false
    for s in text.lowercased(with: locale).decomposedStringWithCanonicalMapping.unicodeScalars {
      if mark(s) {
        if !token.isEmpty && !vowel { token.unicodeScalars.append(s) }
      } else if base(s) {
        token.unicodeScalars.append(s)
        vowel = "aeiou".unicodeScalars.contains(s)
      } else {
        if !token.isEmpty { words.append(token.precomposedStringWithCanonicalMapping) }
        token = ""; vowel = false
      }
    }
    if !token.isEmpty { words.append(token.precomposedStringWithCanonicalMapping) }
    return Array(Set(words)).sorted()
  }
  static func project(_ text: String) -> String {
    String(String.UnicodeScalarView(text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: locale)
      .decomposedStringWithCanonicalMapping.unicodeScalars.filter(base)))
  }
  static func englishTerms(_ e: Entry) -> [String] {
    ([e.english] + e.keywords).flatMap { text -> [String] in
      let normalized = legacy(text), words = normalized.split(separator: " ").map(String.init)
      return words + [normalized, words.joined()]
    }
  }
  static func envelope(_ entries: [Entry], _ tokens: [String]) -> [String] {
    let projected = tokens.map(project), required = Set(projected).subtracting(ignored)
    return entries.filter { e in
      if projected.contains("") || required.isEmpty { return true }
      let terms = englishTerms(e).map(project)
      return required.allSatisfy { t in terms.contains { $0.contains(t) } }
    }.map(\.value)
  }
  static func catalog(_ entries: [Entry]) throws -> EmojiCatalog {
    let objects: [[String: Any]] = entries.map { e in
      var o: [String: Any] = ["e": e.value, "n": e.english, "k": e.keywords, "v": 1]
      if let s = e.spanish { o["s"] = s }
      return o
    }
    let object: [String: Any] = ["version": "fixture", "categories": [["id": "fixture", "name": "Fixture", "emoji": objects]]]
    return try JSONDecoder().decode(EmojiCatalog.self, from: JSONSerialization.data(withJSONObject: object))
  }
  // Explicit contract ranking tuple: name-set equality, completion count,
  // distinct Spanish words, catalog ordinal. Preferences never enter it.
  static func localized(_ entries: [Entry], _ tokens: [String]) -> [String] {
    guard !tokens.isEmpty else { return [] }
    if tokens.count == 1, tokens[0].utf8.count == 1 { return [] }
    var ranked: [(Int, Int, Int, Int)] = []
    for (i, e) in entries.enumerated() {
      let es = canonical(e.spanish ?? ""), en = englishTerms(e)
      let spanishMatch = tokens.contains { t in es.contains { $0.hasPrefix(t) } }
      let matches = tokens.allSatisfy { t in
        es.contains { $0.hasPrefix(t) } || en.contains { $0.hasPrefix(legacy(t)) }
      }
      if !spanishMatch || !matches { continue }
      let completion = tokens.filter { t in !es.contains(t) && !en.contains(legacy(t)) }.count
      ranked.append((es == tokens ? 0 : 1, completion, es.count, i))
    }
    ranked.sort { $0 < $1 }
    return ranked.map { entries[$0.3].value }
  }
  static func tranche(_ entries: [Entry], _ tokens: [String], _ cap: Int) -> [String] {
    let reserved = Set(envelope(entries, tokens))
    return Array(localized(entries, tokens).filter { !reserved.contains($0) }.prefix(max(0, cap - min(cap, reserved.count))))
  }
  static func main() throws {
    guard CommandLine.arguments.count == 2 else { fatalError("usage: witness OUTPUT") }
    var rows: [[String: Any]] = [], executed = 0
    let prefs: [[String: Int]] = [[:], ["E0": -1000000, "L0": 1000000]]
    func check(_ entries: [Entry], _ queries: [String], _ label: String, retain: Bool = true) throws {
      let search = EmojiSuggester(catalog: try catalog(entries))
      let tokens = canonical(queries[0]), env = envelope(entries, tokens)
      for cap in [1, 48, 60] {
        let fixed = tranche(entries, tokens, cap)
        for preferred in prefs {
          for query in queries {
            precondition(canonical(query) == tokens, label + " canonical mismatch")
            precondition(envelope(entries, canonical(query)) == env)
            precondition(tranche(entries, canonical(query), cap) == fixed)
            let measured = search.search(query, limit: cap, preferring: preferred).map(\.value)
            precondition(Set(measured).isSubset(of: Set(env)), label + " incomplete envelope")
            let merged = measured + fixed
            precondition(merged.count <= cap && Set(merged).count == merged.count)
            precondition(Array(merged.prefix(measured.count)) == measured)
            executed += 1
            if retain && preferred.isEmpty {
              rows.append(["control": label, "query": query, "canonical": tokens, "cap": cap,
                "measuredBaseline": measured, "envelope": env, "calculatedLocalizedTranche": fixed,
                "calculatedMerge": merged])
            }
          }
        }
      }
    }
    // Executed legacy compatibility and all four prior domain blockers.
    for (stem, equivalents, label) in [
      ("foo'bar", ["bar foo", "foo bar", "foo'bar foo'bar"], "v1-apostrophe"),
      ("foo’bar", ["bar foo", "foo bar"], "curly-apostrophe"),
      ("foo9bar", ["bar foo", "foo bar"], "digit-separator"),
      ("a\u{093E}b", ["ab", "ab ab"], "v2-v4-Mc"),
      ("a\u{105C0}b extra", ["extra b a", "a b extra a"], "v3-new-letter"),
      ("keycap: #", ["keycap", "keycap keycap"], "punctuation-exact")
    ] {
      let entries = [Entry(value: "E0", english: stem), Entry(value: "L0", english: "opaque", spanish: canonical(stem).joined(separator: " "))]
      let baseline = EmojiSuggester(catalog: try catalog(entries))
      precondition(baseline.search(stem, limit: 1).map(\.value) == ["E0"])
      try check(entries, [stem] + equivalents, label)
    }
    let overfull = (0..<60).map { Entry(value: "E\($0)", english: "a\u{093E}b suffix\($0)") }
      + [Entry(value: "L0", english: "opaque", spanish: "ab")]
    try check(overfull, ["a\u{093E}b", "ab", "ab ab"], "v4-overfull", retain: false)
    precondition(envelope(overfull, ["ab"]).count == 60)

    // R31's ranking/cap failures, exercised only as a priori model controls.
    let hearts = (0..<49).map { Entry(value: "L\($0)", english: "opaque", spanish: $0 == 0 ? "corazón rojo" : "rojo corazón") }
    try check(hearts, ["corazon rojo", "rojo corazon", "corazón rojo rojo", "CORAZO\u{0301}N ROJO"], "R31-49-heart", retain: false)
    for cap in [1, 48, 60] {
      precondition(tranche(hearts, canonical("rojo corazon"), cap) == (0..<min(cap, 49)).map { "L\($0)" })
    }
    let faces = [Entry(value: "L0", english: "opaque", spanish: "sonriente cara"),
      Entry(value: "L1", english: "opaque", spanish: "cara sonriente"),
      Entry(value: "L2", english: "opaque", spanish: "cara sonriente grande")]
    try check(faces, ["cara sonriente", "sonriente cara", "cara cara sonriente"], "R31-face", retain: false)
    precondition(tranche(faces, canonical("cara sonriente"), 1) == ["L0"])

    let bilingual = [Entry(value: "L0", english: "red", spanish: "corazón"),
      Entry(value: "L1", english: "blue", spanish: "corazón"), Entry(value: "L2", english: "red", spanish: "estrella")]
    precondition(localized(bilingual, canonical("red corazon")) == ["L0"])
    precondition(localized(bilingual, canonical("blue estrella")).isEmpty)
    precondition(localized([Entry(value: "L0", english: "foobar", spanish: "foo")], canonical("bar foo")).isEmpty)
    try check(bilingual, ["red corazon", "corazón red", "red red corazón"], "conjunctive-mixed", retain: false)
    let consonants = [Entry(value: "L0", english: "opaque", spanish: "piña"), Entry(value: "L1", english: "opaque", spanish: "pina")]
    precondition(localized(consonants, canonical("pina")) == ["L1"])
    precondition(localized(consonants, canonical("PIÑ")) == ["L0"])
    precondition(localized([Entry(value: "L0", english: "opaque", spanish: "ñandú")], canonical("Ñ")) == ["L0"])
    precondition(canonical("Ñ ñ n\u{0303}") == ["ñ"])
    precondition(canonical("á é í ó ú") == ["a", "e", "i", "o", "u"])
    precondition(canonical("!a! a a") == ["a"] && localized(consonants, ["a"]).isEmpty)
    precondition(canonical("123 ! \u{0301}").isEmpty)
    precondition(envelope(consonants, []).count == consonants.count)
    precondition(envelope(consonants, ["the", "and"]).count == consonants.count)
    for m in ["\u{0301}", "\u{093E}", "\u{20DD}"] {
      precondition(canonical("a" + m + "b") == ["ab"])
      precondition(canonical("n" + m + "b") != ["nb"])
      precondition(project("a" + m + "b") == "ab")
    }
    var englishControls: [[String: Any]] = []
    for (name, query) in [("vicuña", "vicuna"), ("são", "sao"), ("piña", "pina")] {
      let search = EmojiSuggester(catalog: try catalog([Entry(value: "E0", english: name)]))
      for q in [query, name.uppercased(with: locale), name.decomposedStringWithCanonicalMapping] {
        let measured = search.search(q).map(\.value)
        precondition(measured == ["E0"])
        englishControls.append(["name": name, "query": q, "measuredBaseline": measured])
      }
    }
    // Bounded fresh controls, deterministic and disclosed; never a hidden suite.
    let selected: [UInt32] = [0x0345,0x034F,0x093E,0x20DD,0x105C0,0x0130,0x0131,0x00DF,0x1E9E,0x03A3,0x03C2,0x1F88,0x1FB3,0x212A,0x212B,0xFB00,0x2160,0xFF21,0x1100,0x1161,0x11A8,0x00AA,0x02BC,0x17B6,0xFE0F,0x200D,0x0967,0x1D165,0x1D16D]
    let sampled: [UInt32] = (0..<32).map { (UInt32($0) &* 7919 &+ 345) % 0x110000 }
    var classifications: [[String: Any]] = [], fixtures = 0
    for value in selected + sampled {
      guard let s = Unicode.Scalar(value) else { continue }
      classifications.append(["scalar": String(format: "U+%04X", value), "category": String(describing: s.properties.generalCategory),
        "foundationLetters": CharacterSet.letters.contains(s), "foundationAlphanumerics": CharacterSet.alphanumerics.contains(s), "admittedBase": base(s)])
      for raw in ["a\(s)b extra", "n\(s)b extra", "ΟΣ\(s) extra"] {
        let tokens = canonical(raw)
        let entries = [Entry(value: "E0", english: raw), Entry(value: "L0", english: "opaque", spanish: tokens.joined(separator: " "))]
        try check(entries, [raw, tokens.reversed().joined(separator: " "), (tokens + tokens).joined(separator: " ")], "fresh-Unicode", retain: false)
        fixtures += 1
      }
    }
    let output: [String: Any] = ["contractVersion": 5, "baselineOnly": true,
      "calculatedLocalizedOutputsArePolicyControlsNotCandidateResults": true,
      "executedCapacityRows": executed, "repairedControls": rows, "englishCompatibilityControls": englishControls,
      "freshUnicodeFixtures": fixtures, "freshUnicodeClassifications": classifications,
      "overfullMarkEnvelopeCount": 60, "R31HeartsSelectedCountsAtCaps1_48_60": [1,48,49],
      "faceCap1Calculated": ["L0"], "failures": [],
      "scope": "Independent domain witness only; not runner/validator/comparator smoke, source review, utility or costs."]
    try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
      .write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
    print("verified \(executed) capacity rows, \(fixtures) fresh Unicode fixtures, ranking/conjunction/orthography controls; zero failures")
  }
}
