import Foundation

/// The text the keyboard edits. `UITextDocumentProxy` is adapted to this in KeyboardUI.
public protocol TextDocument: AnyObject {
  var documentContextBeforeInput: String? { get }
  var documentContextAfterInput: String? { get }
  var selectedText: String? { get }
  var hasText: Bool { get }
  func insertText(_ text: String)
  func deleteBackward()
}

public enum ShiftState: Equatable, Sendable {
  case off
  /// Capitalizes the next letter. `automatic` when it came from sentence capitalization.
  case once(automatic: Bool)
  case locked

  public var isActive: Bool { self != .off }
}

public enum KeyboardPage: Equatable, Sendable {
  case letters, numbers, symbols
}

/// Owns typing behavior: shift, capitalization, autocorrection and its undo,
/// suggestions, smart punctuation and swipe insertion.
public final class KeyboardEngine {
  public let document: TextDocument
  public let suggester: Suggester?
  public let glide: GlideDecoder?
  public var settings: KeyboardSettings { didSet { policy = InputPolicy(traits: traits, settings: settings) } }
  public var traits = InputTraits() {
    didSet {
      policy = InputPolicy(traits: traits, settings: settings)
      if traits.keyboard == .numbersAndPunctuation { page = .numbers }
    }
  }
  public private(set) var policy: InputPolicy
  public private(set) var shift: ShiftState = .off
  public var page: KeyboardPage = .letters
  /// Computed on first read after an edit, so keystrokes never wait on suggestions.
  public var suggestions: SuggestionSet {
    if suggestionsStale { refreshSuggestions() }
    return storedSuggestions
  }
  private var storedSuggestions = SuggestionSet.empty
  private var suggestionsStale = true
  /// Monotonic time source, injectable for tests.
  public var clock: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }

  enum LastEdit: Equatable {
    case none
    case typed
    case space
    case autocorrected(original: TypedWord, inserted: String, separator: String)
    case acceptedSuggestion(autoSpace: Bool)
    case glided(word: String, alternatives: [String])
  }

  var composing = TypedWord(text: "")
  var lastEdit: LastEdit = .none
  var rejected: Set<String> = []
  /// After a swipe, a space is owed before the next word but not before punctuation.
  public private(set) var phantomSpace = false
  private var lastShiftTap: TimeInterval = -1
  private var shiftHeld = false
  private var typedWhileShiftHeld = false
  private var expectedContext: String?
  private var lastOwnEdit: TimeInterval = -10
  /// Counters for on-device diagnostics; no text is recorded.
  public private(set) var laggingContextUpdates = 0
  public private(set) var externalContextChanges = 0

  public init(document: TextDocument, suggester: Suggester?, glide: GlideDecoder?, settings: KeyboardSettings = KeyboardSettings()) {
    self.document = document
    self.suggester = suggester
    self.glide = glide
    self.settings = settings
    policy = InputPolicy(traits: InputTraits(), settings: settings)
  }

  var personal: PersonalDictionary? { suggester?.model.personal }
  var before: String { document.documentContextBeforeInput ?? "" }

  // MARK: Characters

  static let sentenceEnders: Set<Character> = [".", "!", "?"]
  static let autocorrectSeparators: Set<Character> = [".", ",", "!", "?", ";", ":", ")", "\"", "\u{201D}"]
  static let spaceSwapPunctuation: Set<Character> = [".", ",", "!", "?", ";", ":"]

  static func isWordCharacter(_ character: Character) -> Bool {
    character.isLetter || character.isNumber || character == "'" || character == "\u{2019}"
  }

  /// Types one key. Letters follow the shift state; `tap` feeds the spatial typo model.
  public func insertCharacter(_ key: String, tap: KeyPoint? = nil) {
    guard let first = key.first else { return }
    let isLetter = first.isLetter
    var text = key
    if isLetter, shift.isActive || shiftHeld { text = key.uppercased() }
    if first == "'" || first == "\"", policy.smartQuotes { text = curlyQuote(for: first) }

    if phantomSpace {
      phantomSpace = false
      if Self.isWordCharacter(first) { document.insertText(" ") }
    }
    if case .acceptedSuggestion(autoSpace: true) = lastEdit, Self.spaceSwapPunctuation.contains(first), policy.smartSpacing, before.hasSuffix(" ") {
      document.deleteBackward()
    }

    if !composing.isEmpty, Self.autocorrectSeparators.contains(first) {
      commitComposing(separator: text)
    } else {
      if !composing.isEmpty, !Self.isWordCharacter(Character(String(text.prefix(1)))) { learn(composing.text) }
      document.insertText(text)
      if let typedCharacter = text.first, Self.isWordCharacter(typedCharacter), !(typedCharacter == "\u{2019}" && composing.isEmpty) {
        composing.append(text, tap: tap)
      } else {
        composing = TypedWord(text: "")
      }
      lastEdit = .typed
    }

    if shiftHeld { typedWhileShiftHeld = true }
    if case .once = shift { shift = .off }
    if page != .letters, first == "'" || first == "\u{2019}" { page = .letters }
    finishEdit()
  }

  private func curlyQuote(for straight: Character) -> String {
    let previous = before.last
    let opening = previous == nil || previous!.isWhitespace || "([{\u{201C}\u{2018}-".contains(previous!)
    if straight == "'" { return opening ? "\u{2018}" : "\u{2019}" }
    return opening ? "\u{201C}" : "\u{201D}"
  }

  public func insertSpace() {
    defer {
      if page != .letters { page = .letters }
      finishEdit()
    }
    if phantomSpace {
      phantomSpace = false
      document.insertText(" ")
      lastEdit = .space
      return
    }
    if !composing.isEmpty {
      commitComposing(separator: " ")
      return
    }
    if settings.doubleSpacePeriod, policy.smartSpacing, lastEditEndedWithSpace, before.hasSuffix(" ") {
      let trimmed = before.dropLast()
      if let previous = trimmed.last, previous.isLetter || previous.isNumber || previous == ")" || previous == "\u{201D}" || previous == "\"" {
        document.deleteBackward()
        document.insertText(". ")
        lastEdit = .none
        return
      }
    }
    document.insertText(" ")
    lastEdit = .space
  }

  private var lastEditEndedWithSpace: Bool {
    switch lastEdit {
    case .space: true
    case let .autocorrected(_, _, separator): separator == " "
    default: false
    }
  }

  public func insertReturn() {
    phantomSpace = false
    if !composing.isEmpty {
      commitComposing(separator: "\n")
    } else {
      document.insertText("\n")
    }
    lastEdit = .none
    finishEdit()
  }

  /// Inserts text from outside the key grid (emoji, dictation, `.com`).
  public func insertText(_ text: String, spacing: Bool = false) {
    guard !text.isEmpty else { return }
    if !composing.isEmpty {
      learn(composing.text)
      composing = TypedWord(text: "")
    }
    var output = text
    if spacing || phantomSpace, let previous = before.last, !previous.isWhitespace, !"([{\u{201C}\u{2018}/@#".contains(previous) {
      output = " " + output
    }
    phantomSpace = false
    document.insertText(output)
    lastEdit = .typed
    finishEdit()
  }

  /// Inserts a dictation transcript, joining it naturally with the surrounding text.
  public func insertTranscript(_ transcript: String) {
    var text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    if !atSentenceStart(before), let firstWord = text.split(separator: " ").first.map(String.init),
       firstWord != "I", let lexicon = suggester?.model.lexicon {
      let lowered = firstWord.lowercased()
      if firstWord.first?.isUppercase == true, lexicon.words(forKey: TextNormalizer.key(lowered)).contains(where: { lexicon.display($0) == lowered }) {
        text = lowered + text.dropFirst(firstWord.count)
      }
    }
    insertText(text, spacing: true)
  }

  // MARK: Deletion

  public func deleteBackward() {
    phantomSpace = false
    switch lastEdit {
    case let .autocorrected(original, inserted, separator) where before.hasSuffix(inserted + separator):
      for _ in 0..<(inserted + separator).count { document.deleteBackward() }
      document.insertText(original.text)
      rejected.insert(original.text)
      if policy.learns { personal?.pin(original.text) }
      composing = original
      lastEdit = .none
      finishEdit(deriveComposing: false)
      return
    case let .glided(word, _) where before.hasSuffix(word):
      for _ in 0..<word.count { document.deleteBackward() }
      composing = TypedWord(text: "")
      lastEdit = .none
      finishEdit()
      return
    default:
      break
    }
    if let selected = document.selectedText, !selected.isEmpty {
      document.deleteBackward()
      composing = TypedWord(text: "")
    } else {
      document.deleteBackward()
      if !composing.isEmpty { composing.removeLast() }
    }
    lastEdit = .none
    finishEdit(deriveComposing: composing.isEmpty)
  }

  /// Deletes back to the start of the previous word, as delete-key repeat does once it speeds up.
  public func deleteWordBackward() {
    phantomSpace = false
    let text = before
    guard !text.isEmpty else { return }
    var count = 0
    var index = text.endIndex
    while index > text.startIndex, text[text.index(before: index)].isWhitespace {
      index = text.index(before: index)
      count += 1
    }
    if index > text.startIndex, Self.isWordCharacter(text[text.index(before: index)]) {
      while index > text.startIndex, Self.isWordCharacter(text[text.index(before: index)]) {
        index = text.index(before: index)
        count += 1
      }
    } else if index > text.startIndex {
      count += 1
    }
    for _ in 0..<max(count, 1) { document.deleteBackward() }
    composing = TypedWord(text: "")
    lastEdit = .none
    finishEdit()
  }

  // MARK: Shift

  /// Shift responds on touch down, like the system keyboard.
  public func shiftDown() {
    let now = clock()
    if now - lastShiftTap < 0.35, shift != .locked {
      shift = .locked
      lastShiftTap = -1
    } else {
      switch shift {
      case .off: shift = .once(automatic: false)
      case .once, .locked: shift = .off
      }
      lastShiftTap = now
    }
    shiftHeld = true
    typedWhileShiftHeld = false
  }

  public func shiftUp() {
    shiftHeld = false
    if typedWhileShiftHeld {
      // Shift was used as a chord; letting go ends it.
      if shift != .locked { shift = .off }
      typedWhileShiftHeld = false
      updateAutomaticShift()
    }
  }

  // MARK: Suggestions and swipes

  public func select(_ suggestion: Suggestion) {
    let context = previousWord()
    let needsCase = shift.isActive && composing.isEmpty
    var text = needsCase ? Suggester.matchCase(of: "A", to: suggestion.text) : suggestion.text
    if policy.smartQuotes { text = Self.curlyApostrophes(text) }
    switch suggestion.kind {
    case .alternative:
      if case let .glided(word, alternatives) = lastEdit, before.hasSuffix(word) {
        for _ in 0..<word.count { document.deleteBackward() }
        document.insertText(text)
        learn(text, context: context)
        lastEdit = .glided(word: text, alternatives: alternatives)
        phantomSpace = true
        finishEdit()
        return
      }
    case .literal:
      if !composing.isEmpty {
        rejected.insert(composing.text)
        if policy.learns { personal?.pin(composing.text) }
        document.insertText(" ")
        composing = TypedWord(text: "")
        lastEdit = .acceptedSuggestion(autoSpace: true)
        finishEdit()
        return
      }
    default:
      break
    }
    if !composing.isEmpty {
      for _ in 0..<composing.text.count { document.deleteBackward() }
      composing = TypedWord(text: "")
    } else if let previous = before.last, !previous.isWhitespace, !"([{\u{201C}\u{2018}".contains(previous) {
      text = " " + text
    }
    phantomSpace = false
    document.insertText(text + " ")
    learn(text.trimmingCharacters(in: .whitespaces), context: context)
    lastEdit = .acceptedSuggestion(autoSpace: true)
    if case .once = shift { shift = .off }
    finishEdit()
  }

  /// Decodes a swipe and inserts the best word with automatic spacing.
  @discardableResult
  public func insertGlide(_ points: [KeyPoint]) -> [GlideCandidate] {
    guard let glide else { return [] }
    // Decode before touching the document, so a path that fits no word changes nothing.
    var candidates = glide.decode(points, context: languageContext(), limit: 4)
    guard !candidates.isEmpty else { return [] }
    if !composing.isEmpty {
      commitComposing(separator: " ")
      candidates = glide.decode(points, context: languageContext(), limit: 4)
    }
    guard let best = candidates.first else {
      finishEdit()
      return []
    }
    let transform: (String) -> String = { word in
      switch self.shift {
      case .locked: word.uppercased()
      case .once: Suggester.matchCase(of: "A", to: word)
      case .off: word
      }
    }
    var word = transform(best.text)
    if policy.smartQuotes { word = Self.curlyApostrophes(word) }
    let wordContext = previousWord()
    if let previous = before.last, phantomSpace || (!previous.isWhitespace && !"([{\u{201C}\u{2018}/@#-".contains(previous)) {
      document.insertText(" ")
    }
    document.insertText(word)
    learn(word, context: wordContext)
    let alternatives = candidates.dropFirst().map { candidate -> String in
      let text = transform(candidate.text)
      return policy.smartQuotes ? Self.curlyApostrophes(text) : text
    }
    lastEdit = .glided(word: word, alternatives: alternatives)
    phantomSpace = true
    if case .once = shift { shift = .off }
    finishEdit()
    return candidates
  }

  static func curlyApostrophes(_ text: String) -> String {
    text.replacingOccurrences(of: "'", with: "\u{2019}")
  }

  // MARK: Committing words

  private func commitComposing(separator: String) {
    let typed = composing
    let context = previousWord()
    refreshSuggestions()
    if let replacement = suggestions.autocorrection, replacement != typed.text {
      let inserted = policy.smartQuotes ? Self.curlyApostrophes(replacement) : replacement
      for _ in 0..<typed.text.count { document.deleteBackward() }
      document.insertText(inserted + separator)
      learn(replacement, context: context)
      lastEdit = .autocorrected(original: typed, inserted: inserted, separator: separator)
    } else {
      document.insertText(separator)
      learn(typed.text, context: context)
      lastEdit = separator == " " ? .space : .typed
    }
    composing = TypedWord(text: "")
  }

  /// Records a committed word. `context` is the word before it, taken before the
  /// word's own text changed the document.
  private func learn(_ word: String, context: (word: String?, sentenceStart: Bool)? = nil) {
    guard policy.learns, let personal, let suggester else { return }
    let context = context ?? previousWord()
    let trimmed = word.trimmingCharacters(in: CharacterSet(charactersIn: "'\u{2019}"))
    guard trimmed.count > 1 || trimmed == "I" || trimmed == "a",
          trimmed.allSatisfy({ $0.isLetter || $0 == "'" || $0 == "\u{2019}" }) else { return }
    let normalized = trimmed.replacingOccurrences(of: "\u{2019}", with: "'")
    // A capital from sentence capitalization is not part of the word; elsewhere it marks a name.
    var stored = normalized
    if let first = normalized.first, first.isUppercase, normalized.dropFirst().allSatisfy({ $0.isLowercase }) {
      let lowered = normalized.lowercased()
      if context.sentenceStart ? !suggester.isValid(normalized) || suggester.isValid(lowered) : suggester.isValid(lowered) {
        stored = lowered
      }
    }
    personal.learn(stored, after: context.word)
  }

  // MARK: Context

  /// Re-reads the document after the host changed text or moved the cursor.
  public func documentDidChange() {
    let current = before
    let expected = expectedContext ?? ""
    if current != expected {
      // The proxy can report the document a beat behind our own fast edits. Text that
      // is a prefix of what we just typed is that lag, not the host changing things.
      if !current.isEmpty, clock() - lastOwnEdit < 1, expected.hasPrefix(current) {
        laggingContextUpdates += 1
        return
      }
      // Long documents only expose a window before the cursor, which slides as we type.
      let windowShift = current.count >= 24 && (expected.hasSuffix(current) || current.hasSuffix(expected))
      if !windowShift {
        externalContextChanges += 1
        phantomSpace = false
        lastEdit = .none
        deriveComposing()
      }
      expectedContext = current
    }
    // Traits can arrive after the context, so shift and suggestions are always refreshed.
    updateAutomaticShift()
    suggestionsStale = true
  }

  private func finishEdit(deriveComposing derive: Bool = false) {
    if derive { deriveComposing() }
    updateAutomaticShift()
    suggestionsStale = true
    expectedContext = before
    lastOwnEdit = clock()
  }

  private func deriveComposing() {
    let text = before
    var word = ""
    for character in text.reversed() {
      guard Self.isWordCharacter(character) else { break }
      word.insert(character, at: word.startIndex)
    }
    if composing.text != word { composing = TypedWord(text: word) }
  }

  var cursorInsideWord: Bool {
    guard let next = document.documentContextAfterInput?.first else { return false }
    return Self.isWordCharacter(next)
  }

  func previousWord() -> (word: String?, sentenceStart: Bool) {
    var text = Substring(before)
    text = text.dropLast(composing.text.count)
    while let last = text.last, last.isWhitespace {
      if last.isNewline { return (nil, true) }
      text = text.dropLast()
    }
    guard let last = text.last else { return (nil, true) }
    if Self.sentenceEnders.contains(last) { return (nil, true) }
    while let tail = text.last, !Self.isWordCharacter(tail), tail != "\n" {
      if Self.sentenceEnders.contains(tail) || ";:(\"\u{201C}".contains(tail) { return (nil, tail != ";" && tail != ":") }
      text = text.dropLast()
    }
    var word = ""
    while let tail = text.last, Self.isWordCharacter(tail) {
      word.insert(tail, at: word.startIndex)
      text = text.dropLast()
    }
    return (word.isEmpty ? nil : word.replacingOccurrences(of: "\u{2019}", with: "'"), false)
  }

  func languageContext() -> LanguageContext {
    guard let model = suggester?.model else { return .unknown }
    let previous = previousWord()
    return model.context(previousWord: previous.word, sentenceStart: previous.sentenceStart)
  }

  func atSentenceStart(_ text: String) -> Bool {
    var trimmed = Substring(text)
    var sawSpace = false
    while let last = trimmed.last, last.isWhitespace {
      if last.isNewline { return true }
      sawSpace = true
      trimmed = trimmed.dropLast()
    }
    guard let last = trimmed.last else { return true }
    return sawSpace && Self.sentenceEnders.contains(last)
  }

  public func updateAutomaticShift() {
    if shift == .locked || shiftHeld { return }
    let text = before
    let capitalize: Bool
    switch policy.capitalization {
    case .none:
      capitalize = false
    case .allCharacters:
      capitalize = true
    case .words:
      capitalize = text.isEmpty || text.last!.isWhitespace
    case .sentences:
      capitalize = composing.isEmpty && atSentenceStart(text)
    }
    if capitalize {
      if shift == .off { shift = .once(automatic: true) }
    } else if shift == .once(automatic: true) {
      shift = .off
    }
  }

  public func refreshSuggestions() {
    suggestionsStale = false
    guard policy.showsSuggestions || policy.autocorrects || policy.appliesTextReplacements, let suggester else {
      storedSuggestions = .empty
      return
    }
    if case let .glided(word, alternatives) = lastEdit {
      let ordered = [Suggestion(text: word, kind: .alternative)] + alternatives.prefix(2).map { Suggestion(text: $0, kind: .alternative) }
      storedSuggestions = SuggestionSet(slots: SuggestionSet.centered(ordered))
      return
    }
    if cursorInsideWord {
      storedSuggestions = .empty
      return
    }
    let context = languageContext()
    if composing.isEmpty {
      guard policy.showsSuggestions else {
        storedSuggestions = .empty
        return
      }
      var set = suggester.predictions(context: context)
      if shift.isActive {
        set.slots = set.slots.map { Suggestion(text: shift == .locked ? $0.text.uppercased() : Suggester.matchCase(of: "A", to: $0.text), kind: $0.kind) }
      }
      storedSuggestions = set
      return
    }
    var set = suggester.suggestions(for: composing, context: context, autocorrect: policy.autocorrects, replacements: policy.appliesTextReplacements, rejected: rejected)
    if !policy.showsSuggestions { set.slots = [] }
    storedSuggestions = set
  }

  /// The word currently being typed, for display and tests.
  public var composingText: String { composing.text }

  public var returnKeyEnabled: Bool {
    !traits.enablesReturnKeyAutomatically || document.hasText
  }

  /// Persists learned words; call when the keyboard goes away.
  public func save() {
    personal?.save()
  }
}
