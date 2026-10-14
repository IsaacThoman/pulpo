import Foundation

/// The text the keyboard edits. `UITextDocumentProxy` is adapted to this in KeyboardUI.
public protocol TextDocument: AnyObject {
  /// Stable for one input document, even when another document has identical text.
  var documentIdentifier: UUID? { get }
  var documentContextBeforeInput: String? { get }
  var documentContextAfterInput: String? { get }
  var selectedText: String? { get }
  var hasText: Bool { get }
  func insertText(_ text: String)
  func deleteBackward()
}

extension TextDocument {
  /// Hosts without document identity retain text-based context reconciliation.
  public var documentIdentifier: UUID? { nil }
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
  /// A supported-glyph index, prepared off the typing thread by the host.
  public var emojiSuggester: EmojiSuggester? { didSet { invalidateSuggestionContext() } }
  public var emojiHistory: EmojiHistory? { didSet { invalidateSuggestionContext() } }
  private struct OfferedEmoji {
    let value: String
    let query: String
    let before: String
    let after: String
    let documentID: UUID?
    let appends: Bool
  }
  private var offeredEmoji: OfferedEmoji?
  public var settings: KeyboardSettings {
    didSet {
      policy = InputPolicy(traits: traits, settings: settings)
      if settings != oldValue { invalidateSuggestionContext() }
    }
  }
  public var traits = InputTraits() {
    didSet {
      policy = InputPolicy(traits: traits, settings: settings)
      if traits != oldValue { invalidateSuggestionContext() }
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
  /// The bar updates asynchronously; choices from an earlier edit cannot edit new text.
  private var suggestionContext = UUID()
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
  /// Decoder choices are tentative until the next edit or keyboard dismissal.
  /// Undoing or replacing one must not teach the original mistake.
  private var pendingLearning: (word: String, context: (word: String?, sentenceStart: Bool))?
  /// After a swipe, a space is owed before the next word but not before punctuation.
  public private(set) var phantomSpace = false
  private var lastShiftTap: TimeInterval = -1
  private var shiftHeld = false
  private var typedWhileShiftHeld = false
  /// Optimistic cursor context, updated by our edits before the asynchronous proxy catches up.
  private var expectedContext: String?
  private var expectedDocumentIdentifier: UUID?
  private var expectedAfterContext = ""
  private var expectedSelection: String?
  private struct ContextAvailability: Equatable {
    let before: Bool
    let after: Bool
  }
  private struct ObservedContext: Equatable {
    let before: String?
    let after: String?
    let selection: String?
  }
  private var observedContextAvailability: ContextAvailability?
  private var observedPrivateContext: Bool?
  private var ownEditDepth = 0
  private var recentObservedOwnContexts: [(context: ObservedContext, time: TimeInterval)] = []
  private struct ContextSnapshot: Equatable {
    let before: String
    let after: String
    let selection: String?
  }
  /// Old proxy snapshots can arrive after a replacement has finished. Remember
  /// only recently requested states, rather than treating every prefix as lag.
  private var recentOwnContexts: [(context: ContextSnapshot, time: TimeInterval)] = []
  private var lastSpaceTime: TimeInterval = -.infinity
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
  var before: String { expectedContext ?? document.documentContextBeforeInput ?? "" }

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
    acceptPendingLearning()
    let isLetter = first.isLetter
    var text = key
    if isLetter, shift.isActive || shiftHeld { text = key.uppercased() }
    if first == "'" || first == "\"", policy.smartQuotes { text = curlyQuote(for: first) }

    if phantomSpace {
      phantomSpace = false
      if Self.isWordCharacter(first) { insertDocumentText(" ") }
    }
    if case .acceptedSuggestion(autoSpace: true) = lastEdit, Self.spaceSwapPunctuation.contains(first), policy.smartSpacing, before.hasSuffix(" ") {
      deleteDocumentBackward()
    }

    if !composing.isEmpty, Self.autocorrectSeparators.contains(first) {
      commitComposing(separator: text)
    } else {
      if !composing.isEmpty, !Self.isWordCharacter(Character(String(text.prefix(1)))) { learn(composing.text) }
      insertDocumentText(text)
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
    acceptPendingLearning()
    let now = clock()
    defer {
      lastSpaceTime = now
      if page != .letters { page = .letters }
      finishEdit()
    }
    if phantomSpace {
      phantomSpace = false
      insertDocumentText(" ")
      lastEdit = .space
      return
    }
    if !composing.isEmpty {
      commitComposing(separator: " ")
      return
    }
    if settings.doubleSpacePeriod, policy.smartSpacing, lastEditEndedWithSpace, now - lastSpaceTime < 0.8, before.hasSuffix(" ") {
      let trimmed = before.dropLast()
      if let previous = trimmed.last, previous.isLetter || previous.isNumber || previous == ")" || previous == "\u{201D}" || previous == "\"" {
        deleteDocumentBackward()
        insertDocumentText(". ")
        lastEdit = .none
        return
      }
    }
    insertDocumentText(" ")
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
    acceptPendingLearning()
    phantomSpace = false
    if !composing.isEmpty {
      commitComposing(separator: "\n")
    } else {
      insertDocumentText("\n")
    }
    lastEdit = .none
    finishEdit()
  }

  /// Inserts text from outside the key grid (emoji, dictation, `.com`).
  public func insertText(_ text: String, spacing: Bool = false) {
    guard !text.isEmpty else { return }
    acceptPendingLearning()
    if !composing.isEmpty {
      learn(composing.text)
      composing = TypedWord(text: "")
    }
    var output = text
    if spacing || phantomSpace, let previous = before.last, !previous.isWhitespace, !"([{\u{201C}\u{2018}/@#".contains(previous) {
      output = " " + output
    }
    phantomSpace = false
    insertDocumentText(output)
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
    pendingLearning = nil
    phantomSpace = false
    switch lastEdit {
    case let .autocorrected(original, inserted, separator) where before.hasSuffix(inserted + separator):
      for _ in 0..<(inserted + separator).count { deleteDocumentBackward() }
      insertDocumentText(original.text)
      rejected.insert(original.text)
      if policy.learns { personal?.pin(original.text) }
      composing = original
      lastEdit = .none
      finishEdit(deriveComposing: false)
      return
    case let .glided(word, _) where before.hasSuffix(word):
      for _ in 0..<word.count { deleteDocumentBackward() }
      composing = TypedWord(text: "")
      lastEdit = .none
      finishEdit()
      return
    default:
      break
    }
    if let selected = document.selectedText, !selected.isEmpty {
      deleteDocumentBackward()
      composing = TypedWord(text: "")
    } else {
      deleteDocumentBackward()
      if !composing.isEmpty { composing.removeLast() }
    }
    lastEdit = .none
    finishEdit(deriveComposing: composing.isEmpty)
  }

  /// Deletes back to the start of the previous word, as delete-key repeat does once it speeds up.
  public func deleteWordBackward() {
    pendingLearning = nil
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
    for _ in 0..<max(count, 1) { deleteDocumentBackward() }
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
    // Host edits can precede their text-change callback. Reconcile displayed
    // choices before trusting their generation, preserving known own-edit lag.
    if suggestion.sourceContext != nil { documentDidChange() }
    if suggestion.kind == .emoji {
      selectEmoji(suggestion)
      return
    }
    guard suggestion.sourceContext == nil || suggestion.sourceContext == suggestionContext else { return }
    let context = previousWord()
    let needsCase = shift.isActive && composing.isEmpty
    var text = needsCase ? Suggester.matchCase(of: "A", to: suggestion.text) : suggestion.text
    if policy.smartQuotes { text = Self.curlyApostrophes(text) }
    switch suggestion.kind {
    case .alternative:
      guard case let .glided(word, alternatives) = lastEdit, before.hasSuffix(word) else { return }
      let originalContext = pendingLearning?.context ?? context
      for _ in 0..<word.count { deleteDocumentBackward() }
      insertDocumentText(text)
      pendingLearning = (text, originalContext)
      lastEdit = .glided(word: text, alternatives: alternatives)
      phantomSpace = true
      finishEdit()
      return
    case .literal:
      if !composing.isEmpty {
        rejected.insert(composing.text)
        if policy.learns { personal?.pin(composing.text) }
        insertDocumentText(" ")
        composing = TypedWord(text: "")
        lastEdit = .acceptedSuggestion(autoSpace: true)
        finishEdit()
        return
      }
    default:
      break
    }
    acceptPendingLearning()
    if !composing.isEmpty {
      for _ in 0..<composing.text.count { deleteDocumentBackward() }
      composing = TypedWord(text: "")
    } else if let previous = before.last, !previous.isWhitespace, !"([{\u{201C}\u{2018}".contains(previous) {
      text = " " + text
    }
    phantomSpace = false
    insertDocumentText(text + " ")
    learn(text.trimmingCharacters(in: .whitespaces), context: context)
    lastEdit = .acceptedSuggestion(autoSpace: true)
    if case .once = shift { shift = .off }
    finishEdit()
  }

  /// Decodes a swipe and inserts the best word with automatic spacing.
  @discardableResult
  public func insertGlide(_ points: [KeyPoint]) -> [GlideCandidate] {
    guard policy.allowsGlide, let glide else { return [] }
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
    acceptPendingLearning()
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
      insertDocumentText(" ")
    }
    insertDocumentText(word)
    pendingLearning = (word, wordContext)
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
    let literalToken = composingLiteralToken
    refreshSuggestions()
    if let replacement = suggestions.autocorrection, replacement != typed.text {
      let inserted = policy.smartQuotes ? Self.curlyApostrophes(replacement) : replacement
      for _ in 0..<typed.text.count { deleteDocumentBackward() }
      insertDocumentText(inserted + separator)
      pendingLearning = (replacement, context)
      lastEdit = .autocorrected(original: typed, inserted: inserted, separator: separator)
    } else {
      insertDocumentText(separator)
      if !literalToken { learn(typed.text, context: context) }
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

  private func acceptPendingLearning() {
    guard let pending = pendingLearning else { return }
    pendingLearning = nil
    learn(pending.word, context: pending.context)
  }

  // MARK: Context

  /// Re-reads the document after the host changed text or moved the cursor.
  public func documentDidChange() {
    let identifier = document.documentIdentifier
    let rawBefore = document.documentContextBeforeInput
    let rawAfter = document.documentContextAfterInput
    let current = rawBefore ?? ""
    let after = rawAfter ?? ""
    let selection = document.selectedText.flatMap { $0.isEmpty ? nil : $0 }
    let availability = ContextAvailability(before: rawBefore != nil, after: rawAfter != nil)
    let availabilityChanged = observedContextAvailability.map { $0 != availability } ?? false
    let privacyChanged = observedPrivateContext.map { $0 != traits.isPrivate } ?? false
    observedContextAvailability = availability
    observedPrivateContext = traits.isPrivate
    let now = clock()
    recentObservedOwnContexts.removeAll { now - $0.time >= 1 }
    let matchesExpected = current == expectedContext && after == expectedAfterContext && selection == expectedSelection
    let observed = ObservedContext(before: rawBefore, after: rawAfter, selection: selection)
    // UIKit can represent a natural empty cursor edge as nil. Preserve exact
    // acknowledgments and raw states observed around our own edits; a new loss
    // of visibility otherwise invalidates the old document's reversible state.
    let visibilityChanged = availabilityChanged && !matchesExpected &&
      !recentObservedOwnContexts.contains(where: { $0.context == observed })
    if identifier != expectedDocumentIdentifier || privacyChanged || visibilityChanged {
      expectedDocumentIdentifier = identifier
      if expectedContext != nil { externalContextChanges += 1 }
      invalidateSuggestionContext()
      // A different field or privacy context can match a prior snapshot. Its
      // edits must never inherit the previous field's undo, spacing, or learning.
      expectedContext = nil
      recentOwnContexts.removeAll()
      recentObservedOwnContexts.removeAll()
      phantomSpace = false
      lastEdit = .none
      pendingLearning = nil
      rejected.removeAll()
      composing = TypedWord(text: "")
    }
    if let expected = expectedContext {
      let sameCursorTail = after == expectedAfterContext && selection == expectedSelection
      if current != expected || !sameCursorTail {
        // Match both sides of the cursor and selection so an external cursor
        // move cannot be confused with a delayed snapshot of one of our edits.
        let now = clock()
        recentOwnContexts.removeAll { now - $0.time >= 1 }
        let observed = ContextSnapshot(before: current, after: after, selection: selection)
        // A truly cleared field takes precedence over an earlier empty snapshot.
        if (!current.isEmpty || document.hasText || ownEditDepth > 0), recentOwnContexts.contains(where: { $0.context == observed }) {
          laggingContextUpdates += 1
          return
        }
        // Long documents only expose a window before the cursor, which slides as
        // we type. An empty expected context cannot establish a shared window.
        let windowShift = sameCursorTail && !expected.isEmpty && current.count >= 24
          && (expected.hasSuffix(current) || current.hasSuffix(expected))
        expectedContext = current
        expectedAfterContext = after
        expectedSelection = selection
        if !windowShift {
          invalidateSuggestionContext()
          externalContextChanges += 1
          recentOwnContexts.removeAll()
          recentObservedOwnContexts.removeAll()
          phantomSpace = false
          lastEdit = .none
          pendingLearning = nil
          deriveComposing()
        }
      }
    } else {
      expectedContext = current
      expectedAfterContext = after
      expectedSelection = selection
      deriveComposing()
    }
    // Traits can arrive after the context, so shift and suggestions are always refreshed.
    updateAutomaticShift()
    suggestionsStale = true
  }

  /// Keep reads during multi-step replacements and delayed proxy callbacks on
  /// the document we have requested, rather than an earlier host snapshot.
  private func insertDocumentText(_ text: String) {
    prepareExpectedContext()
    rememberOwnContext()
    expectedContext = before + text
    expectedSelection = nil
    ownEditDepth += 1
    defer { ownEditDepth -= 1 }
    document.insertText(text)
  }

  private func deleteDocumentBackward() {
    prepareExpectedContext()
    rememberOwnContext()
    if expectedSelection == nil { expectedContext = String(before.dropLast()) }
    expectedSelection = nil
    ownEditDepth += 1
    defer { ownEditDepth -= 1 }
    document.deleteBackward()
  }

  private func prepareExpectedContext() {
    guard expectedContext == nil else { return }
    expectedDocumentIdentifier = document.documentIdentifier
    let rawBefore = document.documentContextBeforeInput
    let rawAfter = document.documentContextAfterInput
    observedContextAvailability = ContextAvailability(before: rawBefore != nil, after: rawAfter != nil)
    observedPrivateContext = traits.isPrivate
    expectedContext = rawBefore ?? ""
    expectedAfterContext = rawAfter ?? ""
    expectedSelection = document.selectedText.flatMap { $0.isEmpty ? nil : $0 }
  }

  private func rememberOwnContext() {
    let now = clock()
    recentOwnContexts.removeAll { now - $0.time >= 1 }
    recentOwnContexts.append((ContextSnapshot(before: before, after: expectedAfterContext, selection: expectedSelection), now))
    recentObservedOwnContexts.removeAll { now - $0.time >= 1 }
    recentObservedOwnContexts.append((ObservedContext(
      before: document.documentContextBeforeInput, after: document.documentContextAfterInput,
      selection: document.selectedText.flatMap { $0.isEmpty ? nil : $0 }), now))
    if recentOwnContexts.count > 64 { recentOwnContexts.removeFirst(recentOwnContexts.count - 64) }
    if recentObservedOwnContexts.count > 64 { recentObservedOwnContexts.removeFirst(recentObservedOwnContexts.count - 64) }
  }

  private func invalidateSuggestionContext() {
    suggestionContext = UUID()
    suggestionsStale = true
  }

  private func finishEdit(deriveComposing derive: Bool = false) {
    invalidateSuggestionContext()
    if derive { deriveComposing() }
    updateAutomaticShift()
    suggestionsStale = true
  }

  private func deriveComposing() {
    let text = expectedSelection == nil ? before : ""
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

  /// Addresses, handles and code identifiers also occur inside ordinary chat
  /// fields. Their fragments must not be treated as prose at punctuation.
  var composingLiteralToken: Bool {
    guard !composing.isEmpty, let token = before.split(whereSeparator: \.isWhitespace).last else { return false }
    let lowered = token.lowercased()
    return token.contains("@") || token.hasPrefix("#") || token.contains("_")
      || token.contains("://") || lowered.hasPrefix("www.")
      || ["http", "https", "ftp", "mailto"].contains(lowered)
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
    // Read the preceding word from the same cursor window. Sentence punctuation
    // ends the history, so predictions never borrow context from another sentence.
    var prefix = before.dropLast(composing.text.count)
    while let last = prefix.last, !Self.isWordCharacter(last) { prefix = prefix.dropLast() }
    if let word = previous.word { prefix = prefix.dropLast(word.count) }
    while let last = prefix.last, last.isWhitespace && !last.isNewline { prefix = prefix.dropLast() }
    var preceding = ""
    while let last = prefix.last, Self.isWordCharacter(last) {
      preceding.insert(last, at: preceding.startIndex)
      prefix = prefix.dropLast()
    }
    return model.context(previousWord: previous.word, sentenceStart: previous.sentenceStart,
                         precedingWord: preceding.isEmpty ? nil : preceding.replacingOccurrences(of: "\u{2019}", with: "'"))
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
    defer {
      offerEmojiSuggestion()
      for index in storedSuggestions.slots.indices {
        storedSuggestions.slots[index].sourceContext = suggestionContext
      }
    }
    guard policy.showsSuggestions || policy.autocorrects || policy.appliesTextReplacements else {
      storedSuggestions = .empty
      return
    }
    if cursorInsideWord || expectedSelection != nil {
      storedSuggestions = .empty
      return
    }
    if case let .glided(word, alternatives) = lastEdit {
      guard policy.showsSuggestions else {
        storedSuggestions = .empty
        return
      }
      let ordered = [Suggestion(text: word, kind: .alternative)] + alternatives.prefix(2).map { Suggestion(text: $0, kind: .alternative) }
      storedSuggestions = SuggestionSet(slots: SuggestionSet.centered(ordered))
      return
    }
    if composingLiteralToken {
      storedSuggestions = policy.showsSuggestions ? SuggestionSet(slots: [Suggestion(text: composing.text, kind: .literal)]) : .empty
      return
    }
    guard let suggester else {
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

  /// Keep a word's literal and automatic correction available. Emoji occupy only
  /// the weakest remaining slot and require a tap; space still commits the word.
  private func offerEmojiSuggestion() {
    offeredEmoji = nil
    guard policy.showsSuggestions, !cursorInsideWord, expectedSelection == nil,
          !composingLiteralToken, let emojiSuggester else { return }
    let current = before
    let appends = composing.isEmpty && current.last == " "
    var text = current
    if appends {
      while text.last == " " { text.removeLast() }
    }
    guard let last = text.last, last.isLetter,
          let token = text.split(whereSeparator: \.isWhitespace).last,
          !token.contains(where: { "@#_/\\.:=+0123456789-".contains($0) }) else { return }
    // Search only the current phrase, bounded to eight words / eighty characters.
    // Longest matching suffix permits "red heart" without consuming "I want".
    let phrase = String(text.suffix(81).reversed().prefix(while: {
      $0.isLetter || $0 == " " || $0 == "'" || $0 == "\u{2019}"
    }).reversed())
    let words = phrase.split(separator: " ")
    guard !words.isEmpty else { return }
    for start in max(0, words.count - 8)..<words.count {
      let query = String(phrase[words[start].startIndex...])
      guard query.count <= 80,
            let emoji = emojiSuggester.suggestions(for: query, limit: 1).first else { continue }
      let value = emojiHistory?.preferred(for: emoji) ?? emoji.value
      let suggestion = Suggestion(text: value, kind: .emoji, accessibilityLabel: "\(emoji.name) emoji")
      if storedSuggestions.slots.count < 3 {
        storedSuggestions.slots.append(suggestion)
      } else if let index = storedSuggestions.slots.indices.reversed().first(where: {
        storedSuggestions.slots[$0].kind != .literal && !storedSuggestions.slots[$0].isAutocorrection && $0 != 1
      }) {
        storedSuggestions.slots[index] = suggestion
      } else { return }
      offeredEmoji = OfferedEmoji(value: value, query: query, before: current,
                                  after: expectedAfterContext, documentID: expectedDocumentIdentifier,
                                  appends: appends)
      return
    }
  }

  private func selectEmoji(_ suggestion: Suggestion) {
    guard suggestion.sourceContext == suggestionContext,
          let offered = offeredEmoji, suggestion.text == offered.value,
          policy.showsSuggestions, !cursorInsideWord, expectedSelection == nil,
          before == offered.before, expectedAfterContext == offered.after,
          document.documentIdentifier == offered.documentID else { return }
    if !offered.appends {
      guard before.hasSuffix(offered.query) else { return }
      for _ in offered.query { deleteDocumentBackward() }
    }
    pendingLearning = nil
    composing = TypedWord(text: "")
    insertDocumentText(offered.value)
    emojiHistory?.use(offered.value)
    phantomSpace = true
    lastEdit = .acceptedSuggestion(autoSpace: false)
    if case .once = shift { shift = .off }
    finishEdit()
  }

  /// The word currently being typed, for display and tests.
  public var composingText: String { composing.text }

  public var returnKeyEnabled: Bool {
    !traits.enablesReturnKeyAutomatically || document.hasText
  }

  /// Persists learned words; call when the keyboard goes away.
  public func save() {
    acceptPendingLearning()
    personal?.save()
  }
}
