import Foundation

/// The word before the cursor, resolved once per suggestion pass.
public struct LanguageContext: Sendable, Equatable {
  /// Lexicon history index, or `nil` when the previous word is unknown.
  public var history: Int?
  public var previousWord: String?

  public static let unknown = LanguageContext(history: nil, previousWord: nil)
}

/// Mixes the static bigram model with what the person has typed before.
public final class LanguageModel {
  public let lexicon: Lexicon
  public let personal: PersonalDictionary
  static let floor = -26.0

  public init(lexicon: Lexicon, personal: PersonalDictionary) {
    self.lexicon = lexicon
    self.personal = personal
  }

  public func context(previousWord: String?, sentenceStart: Bool) -> LanguageContext {
    if sentenceStart { return LanguageContext(history: lexicon.sentenceStart, previousWord: nil) }
    guard let previousWord, !previousWord.isEmpty else { return .unknown }
    return LanguageContext(history: lexicon.id(of: previousWord), previousWord: previousWord)
  }

  /// Personal evidence gets more weight as the person types more.
  private var personalWeight: Double {
    let total = Double(personal.totalCount)
    return min(0.35, total / (total + 400))
  }

  public func logProbability(of word: String, id: Int?, in context: LanguageContext) -> Double {
    var probability = 0.0
    if let id { probability = exp(lexicon.logProbability(of: id, after: context.history)) }
    let weight = personalWeight
    if weight > 0 {
      var personalProbability = 0.0
      let count = Double(personal.count(of: word))
      if count > 0 { personalProbability = count / Double(max(personal.totalCount, 1)) }
      if let previous = context.previousWord {
        let pair = Double(personal.pairCount(previous, word))
        let history = Double(personal.historyCount(previous))
        if pair > 0, history > 0 { personalProbability = 0.7 * pair / history + 0.3 * personalProbability }
      }
      probability = (1 - weight) * probability + weight * personalProbability
    }
    if probability <= 0 {
      // Known names and pinned words still need a usable prior.
      return personal.isKnown(word) ? -13 : Self.floor
    }
    return max(Self.floor, log(probability))
  }

  /// Likely next words, best first. Words flagged as never-suggest are skipped.
  public func predictions(in context: LanguageContext, limit: Int) -> [(word: String, logProbability: Double)] {
    var scored: [String: Double] = [:]
    if let history = context.history {
      for position in lexicon.successors(of: history) {
        let entry = lexicon.successor(at: position)
        guard !lexicon.flags(entry.id).contains(.neverSuggest) else { continue }
        let word = lexicon.display(entry.id)
        if personal.isBlocked(word) { continue }
        scored[word] = max(scored[word] ?? -.infinity, logProbability(of: word, id: entry.id, in: context))
        if scored.count >= limit * 4 { break }
      }
    }
    if let previous = context.previousWord {
      for (word, _) in personal.successors(of: previous).prefix(limit * 2) where !personal.isBlocked(word) {
        scored[word] = max(scored[word] ?? -.infinity, logProbability(of: word, id: lexicon.id(of: word), in: context))
      }
    }
    return scored.map { ($0.key, $0.value) }
      .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }
      .prefix(limit)
      .map { (word: $0.0, logProbability: $0.1) }
  }
}
