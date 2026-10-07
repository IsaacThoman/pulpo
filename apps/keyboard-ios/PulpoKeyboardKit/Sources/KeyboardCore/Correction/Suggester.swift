import Foundation

public struct Suggestion: Hashable, Sendable {
  public enum Kind: Hashable, Sendable {
    /// Exactly what was typed; picking it keeps the word and stops autocorrection.
    case literal
    case correction
    case completion
    case prediction
    case alternative
  }

  public var text: String
  public var kind: Kind
  /// The candidate that a space or punctuation will apply.
  public var isAutocorrection: Bool

  public init(text: String, kind: Kind, isAutocorrection: Bool = false) {
    self.text = text
    self.kind = kind
    self.isAutocorrection = isAutocorrection
  }
}

public struct SuggestionSet: Equatable, Sendable {
  /// Up to three suggestions in display order; the strongest sits in the middle.
  public var slots: [Suggestion]
  public var autocorrection: String?

  public init(slots: [Suggestion] = [], autocorrection: String? = nil) {
    self.slots = slots
    self.autocorrection = autocorrection
  }

  public static let empty = SuggestionSet()

  /// Places the best candidate in the middle, like the system QuickType bar.
  static func centered(_ ordered: [Suggestion]) -> [Suggestion] {
    switch ordered.count {
    case 0, 1: ordered
    case 2: [ordered[1], ordered[0]]
    default: [ordered[1], ordered[0], ordered[2]]
    }
  }
}

public struct Candidate: Sendable {
  public var text: String
  public var id: Int?
  public var cost: Double
  public var score: Double
  public var isCompletion: Bool
}

/// Turns the word being typed into corrections, completions and an autocorrect decision.
public final class Suggester {
  public let model: LanguageModel
  public let corrector: SpellCorrector
  /// The person's iOS text replacements, keyed by lowercased shortcut.
  public var textReplacements: [String: String] = [:]
  /// Margin a near-miss must beat a valid typed word by before replacing it.
  public var validWordMargin = 7.0
  static let completionPenalty = 1.5

  public init(model: LanguageModel, corrector: SpellCorrector) {
    self.model = model
    self.corrector = corrector
  }

  var lexicon: Lexicon { model.lexicon }
  var personal: PersonalDictionary { model.personal }

  /// Whether `word` is spelled as the dictionary or the person spells it.
  public func isValid(_ word: String) -> Bool {
    if personal.isKnown(word) { return true }
    let lowered = word.lowercased()
    for id in lexicon.words(forKey: TextNormalizer.key(word)) {
      let display = lexicon.display(id)
      if display == word { return true }
      // "Hello" and "HELLO" are fine when "hello" is a word.
      if display == lowered, word != lowered { return true }
    }
    if personal.isKnown(lowered) && word.first?.isUppercase == true { return true }
    return false
  }

  public func isCorrectable(_ word: String) -> Bool {
    guard word.count <= 30 else { return false }
    return word.allSatisfy { $0.isLetter || $0 == "'" || $0 == "\u{2019}" }
  }

  public func candidates(for word: TypedWord, context: LanguageContext, rejected: Set<String> = []) -> [Candidate] {
    var byText: [String: Candidate] = [:]
    func add(_ candidate: Candidate) {
      guard !personal.isBlocked(candidate.text), !rejected.contains(candidate.text) else { return }
      if let existing = byText[candidate.text], existing.score >= candidate.score { return }
      byText[candidate.text] = candidate
    }
    let typed = word.text
    let typedKey = TextNormalizer.key(typed)
    let result = corrector.search(word)
    for match in result.words {
      let flags = lexicon.flags(match.id)
      let display = lexicon.display(match.id)
      if flags.contains(.neverSuggest), TextNormalizer.key(display) != typedKey { continue }
      let logP = model.logProbability(of: display, id: match.id, in: context)
      add(Candidate(text: display, id: match.id, cost: match.cost, score: logP - match.cost, isCompletion: false))
    }
    let bound = SpellCorrector.bound(forLength: typedKey.utf8.count)
    if bound > 0 {
      for known in personal.knownWords {
        let knownKey = TextNormalizer.key(known)
        guard abs(knownKey.utf8.count - typedKey.utf8.count) <= 2, knownKey.first == typedKey.first || knownKey.utf8.count > 3 else { continue }
        let cost = corrector.cost(of: word, against: known)
        guard cost <= bound else { continue }
        let logP = model.logProbability(of: known, id: lexicon.id(of: known), in: context)
        add(Candidate(text: known, id: nil, cost: cost, score: logP - cost, isCompletion: false))
      }
    }
    if let shortcut = lexicon.shortcuts[typedKey], !shortcut.contains(" ") || typedKey.utf8.count > 3 {
      let id = lexicon.id(of: shortcut)
      let logP = model.logProbability(of: shortcut, id: id, in: context)
      add(Candidate(text: shortcut, id: id, cost: 0.8, score: logP - 0.8, isCompletion: false))
    }
    for match in corrector.completions(of: result.prefixes, limit: 8, excluding: typedKey.utf8.count) {
      let display = lexicon.display(match.id)
      let logP = model.logProbability(of: display, id: match.id, in: context)
      add(Candidate(text: display, id: match.id, cost: match.cost, score: logP - match.cost - Self.completionPenalty, isCompletion: true))
    }
    return byText.values.sorted { $0.score != $1.score ? $0.score > $1.score : $0.text < $1.text }
  }

  /// - Parameters:
  ///   - autocorrect: Whether a separator may replace the typed word.
  ///   - replacements: Whether the person's text replacements apply (they work even with autocorrect off).
  public func suggestions(for word: TypedWord, context: LanguageContext, autocorrect: Bool, replacements: Bool = true, rejected: Set<String> = []) -> SuggestionSet {
    let typed = word.text
    guard !typed.isEmpty else { return predictions(context: context) }
    if replacements, !rejected.contains(typed), let replacement = textReplacements[typed.lowercased()] {
      return SuggestionSet(
        slots: [Suggestion(text: typed, kind: .literal), Suggestion(text: replacement, kind: .correction, isAutocorrection: true)],
        autocorrection: replacement
      )
    }
    guard isCorrectable(typed) else { return SuggestionSet(slots: [Suggestion(text: typed, kind: .literal)]) }

    let valid = isValid(typed)
    let ranked = candidates(for: word, context: context, rejected: rejected).map { candidate -> Candidate in
      var adjusted = candidate
      adjusted.text = Self.matchCase(of: typed, to: candidate.text)
      return adjusted
    }
    let autocorrection = autocorrect && !rejected.contains(typed) ? choose(from: ranked, typed: typed, valid: valid) : nil

    // Built best-first, then centered: the strongest candidate takes the middle slot.
    var ordered: [Suggestion] = []
    if let autocorrection {
      ordered = [Suggestion(text: autocorrection.text, kind: .correction, isAutocorrection: true), Suggestion(text: typed, kind: .literal)]
    } else if valid {
      ordered = [Suggestion(text: typed, kind: .literal)]
    }
    for candidate in ranked where candidate.text != typed && !ordered.contains(where: { $0.text == candidate.text }) {
      ordered.append(Suggestion(text: candidate.text, kind: candidate.isCompletion ? .completion : .correction))
      if ordered.count == 3 { break }
    }
    if autocorrection == nil, !valid {
      // Unknown words keep their literal in the left slot so tapping it keeps them.
      ordered = Array(ordered.prefix(2))
      ordered.insert(Suggestion(text: typed, kind: .literal), at: min(1, ordered.count))
    }
    return SuggestionSet(slots: SuggestionSet.centered(ordered), autocorrection: autocorrection?.text)
  }

  private func choose(from ranked: [Candidate], typed: String, valid: Bool) -> Candidate? {
    let typedKey = TextNormalizer.key(typed)
    guard let best = ranked.first(where: { !$0.isCompletion && $0.text != typed }) else { return nil }
    let sameLetters = TextNormalizer.key(best.text) == typedKey
    if !valid {
      // A lone letter is only ever fixed by a shortcut such as i -> I.
      return typed.count > 1 || sameLetters ? best : nil
    }
    if personal.isKnown(typed) { return nil }
    let typedScore = ranked.first { !$0.isCompletion && $0.text == typed }?.score ?? -.infinity
    if sameLetters, best.score > typedScore + 2 {
      // Same letters, better spelling: lets -> let's when context agrees.
      return best
    }
    if best.cost <= 3.3, best.score - typedScore >= validWordMargin { return best }
    return nil
  }

  public func predictions(context: LanguageContext) -> SuggestionSet {
    let words = model.predictions(in: context, limit: 3).map { Suggestion(text: $0.word, kind: .prediction) }
    return SuggestionSet(slots: SuggestionSet.centered(words))
  }

  /// Carries the typed capitalization onto a candidate. Candidates with their own
  /// internal capitals (iPhone) keep them.
  public static func matchCase(of typed: String, to candidate: String) -> String {
    guard let first = typed.first, first.isUppercase else { return candidate }
    let hasInnerCapitals = candidate.dropFirst().contains { $0.isUppercase }
    if typed.count > 1, typed.allSatisfy({ !$0.isLetter || $0.isUppercase }) {
      return candidate.uppercased()
    }
    if hasInnerCapitals { return candidate }
    return candidate.prefix(1).uppercased() + candidate.dropFirst()
  }
}
