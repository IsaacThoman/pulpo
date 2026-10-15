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
  /// A supported-glyph index, prepared off the typing thread by the host. It can
  /// land between a bar refresh and a tap; it changes what may be offered next,
  /// not what the displayed choices would do to the text, so they stay current.
  public var emojiSuggester: EmojiSuggester? { didSet { suggestionsStale = true } }
  public var emojiHistory: EmojiHistory? { didSet { suggestionsStale = true } }
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
      let previous = policy
      policy = InputPolicy(traits: traits, settings: settings)
      // Hosts re-send traits with text callbacks. Appearance or return-key
      // changes leave the policy, and so the displayed choices, as they were.
      if policy != previous || traits.isPrivate != oldValue.isPrivate { invalidateSuggestionContext() }
      if traits != oldValue { suggestionsStale = true }
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
    /// A space tap read as the bottom-row letter it landed near: `original` was
    /// replaced by `inserted`; `composing` is what to resume after an undo.
    case joinedSpaceSlip(original: String, inserted: String, separator: String, composing: TypedWord)
    case acceptedSuggestion(autoSpace: Bool)
    case glided(Glide)
  }

  /// A swiped word as inserted, with the bar's other readings of the same path.
  struct Glide: Equatable {
    /// Inserted forms, after Shift and smart quotes.
    var word: String
    var alternatives: [String]
    /// The decoder's spelling of each inserted form. Learning keeps it: a capital
    /// from Shift or a sentence start is not part of the word, a proper noun's is.
    var spellings: [String: String]
    /// A space was typed after the word because another word follows the cursor.
    var spaced: Bool
    /// Where the swipe began and ended, in letter-geometry units.
    var start: KeyPoint
    var end: KeyPoint

    /// The text the swipe left before the cursor.
    var text: String { spaced ? word + " " : word }
  }

  var composing = TypedWord(text: "")
  var lastEdit: LastEdit = .none
  /// A space tap close enough to the bottom letter row that it may have been a
  /// letter. Valid only while the text before the cursor is `anchor` plus the
  /// word being composed; replacing from offset `keep` reads it as one word.
  struct SpaceSlip {
    let point: KeyPoint
    /// The word the slip committed, as typed and as inserted. Nil when the slip
    /// followed an intended space and came before the next word.
    let first: TypedWord?
    let firstText: String?
    let context: LanguageContext
    let learningContext: (word: String?, sentenceStart: Bool)
    let anchor: String
    let keep: Int
    /// Text inserted ahead of the joined word: the intended space a double-space
    /// period turned into ". ".
    let prefix: String
    let periodInserted: Bool
  }
  var spaceSlip: SpaceSlip?
  var rejected: Set<String> = []
  /// Decoder choices are tentative until the next edit or keyboard dismissal.
  /// Undoing or replacing one must not teach the original mistake. A `verbatim`
  /// word is learned with its own capitalization.
  private var pendingLearning: (word: String, context: (word: String?, sentenceStart: Bool), verbatim: Bool)?
  /// The taps behind a pending autocorrection, learned as aimed at its letters once kept.
  private var pendingTouch: (typed: TypedWord, intended: String)?
  /// An autocorrection a swipe applied to the word typed before it, as a space
  /// would have. It is learned when the swipe is, and deleting the swipe makes
  /// it undoable again.
  private struct CorrectionBeforeGlide {
    let edit: LastEdit
    let learning: (word: String, context: (word: String?, sentenceStart: Bool), verbatim: Bool)?
    let touch: (typed: TypedWord, intended: String)?
  }
  private var correctionBeforeGlide: CorrectionBeforeGlide?
  /// Swiped words the person deleted or replaced, counted by the word before
  /// them. A word rejected `glideRejectionLimit` times in one context stops
  /// winning there and is offered as the first alternative instead. Kept for
  /// the keyboard's lifetime only, and never recorded in private fields.
  private var rejectedGlides: [String: Int] = [:]
  static let glideRejectionLimit = 2
  /// A swipe the person deleted, until the next word is committed in its place.
  /// Typing a word there that the decoder could not have produced, starting and
  /// ending where the swipe did, makes that word swipeable at once instead of
  /// after a second use: the person has shown it is what they swipe.
  private struct DeletedGlide {
    let anchor: String
    let start: KeyPoint
    let end: KeyPoint
  }
  private var deletedGlide: DeletedGlide?
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
  /// Earlier states of our own edits, regardless of age, numbered in the order
  /// they were reached. Polling the proxy never treats a return to one of them
  /// as external: only host callbacks decide that.
  private var ownContextHistory: [(context: ContextSnapshot, sequence: Int)] = []
  /// Primitive edits made so far, which is also the number of the state the
  /// latest one requested.
  private var ownEditSequence = 0
  private var lastOwnEditTime: TimeInterval = -.infinity
  /// The latest of our own states a host callback has reported. A host that
  /// reports our edits as it applies them falls behind on a loaded device, and
  /// its late reports then move forward through our states, seconds after the
  /// keys. A host that never reported our edits is held to the one-second rule:
  /// a report of an earlier state from it is far more likely an undo.
  private var echoedOwnSequence: Int?
  static let echoingHostLagLimit: TimeInterval = 4
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
  /// Closing quotes and brackets can follow a sentence's end: `He said “Hi.” Then`.
  static let sentenceClosers: Set<Character> = [")", "]", "}", "\"", "'", "\u{201D}", "\u{2019}"]
  static let sentenceOpeners: Set<Character> = ["(", "[", "{", "\"", "'", "\u{201C}", "\u{2018}"]
  static let autocorrectSeparators: Set<Character> = [".", ",", "!", "?", ";", ":", ")", "\"", "\u{201D}"]
  static let spaceSwapPunctuation: Set<Character> = [".", ",", "!", "?", ";", ":"]
  /// Roughly the few hundred most frequent words: "you", "like", "from", "good".
  static let commonWordLogProbability = -8.0

  static func isWordCharacter(_ character: Character) -> Bool {
    character.isLetter || character.isNumber || character == "'" || character == "\u{2019}"
  }

  /// Types one key. Letters follow the shift state; `tap` feeds the spatial typo model.
  public func insertCharacter(_ key: String, tap: KeyPoint? = nil) {
    guard let first = key.first else { return }
    reconcilePendingHostChanges()
    acceptPendingLearning()
    let isLetter = first.isLetter
    var text = key
    if first == "'" || first == "\"", policy.smartQuotes { text = curlyQuote(for: first) }

    if phantomSpace {
      phantomSpace = false
      // An apostrophe joins the swiped word, as in Gboard: "dog" + 's -> dog's.
      if Self.isWordCharacter(first), first != "'", first != "\u{2019}" {
        insertDocumentText(" ")
        // The owed space starts a word, which can change word capitalization.
        updateAutomaticShift()
      }
    }
    if isLetter, shift.isActive || shiftHeld { text = key.uppercased() }
    if case .acceptedSuggestion(autoSpace: true) = lastEdit, Self.spaceSwapPunctuation.contains(first), policy.smartSpacing, before.hasSuffix(" ") {
      deleteDocumentBackward()
    }
    // Punctuation after a word swiped in front of another moves its space along:
    // "Hello |world" + swipe + "," -> Hello big, world
    var respace = false
    if case let .glided(glide) = lastEdit, glide.spaced, Self.spaceSwapPunctuation.contains(first), policy.smartSpacing, before.hasSuffix(glide.text) {
      deleteDocumentBackward()
      respace = true
    }

    let slip = spaceSlip
    spaceSlip = nil
    if !composing.isEmpty, Self.autocorrectSeparators.contains(first) {
      if let slip, joinSpaceSlip(slip, separator: text) {} else { commitComposing(separator: text) }
    } else {
      if !composing.isEmpty, !Self.isWordCharacter(Character(String(text.prefix(1)))) { learn(composing.text) }
      // Text inserted outside the key grid, or left by a deletion, can end in a word
      // the composition does not track. Continue that word rather than starting a
      // fragment that a correction would replace on its own.
      if composing.isEmpty, Self.isWordCharacter(first), Self.endsInsideWord(before) {
        // A replaced selection also continues the word before it.
        composing = TypedWord(text: Self.trailingWord(of: before))
      }
      insertDocumentText(text)
      if let typedCharacter = text.first, Self.isWordCharacter(typedCharacter), !(typedCharacter == "\u{2019}" && composing.isEmpty) {
        composing.append(text, tap: tap)
      } else {
        composing = TypedWord(text: "")
      }
      lastEdit = .typed
      if let slip, Self.isWordCharacter(first), before == slip.anchor + composing.text { spaceSlip = slip }
    }
    if respace { insertDocumentText(" ") }

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

  /// - Parameter tap: Where the space bar was touched, in the letter geometry's
  ///   units. A touch at its top edge may have been a bottom-row letter.
  public func insertSpace(tap: KeyPoint? = nil) {
    reconcilePendingHostChanges()
    acceptPendingLearning()
    let now = clock()
    let slip = spaceSlip
    spaceSlip = nil
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
    // Only a tap the letter row could have produced is worth remembering.
    let slipPoint = tap.flatMap { point in policy.autocorrects && suggester?.spaceSlipLetter(at: point) != nil ? point : nil }
    if !composing.isEmpty {
      if let slip, joinSpaceSlip(slip, separator: " ") { return }
      let first = composing
      let context = languageContext()
      let learningContext = previousWord()
      let literal = composingLiteralToken
      commitComposing(separator: " ")
      var inserted = first.text
      if case let .autocorrected(_, text, _) = lastEdit { inserted = text }
      guard !literal, before.hasSuffix(inserted + " ") else { return }
      let start = before.count - inserted.count - 1
      if let slipPoint {
        spaceSlip = SpaceSlip(point: slipPoint, first: first, firstText: inserted.replacingOccurrences(of: "\u{2019}", with: "'"),
                              context: context, learningContext: learningContext, anchor: before, keep: start, prefix: "", periodInserted: false)
      }
      return
    }
    // Two spaces in a row: the first may have been the word's last letter.
    if let slip, slip.first != nil, before == slip.anchor, joinSpaceSlip(slip, separator: " ") { return }
    let followsSpace = lastEditEndedWithSpace && before.hasSuffix(" ") && before.dropLast().last?.isLetter == true
    let leadingContext = followsSpace ? languageContext() : nil
    let leadingLearning = previousWord()
    if settings.doubleSpacePeriod, policy.smartSpacing, lastEditEndedWithSpace, now - lastSpaceTime < 0.8, before.hasSuffix(" ") {
      let trimmed = before.dropLast()
      if let previous = trimmed.last, previous.isLetter || previous.isNumber || previous == ")" || previous == "\u{201D}" || previous == "\"" {
        deleteDocumentBackward()
        insertDocumentText(". ")
        lastEdit = .none
        if let slipPoint, let leadingContext {
          spaceSlip = SpaceSlip(point: slipPoint, first: nil, firstText: nil, context: leadingContext, learningContext: leadingLearning,
                                anchor: before, keep: before.count - 2, prefix: " ", periodInserted: true)
        }
        return
      }
    }
    insertDocumentText(" ")
    lastEdit = .space
    if let slipPoint, let leadingContext {
      spaceSlip = SpaceSlip(point: slipPoint, first: nil, firstText: nil, context: leadingContext, learningContext: leadingLearning,
                            anchor: before, keep: before.count - 1, prefix: "", periodInserted: false)
    }
  }

  /// Reads the remembered space tap as a bottom-row letter when the joined word
  /// clearly beats the words as typed ("ha e" -> have). Undo restores them.
  private func joinSpaceSlip(_ slip: SpaceSlip, separator: String) -> Bool {
    guard let suggester, policy.autocorrects, expectedSelection == nil, !cursorInsideWord,
          slip.keep >= 0, slip.keep <= before.count else { return false }
    let second: TypedWord? = composing.isEmpty ? nil : composing
    if let second {
      guard before == slip.anchor + second.text, !rejected.contains(second.text), !composingLiteralToken else { return false }
    } else {
      guard slip.first != nil, before == slip.anchor else { return false }
    }
    var secondText: String?
    if second != nil {
      refreshSuggestions()
      secondText = (suggestions.autocorrection ?? composing.text).replacingOccurrences(of: "\u{2019}", with: "'")
    }
    guard let joined = suggester.spaceSlipJoin(first: slip.first, firstText: slip.firstText, slip: slip.point, second: second, secondText: secondText,
                                               context: slip.context, uncapitalize: slip.periodInserted) else { return false }
    let original = String(before.dropFirst(slip.keep))
    var text = joined.text
    if policy.smartQuotes { text = Self.curlyApostrophes(text) }
    let inserted = slip.prefix + text
    for _ in 0..<original.count { deleteDocumentBackward() }
    insertDocumentText(inserted + separator)
    pendingLearning = (joined.text, slip.learningContext, false)
    pendingTouch = nil
    lastEdit = .joinedSpaceSlip(original: original, inserted: inserted, separator: separator, composing: second ?? TypedWord(text: ""))
    composing = TypedWord(text: "")
    return true
  }

  private var lastEditEndedWithSpace: Bool {
    switch lastEdit {
    case .space: true
    case let .autocorrected(_, _, separator): separator == " "
    case let .joinedSpaceSlip(_, _, separator, _): separator == " "
    default: false
    }
  }

  public func insertReturn() {
    reconcilePendingHostChanges()
    spaceSlip = nil
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
    reconcilePendingHostChanges()
    spaceSlip = nil
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
    reconcilePendingHostChanges()
    spaceSlip = nil
    pendingLearning = nil
    phantomSpace = false
    let correction = correctionBeforeGlide
    correctionBeforeGlide = nil
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
    case let .joinedSpaceSlip(original, inserted, separator, resumed) where before.hasSuffix(inserted + separator):
      for _ in 0..<(inserted + separator).count { deleteDocumentBackward() }
      insertDocumentText(original)
      composing = resumed.isEmpty || !before.hasSuffix(resumed.text) ? TypedWord(text: "") : resumed
      if !resumed.isEmpty { rejected.insert(resumed.text) }
      lastEdit = .none
      finishEdit(deriveComposing: composing.isEmpty)
      return
    case let .glided(glide) where before.hasSuffix(glide.text):
      for _ in 0..<glide.text.count { deleteDocumentBackward() }
      composing = TypedWord(text: "")
      rejectGlide(glide.word, context: previousWord())
      deletedGlide = DeletedGlide(anchor: before, start: glide.start, end: glide.end)
      lastEdit = .none
      // The swipe had committed and corrected the word typed before it; with the
      // swipe gone, the next delete undoes that correction, as after a space.
      if let correction, case let .autocorrected(_, inserted, separator) = correction.edit, before.hasSuffix(inserted + separator) {
        lastEdit = correction.edit
        pendingLearning = correction.learning
        pendingTouch = correction.touch
      }
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
    reconcilePendingHostChanges()
    spaceSlip = nil
    pendingLearning = nil
    correctionBeforeGlide = nil
    phantomSpace = false
    if expectedSelection != nil || document.selectedText?.isEmpty == false {
      // Like Backspace, a selection is the whole deletion.
      deleteDocumentBackward()
      composing = TypedWord(text: "")
      lastEdit = .none
      finishEdit()
      return
    }
    let text = before
    guard !text.isEmpty else { return }
    let count = Self.wordDeletionLength(in: Substring(text))
    for _ in 0..<max(count, 1) { deleteDocumentBackward() }
    composing = TypedWord(text: "")
    lastEdit = .none
    finishEdit()
  }

  /// Characters one word deletion removes from the end of `text`: trailing
  /// spaces, then a word, or a single punctuation mark when no word precedes.
  static func wordDeletionLength(in text: Substring) -> Int {
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
    return count
  }

  /// The text before the cursor that `count` word deletions would remove.
  static func wordDeletionSuffix(of text: String, words count: Int) -> Substring {
    var remaining = Substring(text)
    for _ in 0..<max(count, 0) {
      let length = wordDeletionLength(in: remaining)
      guard length > 0 else { break }
      remaining = remaining.dropLast(length)
    }
    return text[remaining.endIndex...]
  }

  /// Text a delete-key swipe would remove, for previewing before the finger lifts.
  public func wordDeletionPreview(words count: Int) -> String {
    String(Self.wordDeletionSuffix(of: before, words: count))
  }

  /// The text before the cursor as the engine currently understands it.
  public var contextBeforeCursor: String { before }

  /// Whether the next delete would act on the last edit as a whole: undo an
  /// autocorrection or remove a swiped word. A delete-key swipe must not do either.
  public var deleteUndoesLastEdit: Bool {
    switch lastEdit {
    case let .autocorrected(_, inserted, separator): before.hasSuffix(inserted + separator)
    case let .joinedSpaceSlip(_, inserted, separator, _): before.hasSuffix(inserted + separator)
    case let .glided(glide): before.hasSuffix(glide.text)
    default: false
    }
  }

  /// Text removed by a delete-key swipe, which can be put back while the cursor
  /// stays where the deletion left it.
  public struct WordDeletion: Equatable, Sendable {
    public let removed: String
    let remaining: String
    let documentID: UUID?
  }

  /// Deletes `count` words before the cursor in one step. `originalContext` is
  /// the text before the cursor when the gesture began, so a character the
  /// delete key already removed on touch down is restored by undo as well.
  @discardableResult
  public func deleteWordsBackward(_ count: Int, originalContext: String? = nil) -> WordDeletion? {
    reconcilePendingHostChanges()
    let start = before
    let length = Self.wordDeletionSuffix(of: start, words: count).count
    guard length > 0 else { return nil }
    pendingLearning = nil
    correctionBeforeGlide = nil
    spaceSlip = nil
    phantomSpace = false
    for _ in 0..<length { deleteDocumentBackward() }
    composing = TypedWord(text: "")
    lastEdit = .none
    finishEdit(deriveComposing: true)
    let remaining = before
    var removed = String(start.suffix(length))
    if let original = originalContext, original.count > remaining.count, original.hasPrefix(remaining) {
      removed = String(original.dropFirst(remaining.count))
    }
    return WordDeletion(removed: removed, remaining: remaining, documentID: document.documentIdentifier)
  }

  /// Whether `deletion` can still be undone: same document, cursor unmoved.
  public func canUndo(_ deletion: WordDeletion) -> Bool {
    deletion.documentID == document.documentIdentifier && before == deletion.remaining
      && expectedSelection == nil
  }

  /// Puts back the text a delete-key swipe removed. Returns false, changing
  /// nothing, if the text or cursor changed since.
  @discardableResult
  public func undo(_ deletion: WordDeletion) -> Bool {
    reconcilePendingHostChanges()
    guard canUndo(deletion), !deletion.removed.isEmpty else { return false }
    acceptPendingLearning()
    spaceSlip = nil
    phantomSpace = false
    insertDocumentText(deletion.removed)
    lastEdit = .none
    composing = TypedWord(text: "")
    finishEdit(deriveComposing: true)
    return true
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
    spaceSlip = nil
    deletedGlide = nil
    // Host edits can precede their text-change callback. Reconcile displayed
    // choices before trusting their generation, preserving known own-edit lag.
    if suggestion.sourceContext != nil { reconcileBeforeSelection() }
    if suggestion.kind == .emoji {
      selectEmoji(suggestion)
      return
    }
    guard suggestion.sourceContext == nil || suggestion.sourceContext == suggestionContext else { return }
    let context = previousWord()
    let needsCase = shift.isActive && composing.isEmpty
    // Editing before existing whitespace must not leave a double space.
    let autoSpace = expectedAfterContext.first?.isWhitespace != true
    var text = needsCase ? Suggester.matchCase(of: "A", to: suggestion.text) : suggestion.text
    if policy.smartQuotes { text = Self.curlyApostrophes(text) }
    switch suggestion.kind {
    case .alternative:
      guard case var .glided(glide) = lastEdit, before.hasSuffix(glide.text) else { return }
      let originalContext = pendingLearning?.context ?? context
      for _ in 0..<glide.text.count { deleteDocumentBackward() }
      insertDocumentText(glide.spaced ? text + " " : text)
      if text != glide.word { rejectGlide(glide.word, context: originalContext) }
      // Choosing a word is the strongest sign it belongs here.
      if policy.learns { rejectedGlides[Self.glideRejectionKey(text, context: originalContext)] = nil }
      let spelling = glide.spellings[suggestion.text] ?? glide.spellings[text]
      pendingLearning = (spelling ?? text, originalContext, spelling != nil)
      pendingTouch = nil
      if let spelling { glide.spellings[text] = spelling }
      glide.word = text
      lastEdit = .glided(glide)
      phantomSpace = policy.autoSpaces && !glide.spaced
      finishEdit()
      return
    case .literal:
      if !composing.isEmpty {
        rejected.insert(composing.text)
        if policy.learns { personal?.pin(composing.text) }
        if autoSpace { insertDocumentText(" ") }
        composing = TypedWord(text: "")
        lastEdit = .acceptedSuggestion(autoSpace: autoSpace)
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
    } else if let previous = before.last, !previous.isWhitespace, !"([{\u{201C}\u{2018}-/".contains(previous), !Self.endsInOpeningQuote(before) {
      // Hyphens and slashes join words: left-handed, and/or.
      text = " " + text
    }
    phantomSpace = false
    insertDocumentText(autoSpace ? text + " " : text)
    learn(text.trimmingCharacters(in: .whitespaces), context: context)
    lastEdit = .acceptedSuggestion(autoSpace: autoSpace)
    if case .once = shift { shift = .off }
    finishEdit()
  }

  /// Decodes a swipe and inserts the best word with automatic spacing.
  /// - Parameter times: Touch timestamps in seconds, one per point, when known.
  @discardableResult
  public func insertGlide(_ points: [KeyPoint], times: [Double]? = nil) -> [GlideCandidate] {
    guard policy.allowsGlide, let glide else { return [] }
    reconcilePendingHostChanges()
    spaceSlip = nil
    deletedGlide = nil
    // Decode before touching the document, so a path that fits no word changes nothing.
    var candidates = glide.decode(points, times: times, context: languageContext(), limit: 4)
    guard !candidates.isEmpty else { return [] }
    var correction: CorrectionBeforeGlide?
    if !composing.isEmpty {
      commitComposing(separator: " ")
      if case .autocorrected = lastEdit {
        // Held until the swipe is kept, so deleting the swipe can still undo it.
        correction = CorrectionBeforeGlide(edit: lastEdit, learning: pendingLearning, touch: pendingTouch)
        pendingLearning = nil
        pendingTouch = nil
      }
      candidates = glide.decode(points, times: times, context: languageContext(), limit: 4)
    }
    guard !candidates.isEmpty else {
      if let correction {
        pendingLearning = correction.learning
        pendingTouch = correction.touch
      }
      finishEdit()
      return []
    }
    acceptPendingLearning()
    correctionBeforeGlide = correction
    let wordContext = previousWord()
    candidates = preferringUnrejected(candidates, context: wordContext)
    if policy.autoSpaces, let previous = before.last,
       phantomSpace || (!previous.isWhitespace && !"([{\u{201C}\u{2018}/@#-".contains(previous) && !Self.endsInOpeningQuote(before)) {
      insertDocumentText(" ")
      // The space can start a sentence or a word: "Hello." + swipe -> Hello. How
      updateAutomaticShift()
    }
    let allCaps = shift == .locked || (shift == .once(automatic: true) && policy.capitalization == .allCharacters)
    let transform: (String) -> String = { word in
      var text = allCaps ? word.uppercased() : self.shift.isActive ? Suggester.matchCase(of: "A", to: word) : word
      if self.policy.smartQuotes { text = Self.curlyApostrophes(text) }
      return text
    }
    let word = transform(candidates[0].text)
    // With a word after the cursor, its separating space is typed now rather than owed.
    let spaced = policy.autoSpaces && expectedAfterContext.first.map { $0.isLetter || $0.isNumber } == true
    insertDocumentText(spaced ? word + " " : word)
    pendingLearning = (candidates[0].text, wordContext, true)
    pendingTouch = nil
    var spellings = [word: candidates[0].text]
    var alternatives: [String] = []
    for candidate in candidates.dropFirst() {
      let text = transform(candidate.text)
      alternatives.append(text)
      spellings[text] = spellings[text] ?? candidate.text
    }
    lastEdit = .glided(Glide(word: word, alternatives: alternatives, spellings: spellings, spaced: spaced,
                             start: points[0], end: points[points.count - 1]))
    phantomSpace = policy.autoSpaces && !spaced
    if case .once = shift { shift = .off }
    finishEdit()
    return candidates
  }

  /// Whether `text` ends in a straight quote that opens rather than closes:
  /// after the start, a space or an opening bracket, as `curlyQuote` decides.
  static func endsInOpeningQuote(_ text: String) -> Bool {
    guard let last = text.last, last == "\"" || last == "'" else { return false }
    guard let previous = text.dropLast().last else { return true }
    return previous.isWhitespace || "([{\u{201C}\u{2018}-".contains(previous)
  }

  static func glideRejectionKey(_ word: String, context: (word: String?, sentenceStart: Bool)) -> String {
    let history = context.word?.lowercased() ?? (context.sentenceStart ? "\u{2}" : "")
    return history + "\u{1F}" + word.replacingOccurrences(of: "\u{2019}", with: "'").lowercased()
  }

  /// Counts a swiped word the person deleted or replaced in this context.
  private func rejectGlide(_ word: String, context: (word: String?, sentenceStart: Bool)) {
    guard policy.learns else { return }
    // Bounded for a long-lived keyboard; recent rejections are the ones that matter.
    if rejectedGlides.count >= 256 { rejectedGlides.removeAll() }
    rejectedGlides[Self.glideRejectionKey(word, context: context), default: 0] += 1
  }

  /// Moves the best candidate the person has not repeatedly rejected here to the
  /// front. The decoder's order is kept otherwise, so the demoted word is the
  /// first alternative, one tap away.
  private func preferringUnrejected(_ candidates: [GlideCandidate], context: (word: String?, sentenceStart: Bool)) -> [GlideCandidate] {
    guard policy.learns, !rejectedGlides.isEmpty else { return candidates }
    func rejected(_ candidate: GlideCandidate) -> Bool {
      rejectedGlides[Self.glideRejectionKey(candidate.text, context: context), default: 0] >= Self.glideRejectionLimit
    }
    guard let first = candidates.first, rejected(first), let index = candidates.firstIndex(where: { !rejected($0) }) else { return candidates }
    var reordered = candidates
    reordered.insert(reordered.remove(at: index), at: 0)
    return reordered
  }

  static func curlyApostrophes(_ text: String) -> String {
    text.replacingOccurrences(of: "'", with: "\u{2019}")
  }

  // MARK: Committing words

  private func commitComposing(separator: String) {
    let typed = composing
    let context = previousWord()
    let literalToken = composingLiteralToken
    let deleted = deletedGlide
    deletedGlide = nil
    refreshSuggestions()
    if let replacement = suggestions.autocorrection, replacement != typed.text {
      let inserted = policy.smartQuotes ? Self.curlyApostrophes(replacement) : replacement
      for _ in 0..<typed.text.count { deleteDocumentBackward() }
      insertDocumentText(inserted + separator)
      pendingLearning = (replacement, context, false)
      pendingTouch = (typed, replacement)
      lastEdit = .autocorrected(original: typed, inserted: inserted, separator: separator)
    } else {
      insertDocumentText(separator)
      if !literalToken {
        let swipeable = isSwipeable(typed.text)
        let stored = learn(typed.text, context: context)
        if suggester?.isValid(typed.text) == true { learnTouch(typed, intended: typed.text) }
        if let stored, let deleted, !swipeable, before == deleted.anchor + typed.text + separator,
           fitsEndpoints(stored, start: deleted.start, end: deleted.end) {
          personal?.pin(stored)
        }
      }
      lastEdit = separator == " " ? .space : .typed
    }
    composing = TypedWord(text: "")
  }

  /// Records a committed word. `context` is the word before it, taken before the
  /// word's own text changed the document. A `verbatim` word is a dictionary or
  /// learned spelling, whose capitals are its own.
  @discardableResult
  private func learn(_ word: String, context: (word: String?, sentenceStart: Bool)? = nil, verbatim: Bool = false) -> String? {
    guard policy.learns, let personal, let suggester else { return nil }
    let context = context ?? previousWord()
    let trimmed = word.trimmingCharacters(in: CharacterSet(charactersIn: "'\u{2019}"))
    guard trimmed.count > 1 || trimmed == "I" || trimmed == "a",
          trimmed.allSatisfy({ $0.isLetter || $0 == "'" || $0 == "\u{2019}" }) else { return nil }
    let normalized = trimmed.replacingOccurrences(of: "\u{2019}", with: "'")
    // A capital from sentence capitalization is not part of the word; elsewhere it marks a name.
    var stored = normalized
    if !verbatim, let first = normalized.first, first.isUppercase, normalized.dropFirst().allSatisfy({ $0.isLowercase }) {
      let lowered = normalized.lowercased()
      // Validity ignores case for names, so require a real lowercase spelling:
      // "I" and "Netflix" must not be learned, then predicted, as "i" and "netflix".
      let lexicon = suggester.lexicon
      let lowercaseSpelling = personal.isKnown(lowered) || lexicon.isSupplementalLiteral(lowered) ||
        lexicon.words(forKey: TextNormalizer.key(lowered)).contains {
          lexicon.display($0) == lowered && !lexicon.flags($0).contains(.notAWord)
        }
      if context.sentenceStart ? !suggester.isValid(normalized) || lowercaseSpelling : lowercaseSpelling {
        stored = lowered
      }
    }
    personal.learn(stored, after: context.word ?? (context.sentenceStart ? LanguageModel.sentenceStartHistory : nil))
    return stored
  }

  /// Whether the decoder can already produce `word`: a swipe-eligible dictionary
  /// spelling, in any case, or a known learned word.
  private func isSwipeable(_ word: String) -> Bool {
    guard let model = suggester?.model else { return true }
    let normalized = word.replacingOccurrences(of: "\u{2019}", with: "'")
    if model.personal.isKnown(normalized) || model.personal.isKnown(normalized.lowercased()) { return true }
    let lexicon = model.lexicon
    return lexicon.words(forKey: TextNormalizer.key(normalized)).contains {
      lexicon.flags($0).contains(.glide) && lexicon.display($0).lowercased() == normalized.lowercased()
    }
  }

  /// Whether a swipe from `start` to `end` could have been aimed at `word`'s first and last letters.
  private func fitsEndpoints(_ word: String, start: KeyPoint, end: KeyPoint) -> Bool {
    guard let geometry = glide?.geometry else { return false }
    let key = TextNormalizer.key(word).utf8
    guard key.count >= 2, let first = key.first.flatMap(geometry.center), let last = key.last.flatMap(geometry.center) else { return false }
    return first.distance(to: start) <= 1.5 && last.distance(to: end) <= 1.5
  }

  private func acceptPendingLearning() {
    if let correction = correctionBeforeGlide {
      correctionBeforeGlide = nil
      if let learning = correction.learning {
        if let touch = correction.touch, touch.intended == learning.word { learnTouch(touch.typed, intended: touch.intended) }
        learn(learning.word, context: learning.context, verbatim: learning.verbatim)
      }
    }
    let touch = pendingTouch
    pendingTouch = nil
    guard let pending = pendingLearning else { return }
    pendingLearning = nil
    if let touch, touch.intended == pending.word { learnTouch(touch.typed, intended: touch.intended) }
    // A kept swipe clears earlier rejections of the word in its context.
    if case .glided = lastEdit, policy.learns { rejectedGlides[Self.glideRejectionKey(pending.word, context: pending.context)] = nil }
    learn(pending.word, context: pending.context, verbatim: pending.verbatim)
  }

  /// Teaches the touch model where taps for `intended` landed. Never in private fields.
  private func learnTouch(_ typed: TypedWord, intended: String) {
    guard policy.learns, let corrector = suggester?.corrector, let touch = corrector.touch else { return }
    touch.learn(typed, intended: intended, geometry: corrector.geometry)
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
      ownContextHistory.removeAll()
      echoedOwnSequence = nil
      recentObservedOwnContexts.removeAll()
      phantomSpace = false
      lastEdit = .none
      pendingLearning = nil
      correctionBeforeGlide = nil
      deletedGlide = nil
      spaceSlip = nil
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
        // The first matching state at or after the latest report: a multi-step
        // replacement passes through some states twice, and a host catching up
        // reaches the earlier one first.
        let reached = ownContextHistory.first { $0.context == observed && $0.sequence >= (echoedOwnSequence ?? 0) }?.sequence
        let recent = recentOwnContexts.contains { $0.context == observed }
        let catchingUp = echoedOwnSequence != nil && reached != nil && now - lastOwnEditTime < Self.echoingHostLagLimit
        // A truly cleared field takes precedence over an earlier empty snapshot.
        if (!current.isEmpty || document.hasText || ownEditDepth > 0), recent || catchingUp {
          if let reached { echoedOwnSequence = reached }
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
          ownContextHistory.removeAll()
          echoedOwnSequence = nil
          recentObservedOwnContexts.removeAll()
          phantomSpace = false
          lastEdit = .none
          pendingLearning = nil
          correctionBeforeGlide = nil
          deletedGlide = nil
          spaceSlip = nil
          deriveComposing()
        }
      } else if ownEditSequence > 0, !ownContextHistory.isEmpty {
        // The host reported the state our latest edit requested.
        echoedOwnSequence = ownEditSequence
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

  /// Host pastes, cursor moves and selections can reach the proxy before their
  /// callback. Reconcile before an edit that relies on the remembered context, so
  /// it cannot delete, space or correct around text no longer at the cursor.
  /// Known delayed snapshots of our own edits are still recognized as lag.
  private func reconcilePendingHostChanges() {
    guard expectedContext != nil, ownEditDepth == 0 else { return }
    let rawBefore = document.documentContextBeforeInput
    let rawAfter = document.documentContextAfterInput
    // A field that withholds its context has nothing to reconcile against.
    guard rawBefore != nil || rawAfter != nil else { return }
    let selection = document.selectedText.flatMap { $0.isEmpty ? nil : $0 }
    let observed = ContextSnapshot(before: rawBefore ?? "", after: rawAfter ?? "", selection: selection)
    if document.documentIdentifier == expectedDocumentIdentifier, let expected = expectedContext {
      // Proxies can expose only a window around the cursor; a sliding window is not a change.
      func consistent(_ live: String, _ known: String, _ windowed: (String, String) -> Bool) -> Bool {
        live == known || (!live.isEmpty && windowed(known, live)) || (!known.isEmpty && windowed(live, known))
      }
      let unchanged = selection == expectedSelection
        && consistent(observed.before, expected) { $0.hasSuffix($1) }
        && consistent(observed.after, expectedAfterContext) { $0.hasPrefix($1) }
      guard !unchanged, !ownContextHistory.contains(where: { $0.context == observed }) else { return }
    }
    documentDidChange()
  }

  /// A tap polls the proxy rather than answering a host callback, so it reconciles
  /// like a keystroke: earlier states of our own edits are lag at any age. On a
  /// loaded device the host can trail the bar by seconds, and a choice the person
  /// saw for the text they typed must still apply. Other host changes, another
  /// field and newly withheld context still invalidate the choice.
  private func reconcileBeforeSelection() {
    let rawBefore = document.documentContextBeforeInput
    let rawAfter = document.documentContextAfterInput
    let hidden = rawBefore == nil && rawAfter == nil
    let wasVisible = observedContextAvailability.map { $0.before || $0.after } ?? false
    if expectedContext == nil || (hidden && wasVisible) {
      documentDidChange()
    } else {
      reconcilePendingHostChanges()
    }
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
    ownContextHistory.append((ContextSnapshot(before: before, after: expectedAfterContext, selection: expectedSelection), ownEditSequence))
    ownEditSequence += 1
    lastOwnEditTime = now
    if ownContextHistory.count > 64 { ownContextHistory.removeFirst(ownContextHistory.count - 64) }
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
    let word = expectedSelection == nil ? Self.trailingWord(of: before) : ""
    if composing.text != word { composing = TypedWord(text: word) }
  }

  static func trailingWord(of text: String) -> String {
    String(text.reversed().prefix(while: isWordCharacter).reversed())
  }

  /// Whether the text ends in a letter or digit, or an apostrophe inside a word (`don’`).
  static func endsInsideWord(_ text: String) -> Bool {
    var characters = text.reversed().makeIterator()
    guard let last = characters.next() else { return false }
    if last.isLetter || last.isNumber { return true }
    guard last == "'" || last == "\u{2019}", let previous = characters.next() else { return false }
    return previous.isLetter || previous.isNumber
  }

  var cursorInsideWord: Bool {
    guard let next = document.documentContextAfterInput?.first else { return false }
    return Self.isWordCharacter(next)
  }

  /// Addresses, handles and code identifiers also occur inside ordinary chat
  /// fields. Their fragments must not be treated as prose at punctuation.
  var composingLiteralToken: Bool {
    guard !composing.isEmpty, let token = Self.lastToken(of: Substring(before)) else { return false }
    let lowered = token.lowercased()
    return token.contains("@") || token.hasPrefix("#") || token.contains("_")
      || token.contains("://") || lowered.hasPrefix("www.")
      || ["http", "https", "ftp", "mailto"].contains(lowered)
  }

  /// The last whitespace-separated token, as `split(whereSeparator:).last` finds it,
  /// read from the end so long documents cost nothing extra per keystroke.
  static func lastToken(of text: Substring) -> Substring? {
    var end = text.endIndex
    while end > text.startIndex, text[text.index(before: end)].isWhitespace { end = text.index(before: end) }
    guard end > text.startIndex else { return nil }
    var start = end
    while start > text.startIndex, !text[text.index(before: start)].isWhitespace { start = text.index(before: start) }
    return text[start..<end]
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
    // Opening quotes and brackets belong to the sentence they start: “Hello, Hi. (See
    while let last = trimmed.last, Self.sentenceOpeners.contains(last) {
      if (last == "\"" || last == "'") && !Self.endsInOpeningQuote(String(trimmed.suffix(2))) { break }
      trimmed = trimmed.dropLast()
    }
    var sawSpace = false
    while let last = trimmed.last, last.isWhitespace {
      if last.isNewline { return true }
      sawSpace = true
      trimmed = trimmed.dropLast()
    }
    guard trimmed.last != nil else { return true }
    guard sawSpace else { return false }
    while let last = trimmed.last, Self.sentenceClosers.contains(last) { trimmed = trimmed.dropLast() }
    return trimmed.last.map(Self.sentenceEnders.contains) == true
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
    // A swipe before a following word leaves the cursor at that word's start, not inside it.
    let glidedBeforeWord: Bool = if case let .glided(glide) = lastEdit { glide.spaced } else { false }
    if (cursorInsideWord && !glidedBeforeWord) || expectedSelection != nil {
      storedSuggestions = .empty
      return
    }
    if case let .glided(glide) = lastEdit {
      guard policy.showsSuggestions else {
        storedSuggestions = .empty
        return
      }
      let ordered = [Suggestion(text: glide.word, kind: .alternative)] + glide.alternatives.prefix(2).map { Suggestion(text: $0, kind: .alternative) }
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
    var text = Substring(current)
    if appends {
      while text.last == " " { text.removeLast() }
    }
    guard let last = text.last, last.isLetter,
          let token = Self.lastToken(of: text),
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
        guard emojiMayReplace(emoji, slot: index, query: query, matcher: emojiSuggester) else { continue }
        storedSuggestions.slots[index] = suggestion
      } else { return }
      offeredEmoji = OfferedEmoji(value: value, query: query, before: current,
                                  after: expectedAfterContext, documentID: expectedDocumentIdentifier,
                                  appends: appends)
      return
    }
  }

  /// Whether a matched emoji may take a word's place in a full strip. Space
  /// never applies an emoji, so the word it displaces is the cost.
  private func emojiMayReplace(_ emoji: Emoji, slot index: Int, query: String, matcher: EmojiSuggester) -> Bool {
    // Everyday words also occur in emoji names and keywords ("face with steam
    // from nose", "sign of the horns", "love-you gesture"). They rarely ask for
    // an emoji, and their slot predicts or completes the next word.
    let lexicon = suggester?.model.lexicon
    func isCommon(_ word: Substring) -> Bool {
      guard let lexicon, let id = lexicon.id(of: String(word)) else { return false }
      return lexicon.unigramLogProbability(id) > Self.commonWordLogProbability
    }
    let words = query.split(separator: " ")
    if matcher.suggestions(for: query, limit: 1, prefixes: false).first == emoji {
      return words.contains { !isCommon($0) }
    }
    // Nearly every three-letter prefix starts some emoji keyword ("tha" ->
    // thanks, "thi" -> thinking). A partial word may replace a word only when
    // it continues a distinctive phrase ("red hea") or another visible word
    // names the same emoji ("piz" beside "pizza").
    if words.count > 1 { return words.dropLast().contains { !isCommon($0) } }
    return storedSuggestions.slots.indices.contains { other in
      other != index && storedSuggestions.slots[other].kind != .emoji &&
        matcher.suggestions(for: storedSuggestions.slots[other].text, limit: 1, prefixes: false).first == emoji
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
    correctionBeforeGlide = nil
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
  /// - Parameter inBackground: Encode and write off the calling thread.
  public func save(inBackground: Bool = false) {
    acceptPendingLearning()
    if inBackground { personal?.saveInBackground() } else { personal?.save() }
    suggester?.corrector.touch?.save(inBackground: inBackground)
  }
}
