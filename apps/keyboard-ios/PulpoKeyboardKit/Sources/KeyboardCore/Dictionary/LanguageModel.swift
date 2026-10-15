import Foundation

/// The word before the cursor, resolved once per suggestion pass.
public struct LanguageContext: Sendable, Equatable {
  /// Lexicon history index, or `nil` when the previous word is unknown.
  public var history: Int?
  public var previousWord: String?
  public var trigram: Int? = nil

  public static let unknown = LanguageContext(history: nil, previousWord: nil)
}

/// Interpolates bounded static word histories with what the person has typed before.
public final class LanguageModel {
  public let lexicon: Lexicon
  public let personal: PersonalDictionary
  static let floor = -26.0
  private lazy var fallbackWords = lexicon.frequentWords(limit: 32)

  /// Personal pair history for the start of a sentence. Never typed text.
  public static let sentenceStartHistory = "\u{2}"

  public init(lexicon: Lexicon, personal: PersonalDictionary) {
    self.lexicon = lexicon
    self.personal = personal
  }

  public func context(previousWord: String?, sentenceStart: Bool, precedingWord: String? = nil) -> LanguageContext {
    if sentenceStart { return LanguageContext(history: lexicon.sentenceStart, previousWord: nil) }
    guard let previousWord, !previousWord.isEmpty else { return .unknown }
    let history = lexicon.id(of: previousWord)
    let trigram = precedingWord.flatMap { lexicon.id(of: $0) }.flatMap { earlier in
      history.flatMap { lexicon.trigramHistory(preceding: earlier, previous: $0) }
    }
    return LanguageContext(history: history, previousWord: previousWord, trigram: trigram)
  }

  /// People open messages and sentences in habitual ways ("Okay", "Sure"), so
  /// personal pairs also remember what started a sentence.
  private func personalHistory(_ context: LanguageContext) -> String? {
    context.previousWord ?? (context.history == lexicon.sentenceStart ? Self.sentenceStartHistory : nil)
  }

  /// Personal evidence gets more weight as the person types more.
  private var personalWeight: Double {
    let total = Double(personal.totalCount)
    return min(0.35, total / (total + 400))
  }

  public func logProbability(of word: String, id: Int?, in context: LanguageContext) -> Double {
    var probability = 0.0
    if let id { probability = exp(lexicon.logProbability(of: id, after: context.history)) }
    if let trigram = context.trigram {
      let weight = lexicon.trigramWeight(of: trigram)
      var conditional = 0.0
      if let id {
        for position in lexicon.trigramSuccessors(of: trigram) {
          let entry = lexicon.trigramSuccessor(at: position)
          if entry.id == id { conditional = exp(entry.logProbability); break }
        }
      }
      probability = (1 - weight) * probability + weight * conditional
    }
    let weight = personalWeight
    if weight > 0 {
      var personalProbability = 0.0
      let count = Double(personal.count(of: word))
      if count > 0 { personalProbability = count / Double(max(personal.totalCount, 1)) }
      if let previous = personalHistory(context) {
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
    guard limit > 0 else { return [] }
    func add(_ id: Int) {
      guard !lexicon.flags(id).contains(.neverSuggest) else { return }
      let word = lexicon.display(id)
      guard !personal.isBlocked(word) else { return }
      scored[word] = max(scored[word] ?? -.infinity, logProbability(of: word, id: id, in: context))
    }
    if let trigram = context.trigram {
      for position in lexicon.trigramSuccessors(of: trigram) { add(lexicon.trigramSuccessor(at: position).id) }
    }
    if let history = context.history {
      for position in lexicon.successors(of: history) {
        // The table is already bounded. Trigram candidates must not consume the
        // bigram budget: an interpolated backoff word can outrank either list.
        add(lexicon.successor(at: position).id)
      }
    }
    if let previous = personalHistory(context) {
      for (word, _) in personal.successors(of: previous, limit: limit * 2) where !personal.isBlocked(word) {
        let id = lexicon.id(of: word)
        // Older personal dictionaries learned the pronoun as "i".
        if let id, lexicon.display(id) == word, lexicon.flags(id).contains(.neverSuggest) { continue }
        scored[word] = max(scored[word] ?? -.infinity, logProbability(of: word, id: id, in: context))
      }
    }
    // Unknown names and sparse histories should still offer usable next words.
    for id in fallbackWords { add(id) }
    return scored.map { ($0.key, $0.value) }
      .sorted { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }
      .prefix(limit)
      .map { (word: $0.0, logProbability: $0.1) }
  }
}
