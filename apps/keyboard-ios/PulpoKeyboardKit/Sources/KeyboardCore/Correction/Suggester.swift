import Foundation

public struct Suggestion: Hashable, Sendable {
  public enum Kind: Hashable, Sendable {
    /// Exactly what was typed; picking it keeps the word and stops autocorrection.
    case literal
    case correction
    case completion
    case prediction
    case alternative
    /// An explicitly chosen emoji; never applied by autocorrection.
    case emoji
  }

  public var text: String
  public var kind: Kind
  /// The candidate that a space or punctuation will apply.
  public var isAutocorrection: Bool
  public var accessibilityLabel: String?
  /// Engine-generated choices belong to the text state that produced them.
  /// Nil keeps standalone suggestion construction compatible with direct clients.
  var sourceContext: UUID?

  public init(text: String, kind: Kind, isAutocorrection: Bool = false, accessibilityLabel: String? = nil) {
    self.text = text
    self.kind = kind
    self.isAutocorrection = isAutocorrection
    self.accessibilityLabel = accessibilityLabel
    sourceContext = nil
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
  /// Margin a near-miss must beat a case-exact valid word by, in addition to touch evidence.
  public var validWordMargin = 7.0
  static let completionPenalty = 1.5
  static let ambiguousLiterals: Set<String> = ["ill", "its", "lets", "were", "well", "hell", "shell", "wed", "id"]

  public init(model: LanguageModel, corrector: SpellCorrector) {
    self.model = model
    self.corrector = corrector
  }

  var lexicon: Lexicon { model.lexicon }
  var personal: PersonalDictionary { model.personal }

  /// Whether `word` is spelled as the dictionary or the person spells it.
  public func isValid(_ word: String) -> Bool {
    if personal.isKnown(word) { return true }
    let normalized = word.replacingOccurrences(of: "\u{2019}", with: "'")
    let lowered = normalized.lowercased()
    for id in lexicon.words(forKey: TextNormalizer.key(word)) {
      guard !lexicon.flags(id).contains(.notAWord) else { continue }
      let display = lexicon.display(id)
      if display == normalized { return true }
      // Case alone must not turn a known name or acronym into a misspelling:
      // lowercase "nfl" and "brady" are still NFL and Brady, not ngl and brandy.
      if display.lowercased() == lowered { return true }
      // Diacritics are intentional spelling, even when only the unaccented form
      // is in the lexicon. Never silently turn café into cafe.
      if normalized.decomposedStringWithCanonicalMapping.unicodeScalars.contains(where: { $0.properties.generalCategory == .nonspacingMark }),
         TextNormalizer.key(display) == TextNormalizer.key(normalized) { return true }
    }
    if personal.isKnown(lowered) && word.first?.isUppercase == true { return true }
    return lexicon.isSupplementalLiteral(normalized)
  }

  public func isCorrectable(_ word: String) -> Bool {
    guard word.count <= 30 else { return false }
    return word.allSatisfy { $0.isLetter || $0 == "'" || $0 == "\u{2019}" }
  }

  public func candidates(for word: TypedWord, context: LanguageContext, rejected: Set<String> = []) -> [Candidate] {
    var byText: [String: Candidate] = [:]
    func add(_ candidate: Candidate) {
      guard !personal.isBlocked(candidate.text), !rejected.contains(candidate.text) else { return }
      if let existing = byText[candidate.text] {
        // Finishing a prefix and correcting a missing final letter can name the
        // same word. Keep its real edit cost and eligibility for a separator.
        if existing.isCompletion != candidate.isCompletion {
          if !existing.isCompletion { return }
        } else if existing.score >= candidate.score { return }
      }
      byText[candidate.text] = candidate
    }
    let typed = word.text
    let typedKey = TextNormalizer.key(typed)
    let result = corrector.search(word)
    for match in result.words {
      let flags = lexicon.flags(match.id)
      if flags.contains(.notAWord) { continue }
      let display = lexicon.display(match.id)
      if flags.contains(.neverSuggest), TextNormalizer.key(display) != typedKey { continue }
      let logP = model.logProbability(of: display, id: match.id, in: context)
      add(Candidate(text: display, id: match.id, cost: match.cost, score: logP - match.cost, isCompletion: false))
    }
    let bound = SpellCorrector.bound(forLength: typedKey.utf8.count)
    if bound > 0 {
      let costOfKey = corrector.costEvaluator(for: word, bound: bound)
      for entry in personal.knownEntries {
        let known = entry.text, knownKey = entry.key
        guard abs(knownKey.utf8.count - typedKey.utf8.count) <= 2, knownKey.first == typedKey.first || knownKey.utf8.count > 3 else { continue }
        let cost = costOfKey(knownKey)
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
    // Unigram-only trie pruning can omit a less frequent word that is strongly
    // predicted by the sentence. Add matching contextual continuations directly.
    func addCompletion(_ display: String, id: Int?) {
      let key = TextNormalizer.key(display)
      guard key.count > typedKey.count, key.hasPrefix(typedKey) else { return }
      if let id, lexicon.flags(id).contains(.neverSuggest) { return }
      let logP = model.logProbability(of: display, id: id, in: context)
      add(Candidate(text: display, id: id, cost: 0, score: logP - Self.completionPenalty, isCompletion: true))
    }
    if let history = context.history {
      for position in lexicon.successors(of: history) {
        let id = lexicon.successor(at: position).id
        addCompletion(lexicon.display(id), id: id)
      }
    }
    if let history = context.trigram {
      for position in lexicon.trigramSuccessors(of: history) {
        let id = lexicon.trigramSuccessor(at: position).id
        addCompletion(lexicon.display(id), id: id)
      }
    }
    let typedLength = typedKey.count
    for entry in personal.knownEntries where entry.key.hasPrefix(typedKey) && entry.key.count > typedLength {
      addCompletion(entry.text, id: lexicon.id(of: entry.text))
    }
    // Conversations repeat their topic words. A dictionary word typed once is
    // already weighted by the personal model; offer it as a completion before
    // it becomes a valid personal spelling. Unknown one-off tokens stay out.
    for entry in personal.usedEntries where entry.key.count > typedKey.count && entry.key.hasPrefix(typedKey) {
      if let id = lexicon.id(of: entry.text) { addCompletion(entry.text, id: id) }
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
    // Internal capitals usually identify a name, brand, or code identifier.
    let hasInternalCapitals = typed.dropFirst().contains(where: { $0.isUppercase }) && typed.contains(where: { $0.isLowercase })
    let autocorrection = autocorrect && !rejected.contains(typed) && !hasInternalCapitals ? choose(from: ranked, word: word, valid: valid, context: context) : nil

    // Built best-first, then centered: the strongest candidate takes the middle slot.
    var ordered: [Suggestion] = []
    if let autocorrection {
      ordered = [Suggestion(text: autocorrection.text, kind: .correction, isAutocorrection: true), Suggestion(text: typed, kind: .literal)]
    } else if valid {
      ordered = [Suggestion(text: typed, kind: .literal)]
    }
    // Smart quotes type ’; the dictionary spells it '. Show "I’m" once, not twice.
    let plainTyped = typed.replacingOccurrences(of: "\u{2019}", with: "'")
    for candidate in ranked where candidate.text != typed && candidate.text != plainTyped && !ordered.contains(where: { $0.text == candidate.text }) {
      ordered.append(Suggestion(text: candidate.text, kind: candidate.isCompletion ? .completion : .correction))
      if ordered.count == 3 { break }
    }
    // Unknown words keep their literal in the left slot so tapping it keeps them.
    // One or two unknown letters are almost always an unfinished word, and space
    // already keeps them, so a full strip offers a third completion instead.
    if autocorrection == nil, !valid, typed.count > 2 || ordered.count < 3 {
      ordered = Array(ordered.prefix(2))
      ordered.insert(Suggestion(text: typed, kind: .literal), at: min(1, ordered.count))
    }
    return SuggestionSet(slots: SuggestionSet.centered(ordered), autocorrection: autocorrection?.text)
  }

  private func choose(from ranked: [Candidate], word: TypedWord, valid: Bool, context: LanguageContext) -> Candidate? {
    let typed = word.text
    let typedKey = TextNormalizer.key(typed)
    if personal.isKnown(typed) || personal.isKnown(typed.lowercased()) { return nil }
    // Supplemental spellings have no calibrated prior. Keep their literal even
    // when a frequent neighbor and an edge touch would beat an arbitrary floor.
    if lexicon.isSupplementalLiteral(typed) { return nil }
    // Keep established mixed-case brand spellings such as iphone -> iPhone.
    // Plain title case and all-caps aliases stay as typed unless explicitly chosen.
    if typed == typed.lowercased(), let canonical = ranked.first(where: {
      !$0.isCompletion && $0.text.lowercased() == typed &&
      $0.text.contains(where: \.isLowercase) && $0.text.dropFirst().contains(where: \.isUppercase)
    }) { return canonical }
    if !Self.ambiguousLiterals.contains(typedKey), typed == typed.lowercased(),
       let shortcut = lexicon.shortcuts[typedKey],
       (!valid || TextNormalizer.key(shortcut) == typedKey),
       shortcut != typed.replacingOccurrences(of: "\u{2019}", with: "'"),
       let match = ranked.first(where: { !$0.isCompletion && $0.text == shortcut }) {
      return match
    }
    if !valid {
      // Explicit, safe spelling shortcuts beat unrelated high-frequency words.
      // A shortcut never overrides a valid literal (ill, were, lets).
      if let shortcut = lexicon.shortcuts[typedKey],
         let match = ranked.first(where: { !$0.isCompletion && $0.text == Self.matchCase(of: typed, to: shortcut) }) {
        return match
      }
      let single = nonwordCorrection(from: ranked, word: word, context: context)
      // A missed or mistyped space joins two words into one unknown token.
      guard let split = spaceSplit(for: word, context: context) else { return single }
      // Two words must explain the letters better than any single word, including
      // one too uncertain to apply (Mybe stays literal rather than becoming My be).
      if let rival = ranked.first(where: { !$0.isCompletion && $0.text != typed }), rival.score >= split.score { return single }
      // A closed compound is the normal spelling of its halves typed without a
      // space: anyrhing is anything, not any thing.
      let joined = TextNormalizer.key(split.text.replacingOccurrences(of: " ", with: ""))
      if ranked.contains(where: { !$0.isCompletion && TextNormalizer.key($0.text) == joined }) { return single }
      return split
    }
    // Preserve apostrophes, accents and capitalization already accepted by the
    // dictionary. They can distinguish meanings: we're/were and ill/I'll.
    if typed.contains("'") || typed.contains("\u{2019}") ||
       typed.decomposedStringWithCanonicalMapping.unicodeScalars.contains(where: { $0.properties.generalCategory == .nonspacingMark }) { return nil }
    // Context alone cannot distinguish intentional "too" from "to", or "play"
    // from "pay". For a valid word, require evidence at each substituted key.
    // Missing/extra letters and centered (or absent) touches remain literal;
    // alternatives are still available in the strip.
    let keyed = word.keyed
    guard let best = ranked.first(where: { candidate in
      guard !candidate.isCompletion, candidate.cost <= 3.3 else { return false }
      return hasDirectedSubstitutions(keyed, target: TextNormalizer.key(candidate.text))
    }) else { return nil }
    // A weaker fallback must not win only because a stronger alternative has
    // no supporting touch evidence. That is uncertainty between explanations,
    // not positive evidence for the lower-ranked edit.
    let strongestAlternative = ranked.first {
      !$0.isCompletion && TextNormalizer.key($0.text) != typedKey
    }
    guard strongestAlternative?.text == best.text else { return nil }
    let typedScore = ranked.first { !$0.isCompletion && $0.text == typed }?.score
      ?? ranked.first { !$0.isCompletion && TextNormalizer.key($0.text) == typedKey }?.score
      ?? model.logProbability(of: typed, id: lexicon.id(of: typed), in: .unknown)
    let normalized = typed.replacingOccurrences(of: "\u{2019}", with: "'")
    let literalCase = lexicon.words(forKey: typedKey).contains {
      !lexicon.flags($0).contains(.notAWord) &&
      (lexicon.display($0) == normalized || lexicon.display($0) == normalized.lowercased())
    }
    // A lowercase case alias (cst -> CST) keeps the original non-word confidence
    // when touch evidence supports an edit; it remains literal without that evidence.
    var margin = literalCase ? validWordMargin : 0
    // Context that reverses the unigram ordering supplies evidence independent
    // of a generic preference for a more common spelling. Preserve the stronger
    // margin when an edit only replaces a rare valid word with a frequent one.
    if literalCase, let targetID = best.id, let sourceID = lexicon.id(of: typed),
       lexicon.unigramLogProbability(targetID) <= lexicon.unigramLogProbability(sourceID) {
      margin = min(margin, 5.0)
    }
    if best.score - typedScore >= margin { return best }
    return nil
  }

  /// A restored apostrophe may trail a letter-dropping correction by this much.
  static let apostropheRestorationMargin = 10.0
  /// Extra edit cost an unknown literal may need when context strongly supports
  /// one clearly separated correction of about the same length.
  static let extendedCost = 3.0
  static let extendedContextScore = -14.0

  /// The single-word correction for an unknown literal, or nil to keep it.
  private func nonwordCorrection(from ranked: [Candidate], word: TypedWord, context: LanguageContext) -> Candidate? {
    let typedKey = TextNormalizer.key(word.text)
    let standard = typedKey.count >= 7 ? 6.5 : 4.5
    if let best = nonwordCorrection(from: ranked, word: word, context: context, maximumCost: standard) { return best }
    // Two touch slips in one word ("vofeo" -> video) exceed the ordinary edit
    // budget. Accept them only with strong context and no close competitor.
    guard let best = nonwordCorrection(from: ranked, word: word, context: context, maximumCost: standard + Self.extendedCost),
          best.cost > standard, best.score >= Self.extendedContextScore else { return nil }
    let bestKey = TextNormalizer.key(best.text)
    guard abs(bestKey.count - typedKey.count) <= 1 else { return nil }
    let runnerUp = ranked.first { !$0.isCompletion && TextNormalizer.key($0.text) != bestKey && $0.text != word.text }
    return best.score - (runnerUp?.score ?? -.infinity) >= 3 ? best : nil
  }

  private func nonwordCorrection(from ranked: [Candidate], word: TypedWord, context: LanguageContext, maximumCost: Double) -> Candidate? {
    let typed = word.text
    let typedKey = TextNormalizer.key(typed)
    guard let best = ranked.first(where: {
      !$0.isCompletion && $0.text != typed && $0.cost <= maximumCost &&
      // Rare dictionary abbreviations are poor defaults for unknown literals.
      !($0.text.count > 1 && $0.text.allSatisfy(\.isUppercase) && !typed.allSatisfy(\.isUppercase)) &&
      !($0.id.map { lexicon.flags($0).contains(.capitalized) && lexicon.frequency($0) < 100 } ?? false) &&
      // Keep rare dictionary entries from winning when sparse context gives
      // every candidate the same language probability floor.
      ($0.id.map { lexicon.unigramLogProbability($0) } ?? -13) - $0.cost >= -20.8
    }) else { return nil }
    // The apostrophe sits on another keyboard page and is often skipped. The
    // same letters with it restored (shes -> she's) beat dropping a typed letter.
    if best.cost > 0, TextNormalizer.key(best.text).count < typedKey.count, let restored = ranked.first(where: { candidate in
      !candidate.isCompletion && candidate.cost == 0 && candidate.text.contains("'") &&
      TextNormalizer.key(candidate.text) == typedKey &&
      !(candidate.id.map { lexicon.flags($0).contains(.capitalized) && lexicon.frequency($0) < 100 } ?? false) &&
      (candidate.id.map { lexicon.unigramLogProbability($0) } ?? -26) >= -20.8
    }), restored.score + Self.apostropheRestorationMargin >= best.score { return restored }
    // A new title-cased word inside a sentence can be a name. A clear
    // adjacent transposition still supplies positive typing-error evidence;
    // adding or dropping letters does not establish that a name is wrong.
    if context.previousWord != nil, typed.first?.isUppercase == true,
       typed.dropFirst().allSatisfy(\.isLowercase),
       !Self.isSingleTransposition(typedKey, TextNormalizer.key(best.text)),
       !hasDirectedSubstitutions(word.keyed, target: TextNormalizer.key(best.text)) { return nil }
    // A short unknown token can just as easily be slang or an abbreviation.
    // Require more evidence than finding a nearby dictionary word. Judge the
    // strongest eligible correction first: rejecting it must not expose an
    // unrelated, weaker fallback to autocorrection.
    let minimumFamiliarity = typedKey.count <= 4 ? -14.5 : -20.8
    let familiarity = (best.id.map { lexicon.unigramLogProbability($0) } ?? -13) - best.cost
    let bestKey = TextNormalizer.key(best.text)
    // A singleton suffix on a short unknown token often belongs to slang or
    // an abbreviation ("meh"). Removing it needs evidence of a doubled key
    // or a neighboring key brushed while finishing the word.
    if typedKey.count <= 4, typedKey.count == bestKey.count + 1,
       typedKey.hasPrefix(bestKey), !hasPlausibleFinalBrush(word) { return nil }
    // A common word with one missing interior vowel can have a low combined
    // prior/edit score despite an otherwise clear winner. Keep lexical
    // familiarity and separation from competing explanations distinct.
    let canonical = best.id.map { lexicon.display($0) } ?? best.text
    let missingInteriorVowel = Self.hasSingleInteriorVowelOmission(typedKey, bestKey)
    let runnerUp = ranked.first { candidate in
      !candidate.isCompletion && TextNormalizer.key(candidate.text) != bestKey &&
      candidate.cost <= maximumCost && candidate.text != typed
    }
    let unambiguousOmission = missingInteriorVowel &&
      canonical.first?.isLowercase == true &&
      (best.id.map { lexicon.unigramLogProbability($0) } ?? -26) >= -13 &&
      best.score - (runnerUp?.score ?? -.infinity) >= 3
    guard familiarity >= minimumFamiliarity || (typedKey.count <= 4 && unambiguousOmission) else { return nil }
    let sameLetters = TextNormalizer.key(best.text) == typedKey
    // A lone letter is only ever fixed by a shortcut such as i -> I.
    return typed.count > 1 || sameLetters ? best : nil
  }

  // MARK: Space errors

  /// Expected cost of a space the finger never registered, like a dropped letter.
  static let missedSpaceCost = 4.0
  /// A two-word reading must be plausible on its own, not just better than a weak single word.
  static let minimumSplitScore = -24.0
  /// Each half must be an ordinary word, not an obscure entry that happens to fit.
  static let minimumSplitPartFamiliarity = -16.0
  /// Largest edit inside one half of a split: about one touch-directed slip.
  static let maximumSplitPartCost = 3.3
  /// Bottom-row letters directly above the space bar.
  static let spaceRowLetters: Set<UInt8> = Set("xcvbn".utf8)

  /// Reads an unknown token as two words joined by a missed space ("thatsuper") or
  /// by a space tap that registered on a letter above the space bar ("stormsbon").
  func spaceSplit(for word: TypedWord, context: LanguageContext) -> Candidate? {
    let typed = Array(word.text)
    guard typed.count >= 3, typed.count <= 30,
          typed.allSatisfy({ ($0.isASCII && $0.isLetter) || $0 == "'" || $0 == "\u{2019}" }) else { return nil }
    // A new title-cased token inside a sentence may be a name (Newberry), and
    // internal capitals are excluded upstream as code or brand spellings.
    if context.previousWord != nil, typed[0].isUppercase { return nil }
    let geometry = corrector.geometry
    let taps = typed.indices.map { $0 < word.taps.count ? word.taps[$0] : nil }
    var best: Candidate?
    func consider(_ first: Range<Int>, _ second: Range<Int>, cost: Double) {
      let firstText = String(typed[first]), secondText = String(typed[second])
      guard let firstKey = firstText.last, let secondKey = secondText.first,
            firstKey.isLetter, secondKey.isLetter else { return }
      let exactFirst = splitPart(firstText)
      let exactSecond = splitPart(secondText)
      // At most one half may also carry a small typing slip ("inrhe" -> in the).
      guard exactFirst != nil || exactSecond != nil else { return }
      let a = exactFirst ?? correctedSplitPart(TypedWord(text: firstText, taps: Array(taps[first])), context: context)
      guard let a else { return }
      let next = model.context(previousWord: a.text, sentenceStart: false, precedingWord: context.previousWord)
      let b = exactSecond ?? correctedSplitPart(TypedWord(text: secondText, taps: Array(taps[second])), context: next)
      guard let b else { return }
      let score = model.logProbability(of: a.text, id: a.id, in: context) - a.cost
        + model.logProbability(of: b.text, id: b.id, in: next) - b.cost - cost
      guard score >= Self.minimumSplitScore, score > best?.score ?? -.infinity else { return }
      best = Candidate(text: a.text + " " + b.text, id: nil, cost: cost + a.cost + b.cost, score: score, isCompletion: false)
    }
    for index in 1..<typed.count {
      consider(0..<index, index..<typed.count, cost: Self.missedSpaceCost)
      guard index < typed.count - 1, let byte = typed[index].lowercased().utf8.first,
            Self.spaceRowLetters.contains(byte), let center = geometry.center(byte) else { continue }
      // Substitution cost toward the space row, one pitch below the letter's center.
      let drop = (center.y + 1) - (taps[index]?.y ?? center.y)
      consider(0..<index, (index + 1)..<typed.count, cost: 0.8 + 2.4 * drop * drop)
    }
    return best
  }

  private func splitPart(_ text: String) -> (text: String, id: Int?, cost: Double)? {
    let key = TextNormalizer.key(text)
    if key.count == 1, key != "a", key != "i" { return nil }
    guard !personal.isBlocked(text), isValid(text) else { return nil }
    guard let id = lexicon.id(of: text) else {
      return personal.isKnown(text) ? (text, nil, 0) : nil
    }
    let flags = lexicon.flags(id)
    guard !flags.contains(.notAWord), !flags.contains(.neverSuggest),
          lexicon.unigramLogProbability(id) >= Self.minimumSplitPartFamiliarity else { return nil }
    return (Self.matchCase(of: text, to: lexicon.display(id)), id, 0)
  }

  private func correctedSplitPart(_ part: TypedWord, context: LanguageContext) -> (text: String, id: Int?, cost: Double)? {
    let length = TextNormalizer.key(part.text).count
    guard length >= 2 else { return nil }
    let bound = min(SpellCorrector.bound(forLength: length), Self.maximumSplitPartCost)
    var best: (text: String, id: Int?, cost: Double, score: Double)?
    for match in corrector.search(part, maximumCost: bound, prefixCost: 0).words {
      let flags = lexicon.flags(match.id)
      guard !flags.contains(.notAWord), !flags.contains(.neverSuggest),
            lexicon.unigramLogProbability(match.id) >= Self.minimumSplitPartFamiliarity else { continue }
      let display = Self.matchCase(of: part.text, to: lexicon.display(match.id))
      guard !personal.isBlocked(display), TextNormalizer.key(display).count > 1 || ["a", "i"].contains(TextNormalizer.key(display)) else { continue }
      let score = model.logProbability(of: display, id: match.id, in: context) - match.cost
      if score > best?.score ?? -.infinity { best = (display, match.id, match.cost, score) }
    }
    return best.map { ($0.text, $0.id, $0.cost) }
  }

  private func hasPlausibleFinalBrush(_ word: TypedWord) -> Bool {
    let source = word.keyed
    guard source.bytes.count >= 2 else { return false }
    let last = source.bytes.count - 1
    if source.bytes[last] == source.bytes[last - 1] { return true }
    guard let preceding = corrector.geometry.center(source.bytes[last - 1]),
          let suffix = corrector.geometry.center(source.bytes[last]) else { return false }
    // The same neighboring-key radius used by the weighted edit model.
    if preceding.distanceSquared(to: suffix) <= 1.3 { return true }
    return source.taps[last].map { preceding.distanceSquared(to: $0) <= 1.3 } ?? false
  }

  private func hasDirectedSubstitutions(_ source: (bytes: [UInt8], taps: [KeyPoint?]), target: String) -> Bool {
    let destination = Array(target.utf8)
    guard destination.count == source.bytes.count, destination != source.bytes else { return false }
    for index in destination.indices where destination[index] != source.bytes[index] {
      guard let point = source.taps[index], let center = corrector.geometry.center(source.bytes[index]),
            let target = corrector.geometry.center(destination[index]) else { return false }
      let distance = center.distance(to: target)
      let projection = ((point.x - center.x) * (target.x - center.x) +
        (point.y - center.y) * (target.y - center.y)) / distance
      guard projection > 0.4 else { return false }
    }
    return true
  }

  private static func hasSingleInteriorVowelOmission(_ source: String, _ target: String) -> Bool {
    let typed = Array(source.utf8), candidate = Array(target.utf8)
    guard candidate.count == typed.count + 1, typed.count >= 2,
          typed.first == candidate.first, typed.last == candidate.last else { return false }
    for index in 1..<(candidate.count - 1) where "aeiou".utf8.contains(candidate[index]) {
      var removed = candidate
      removed.remove(at: index)
      if removed == typed { return true }
    }
    return false
  }

  private static func isSingleTransposition(_ typed: String, _ target: String) -> Bool {
    let source = Array(typed.utf8), destination = Array(target.utf8)
    guard source.count == destination.count else { return false }
    let changed = source.indices.filter { source[$0] != destination[$0] }
    guard changed.count == 2, changed[1] == changed[0] + 1 else { return false }
    return source[changed[0]] == destination[changed[1]] && source[changed[1]] == destination[changed[0]]
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
