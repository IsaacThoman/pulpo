import Foundation
@testable import KeyboardCore

/// Differential editing fuzzer for `KeyboardEngine`.
///
/// A generator produces long randomized sequences of realistic keyboard and host
/// events. The host keeps the true document and applies every engine edit at the
/// true cursor, while the proxy it exposes may lag, truncate, hide context or call
/// back re-entrantly. An oracle checks each operation's net effect on the true
/// document against editing invariants. Runs are deterministic per seed, and
/// failing sequences shrink to minimal operation lists that replay without the
/// generator.
enum EngineFuzz {
  static let emojiIndex = EmojiSuggester(
    catalog: try! EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json")))
}

// MARK: - Fields, settings, operations

enum FuzzField: String, CaseIterable, Sendable {
  case standard, twitter, webSearch, noAutocorrect, words, allCaps, straightQuotes
  case email, url, number, decimal, secure, username, oneTimeCode

  var traits: InputTraits {
    var traits = InputTraits()
    switch self {
    case .standard: break
    case .twitter: traits.keyboard = .twitter
    case .webSearch:
      traits.keyboard = .webSearch
      traits.returnKey = .search
      traits.enablesReturnKeyAutomatically = true
    case .noAutocorrect:
      traits.autocorrection = false
      traits.spellChecking = false
    case .words: traits.capitalization = .words
    case .allCaps: traits.capitalization = .allCharacters
    case .straightQuotes: traits.smartQuotes = false
    case .email:
      traits.keyboard = .email
      traits.capitalization = .none
      traits.contentType = "emailAddress"
      traits.autocorrection = false
    case .url:
      traits.keyboard = .url
      traits.capitalization = .none
      traits.contentType = "URL"
      traits.autocorrection = false
    case .number:
      traits.keyboard = .numberPad
      traits.capitalization = .none
    case .decimal:
      traits.keyboard = .decimalPad
      traits.capitalization = .none
    case .secure:
      traits.isSecure = true
      traits.capitalization = .none
      traits.autocorrection = false
    case .username:
      traits.contentType = "username"
      traits.capitalization = .none
      traits.autocorrection = false
    case .oneTimeCode:
      traits.contentType = "oneTimeCode"
      traits.keyboard = .numberPad
      traits.capitalization = .none
    }
    return traits
  }

  var isNumeric: Bool { self == .number || self == .decimal || self == .oneTimeCode }
  /// Text typed here uses never-learn tokens.
  var usesSecretTokens: Bool { traits.isPrivate || self == .email || self == .url }
}

enum FuzzSetting: String, CaseIterable, Sendable {
  case autocorrect, autoCapitalization, doubleSpacePeriod, smartPunctuation, predictions, learnWords, swipeTyping

  func toggle(_ settings: inout KeyboardSettings) {
    switch self {
    case .autocorrect: settings.autocorrect.toggle()
    case .autoCapitalization: settings.autoCapitalization.toggle()
    case .doubleSpacePeriod: settings.doubleSpacePeriod.toggle()
    case .smartPunctuation: settings.smartPunctuation.toggle()
    case .predictions: settings.predictions.toggle()
    case .learnWords: settings.learnWords.toggle()
    case .swipeTyping: settings.swipeTyping.toggle()
    }
  }
}

enum FuzzDelivery: String, Sendable { case now, pending }

/// One concrete, self-contained event. Replays need no random source.
enum FuzzOp: Equatable, CustomStringConvertible, Sendable {
  case letter(Character, KeyPoint?, dt: Double)
  /// A non-letter character key: punctuation, digits, symbols.
  case key(String, dt: Double)
  case space(dt: Double)
  case returnKey
  case shiftTap
  case shiftDoubleTap
  case shiftDown
  case shiftUp
  case backspace(dt: Double)
  case deleteWord
  /// Taps the currently displayed slot `index % count`.
  case tapSlot(Int)
  /// Taps a slot from the bar as it was displayed `age` operations ago.
  case tapStale(age: Int, slot: Int)
  case swipe(String, seed: UInt64, noise: Double)
  case garbageSwipe(seed: UInt64)
  /// The emoji panel inserting a glyph.
  case emoji(String)
  /// A multi-character key such as `.com`.
  case textKey(String)
  case transcript(String)
  case page(KeyboardPage)
  // Host-side events.
  case paste(String, FuzzDelivery)
  case moveCursor(Double, FuzzDelivery)
  case select(Double, Int, FuzzDelivery)
  case replaceAll(String, FuzzDelivery)
  case deleteRange(Double, Int, FuzzDelivery)
  case typeAfter(String, FuzzDelivery)
  /// A host callback with whatever the proxy currently reports.
  case ack
  /// The host catches up (no lag, no hiding) and calls back.
  case deliver
  /// The proxy trails the true document by `edits` for the next `ops` keyboard operations.
  case lag(Int, ops: Int)
  /// The next `ops` keyboard operations call back synchronously before each host edit.
  case reentrant(ops: Int)
  /// The field withholds context for the next `ops` keyboard operations.
  case hide(ops: Int)
  /// The proxy truncates context to the last `n` characters (nil for none).
  case window(Int?)
  case fieldSwitch(FuzzField, prefill: String, cursor: Double?, identity: UInt64, FuzzDelivery)
  case dismissShow
  case toggle(FuzzSetting)

  var isKeyboardEdit: Bool {
    switch self {
    case .letter, .key, .space, .returnKey, .backspace, .deleteWord, .tapSlot, .tapStale, .swipe, .garbageSwipe,
      .emoji, .textKey, .transcript:
      true
    default: false
    }
  }

  var isShift: Bool {
    switch self {
    case .shiftTap, .shiftDoubleTap, .shiftDown, .shiftUp: true
    default: false
    }
  }

  var description: String {
    func q(_ s: String) -> String { s.debugDescription }
    func p(_ point: KeyPoint?) -> String { point.map { "KeyPoint(x: \($0.x), y: \($0.y))" } ?? "nil" }
    switch self {
    case let .letter(c, tap, dt): return ".letter(\(q(String(c))), \(p(tap)), dt: \(dt))"
    case let .key(k, dt): return ".key(\(q(k)), dt: \(dt))"
    case let .space(dt): return ".space(dt: \(dt))"
    case .returnKey: return ".returnKey"
    case .shiftTap: return ".shiftTap"
    case .shiftDoubleTap: return ".shiftDoubleTap"
    case .shiftDown: return ".shiftDown"
    case .shiftUp: return ".shiftUp"
    case let .backspace(dt): return ".backspace(dt: \(dt))"
    case .deleteWord: return ".deleteWord"
    case let .tapSlot(i): return ".tapSlot(\(i))"
    case let .tapStale(age, slot): return ".tapStale(age: \(age), slot: \(slot))"
    case let .swipe(w, seed, noise): return ".swipe(\(q(w)), seed: \(seed), noise: \(noise))"
    case let .garbageSwipe(seed): return ".garbageSwipe(seed: \(seed))"
    case let .emoji(e): return ".emoji(\(q(e)))"
    case let .textKey(t): return ".textKey(\(q(t)))"
    case let .transcript(t): return ".transcript(\(q(t)))"
    case let .page(page): return ".page(.\(page))"
    case let .paste(t, d): return ".paste(\(q(t)), .\(d))"
    case let .moveCursor(f, d): return ".moveCursor(\(f), .\(d))"
    case let .select(f, n, d): return ".select(\(f), \(n), .\(d))"
    case let .replaceAll(t, d): return ".replaceAll(\(q(t)), .\(d))"
    case let .deleteRange(f, n, d): return ".deleteRange(\(f), \(n), .\(d))"
    case let .typeAfter(t, d): return ".typeAfter(\(q(t)), .\(d))"
    case .ack: return ".ack"
    case .deliver: return ".deliver"
    case let .lag(k, ops): return ".lag(\(k), ops: \(ops))"
    case let .reentrant(ops): return ".reentrant(ops: \(ops))"
    case let .hide(ops): return ".hide(ops: \(ops))"
    case let .window(n): return ".window(\(n.map(String.init) ?? "nil"))"
    case let .fieldSwitch(f, prefill, cursor, identity, d):
      return ".fieldSwitch(.\(f), prefill: \(q(prefill)), cursor: \(cursor.map { "\($0)" } ?? "nil"), identity: \(identity), .\(d))"
    case .dismissShow: return ".dismissShow"
    case let .toggle(s): return ".toggle(.\(s))"
    }
  }
}

/// Per-sequence host and settings configuration.
struct FuzzConfig: Equatable, CustomStringConvertible, Sendable {
  var field: FuzzField = .standard
  var prefill = ""
  var settingsToggles: [FuzzSetting] = []
  var identities = true
  var emptyAsNil = false

  var description: String {
    "FuzzConfig(field: .\(field), prefill: \(prefill.debugDescription), settingsToggles: [\(settingsToggles.map { ".\($0)" }.joined(separator: ", "))], identities: \(identities), emptyAsNil: \(emptyAsNil))"
  }
}

// MARK: - Host

/// A text field whose true state is exact, behind a proxy that may misreport it.
final class FuzzHost: TextDocument {
  struct Snapshot: Equatable {
    var text: [Character]
    var cursor: Int
    var selection: Int
  }

  enum Primitive { case insert(String), delete }

  var chars: [Character] = []
  var cursor = 0
  var selection = 0
  var identity: UUID?

  private(set) var history: [Snapshot] = []
  /// Proxy reports trail the true state by this many changes, but never before `lagFloor`.
  var lag = 0
  var lagFloor = 0
  var window: Int?
  var hidden = false
  var emptyAsNil = false
  var reentrant: (() -> Void)?
  var log: [Primitive] = []

  init() { commit() }

  var current: Snapshot { Snapshot(text: chars, cursor: cursor, selection: selection) }

  var reported: Snapshot {
    guard lag > 0 else { return current }
    return history[max(lagFloor, history.count - 1 - lag)]
  }

  var trueBefore: String { String(chars[..<cursor]) }
  var trueAfter: String { String(chars[(cursor + selection)...]) }
  var trueSelection: String { String(chars[cursor..<(cursor + selection)]) }
  var text: String { String(chars) }

  func commit() { history.append(current) }

  func startLag(_ edits: Int) {
    lagFloor = history.count - 1
    lag = edits
  }

  var documentIdentifier: UUID? { identity }

  var documentContextBeforeInput: String? {
    guard !hidden else { return nil }
    let state = reported
    var before = String(state.text[..<state.cursor])
    if let window, before.count > window { before = String(before.suffix(window)) }
    return emptyAsNil && before.isEmpty ? nil : before
  }

  var documentContextAfterInput: String? {
    guard !hidden else { return nil }
    let state = reported
    var after = String(state.text[(state.cursor + state.selection)...])
    if let window, after.count > window { after = String(after.prefix(window)) }
    return emptyAsNil && after.isEmpty ? nil : after
  }

  var selectedText: String? {
    let state = reported
    return state.selection > 0 ? String(state.text[state.cursor..<(state.cursor + state.selection)]) : nil
  }

  var hasText: Bool { !chars.isEmpty }

  func insertText(_ inserted: String) {
    reentrant?()
    log.append(.insert(inserted))
    replace(with: inserted)
    commit()
  }

  func deleteBackward() {
    reentrant?()
    log.append(.delete)
    if selection > 0 {
      chars.removeSubrange(cursor..<(cursor + selection))
      selection = 0
    } else if cursor > 0 {
      chars.remove(at: cursor - 1)
      cursor -= 1
    }
    commit()
  }

  /// Replaces the selection (or inserts at the cursor), rejoining graphemes as a real field would.
  func replace(with inserted: String) {
    let left = String(chars[..<cursor]) + inserted
    let right = String(chars[(cursor + selection)...])
    chars = Array(left + right)
    cursor = min(Array(left).count, chars.count)
    selection = 0
  }

  func set(text: String, cursor offset: Int) {
    chars = Array(text)
    cursor = max(0, min(offset, chars.count))
    selection = 0
    commit()
  }
}

// MARK: - Violations and reports

struct FuzzViolation: CustomStringConvertible, Sendable {
  var cls: String
  var tag: String
  var seed: UInt64
  var op: Int
  var detail: String

  var key: String { tag.isEmpty ? cls : cls + "@" + tag }
  var description: String { "[\(key)] seed \(seed) op \(op): \(detail)" }
}

struct FuzzRunResult {
  var violations: [FuzzViolation]
  var ops: [FuzzOp]
  var config: FuzzConfig
  var fingerprint: UInt64
  var executed: Int
  var skipped: Int
  var finalText: String
}

// MARK: - Runner and oracle

final class FuzzRun {
  struct Capture {
    var version: Int
    var state: [String]
    var slots: [Suggestion]
    /// Shown while a host change or field switch had not reached the engine: the
    /// bar described an earlier document, so no later tap on it counts as fresh.
    var pending = false
  }

  /// One step of the word-unit chain: an edit that inserted or replaced a whole word.
  struct ChainEntry {
    var preBefore: String
    var inserted: String
    var autocorrect: Bool
    /// Before-texts an undo of this entry may restore.
    var acceptable: [String]
  }

  struct Net {
    var removed: Int
    var removedText: String
    var inserted: String
    var selectionConsumed: Bool
    var edited: Bool
  }

  let seed: UInt64
  let config: FuzzConfig
  let host = FuzzHost()
  let personal = PersonalDictionary(url: nil)
  let engine: KeyboardEngine
  var settings = KeyboardSettings()
  var time = 100.0
  var trueField: FuzzField
  var deliveredField: FuzzField
  var pendingField = false
  var pendingExternal = false
  var shiftHeld = false
  var userTouchedShift = false
  var undidAutocorrect = false
  var version = 0
  var captures: [Capture] = []
  var chain: [ChainEntry] = []
  var contextChangedSinceChain = false
  var lagOps = 0
  var reentrantOps = 0
  var hideOps = 0
  var secretTokens: Set<String> = []
  var violations: [FuzzViolation] = []
  var ops: [FuzzOp] = []
  var skipped = 0
  var fingerprint: UInt64 = 0xcbf2_9ce4_8422_2325
  var opIndex = 0
  var slowOpThreshold = 1.0

  init(seed: UInt64, config: FuzzConfig) {
    self.seed = seed
    self.config = config
    for toggle in config.settingsToggles { toggle.toggle(&settings) }
    let (_, suggester, glide) = Fixtures.stack(personal: personal)
    engine = KeyboardEngine(document: host, suggester: suggester, glide: glide, settings: settings)
    engine.emojiSuggester = EngineFuzz.emojiIndex
    trueField = config.field
    deliveredField = config.field
    host.emptyAsNil = config.emptyAsNil
    host.identity = config.identities ? FuzzRun.uuid(seed &+ 1) : nil
    host.set(text: config.prefill, cursor: config.prefill.count)
    engine.clock = { [unowned self] in self.time }
    engine.traits = config.field.traits
    engine.page = engine.traits.keyboard == .numbersAndPunctuation ? .numbers : .letters
    engine.documentDidChange()
    captures.append(Capture(version: version, state: trueState(), slots: engine.suggestions.slots))
  }

  static func uuid(_ value: UInt64) -> UUID {
    var a = SeededGenerator(state: value)
    let x = a.next(), y = a.next()
    let b = withUnsafeBytes(of: x.bigEndian) { Array($0) } + withUnsafeBytes(of: y.bigEndian) { Array($0) }
    return UUID(uuid: (b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]))
  }

  var policy: InputPolicy { InputPolicy(traits: deliveredField.traits, settings: settings) }
  var hostTruthful: Bool { host.lag == 0 && !host.hidden && host.window == nil && host.reentrant == nil }

  /// The comparable state before an operation, given its true before/after/selection.
  func trueStateBefore(_ before: String, _ after: String, _ selection: String) -> [String] {
    var state = trueState()
    state[0] = before
    state[1] = after
    state[2] = selection
    return state
  }

  func trueState() -> [String] {
    [host.trueBefore, host.trueAfter, host.trueSelection, host.identity?.uuidString ?? "-", trueField.rawValue,
     "\(settings.autocorrect)\(settings.predictions)\(settings.smartPunctuation)\(settings.autoCapitalization)"]
  }

  /// What `KeyboardController.documentDidChange` does on a host callback.
  func controllerCallback() {
    let traits = trueField.traits
    if traits != engine.traits {
      engine.traits = traits
      engine.page = traits.keyboard == .numbersAndPunctuation ? .numbers : .letters
    }
    deliveredField = trueField
    pendingField = false
    if host.lag == 0, !host.hidden { pendingExternal = false }
    if host.hidden { invalidateChain() }
    engine.documentDidChange()
  }

  func invalidateChain() {
    if !chain.isEmpty { contextChangedSinceChain = true }
    chain = []
    undidAutocorrect = false
  }

  func record(_ cls: String, _ detail: String, tag extra: String = "", truthful: Bool, pending: Bool) {
    var tags: [String] = []
    if pending { tags.append("pending") }
    if !truthful { tags.append("stale") }
    if !extra.isEmpty { tags.append(extra) }
    violations.append(FuzzViolation(cls: cls, tag: tags.joined(separator: "+"), seed: seed, op: opIndex, detail: detail))
  }

  func net(preBefore: [Character], hadSelection: Bool) -> Net {
    var removed = 0
    var added: [Character] = []
    var selectionPending = hadSelection
    var selectionConsumed = false
    for primitive in host.log {
      switch primitive {
      case let .insert(text):
        if selectionPending { selectionPending = false; selectionConsumed = true }
        added.append(contentsOf: text)
      case .delete:
        if selectionPending {
          selectionPending = false
          selectionConsumed = true
        } else if !added.isEmpty {
          added.removeLast()
        } else if removed < preBefore.count {
          removed += 1
        }
      }
    }
    return Net(removed: removed, removedText: String(preBefore.suffix(removed)), inserted: String(added),
               selectionConsumed: selectionConsumed, edited: !host.log.isEmpty)
  }

  // MARK: Execution

  func execute(_ op: FuzzOp) {
    ops.append(op)
    defer { opIndex += 1 }
    let preBefore = host.trueBefore, preAfter = host.trueAfter, preSelection = host.trueSelection
    let preText = host.text
    let preShift = engine.shift
    let preTotal = personal.totalCount
    let truthful = hostTruthful
    let pending = pendingExternal || pendingField
    let preVersion = version
    let preSuggestions = captures.last?.slots ?? []
    let preLearns = policy.learns || pendingField
    host.log.removeAll()
    var stale: (capture: Capture, suggestion: Suggestion)?
    var tapped: Suggestion?
    var glideCalled = false
    var glideWord: String?
    var skippedOp = false
    let started = DispatchTime.now().uptimeNanoseconds

    switch op {
    case let .letter(character, tap, dt):
      time += dt
      if engine.page != .letters || deliveredField.isNumeric { skippedOp = true; break }
      engine.insertCharacter(String(character), tap: tap)
    case let .key(text, dt):
      time += dt
      engine.insertCharacter(text)
    case let .space(dt):
      time += dt
      engine.insertSpace()
    case .returnKey:
      time += 0.2
      guard engine.returnKeyEnabled else { skippedOp = true; break }
      engine.insertReturn()
    case .shiftTap:
      time += 0.15
      engine.shiftDown(); engine.shiftUp()
    case .shiftDoubleTap:
      time += 0.4
      engine.shiftDown(); engine.shiftUp()
      time += 0.12
      engine.shiftDown(); engine.shiftUp()
    case .shiftDown:
      time += 0.1
      guard !shiftHeld else { skippedOp = true; break }
      shiftHeld = true
      engine.shiftDown()
    case .shiftUp:
      time += 0.1
      guard shiftHeld else { skippedOp = true; break }
      shiftHeld = false
      engine.shiftUp()
    case let .backspace(dt):
      time += dt
      engine.deleteBackward()
    case .deleteWord:
      time += 0.1
      engine.deleteWordBackward()
    case let .tapSlot(index):
      time += 0.3
      guard !preSuggestions.isEmpty else { skippedOp = true; break }
      let suggestion = preSuggestions[index % preSuggestions.count]
      tapped = suggestion
      engine.select(suggestion)
    case let .tapStale(age, slot):
      time += 0.3
      let index = captures.count - 1 - age
      guard index >= 0, !captures[index].slots.isEmpty else { skippedOp = true; break }
      let capture = captures[index]
      let suggestion = capture.slots[slot % capture.slots.count]
      stale = (capture, suggestion)
      tapped = suggestion
      engine.select(suggestion)
    case let .swipe(word, seed, noise):
      time += 0.5
      if engine.page != .letters || deliveredField.isNumeric { skippedOp = true; break }
      var generator = SeededGenerator(state: seed)
      let points = SyntheticSwipe.points(for: word, noise: noise, generator: &generator)
      swipe(points, called: &glideCalled, word: &glideWord)
    case let .garbageSwipe(seed):
      time += 0.4
      if engine.page != .letters || deliveredField.isNumeric { skippedOp = true; break }
      var generator = SeededGenerator(state: seed)
      let count = Int.random(in: 2...24, using: &generator)
      let points = (0..<count).map { _ in
        KeyPoint(x: Double.random(in: 0...10, using: &generator), y: Double.random(in: 0...3, using: &generator))
      }
      swipe(points, called: &glideCalled, word: &glideWord)
    case let .emoji(glyph):
      time += 0.3
      engine.insertText(glyph)
    case let .textKey(text):
      time += 0.2
      engine.insertText(text)
    case let .transcript(text):
      time += 1
      engine.insertTranscript(text)
    case let .page(page):
      time += 0.1
      engine.page = page
    case let .paste(text, delivery):
      time += 0.5
      host.replace(with: text)
      host.commit()
      external(delivery, preBefore, preAfter, preSelection)
    case let .moveCursor(fraction, delivery):
      time += 0.4
      host.cursor = Int((Double(host.chars.count) * fraction).rounded(.down))
      host.selection = 0
      host.commit()
      external(delivery, preBefore, preAfter, preSelection)
    case let .select(fraction, length, delivery):
      time += 0.4
      let start = Int((Double(host.chars.count) * fraction).rounded(.down))
      host.cursor = start
      host.selection = min(length, host.chars.count - start)
      host.commit()
      external(delivery, preBefore, preAfter, preSelection)
    case let .replaceAll(text, delivery):
      time += 0.4
      host.set(text: text, cursor: text.count)
      external(delivery, preBefore, preAfter, preSelection)
    case let .deleteRange(fraction, length, delivery):
      time += 0.4
      let start = Int((Double(host.chars.count) * fraction).rounded(.down))
      let end = min(host.chars.count, start + length)
      host.chars.removeSubrange(start..<end)
      if host.cursor > end { host.cursor -= end - start } else if host.cursor > start { host.cursor = start }
      host.selection = min(host.selection, host.chars.count - host.cursor)
      host.commit()
      external(delivery, preBefore, preAfter, preSelection)
    case let .typeAfter(text, delivery):
      time += 0.4
      let insertion = host.cursor + host.selection
      let left = String(host.chars[..<insertion]), right = String(host.chars[insertion...])
      let before = host.cursor, selected = host.selection
      host.chars = Array(left + text + right)
      host.cursor = min(before, host.chars.count)
      host.selection = min(selected, host.chars.count - host.cursor)
      host.commit()
      if preBefore != host.trueBefore || preSelection != host.trueSelection { invalidateChain() }
      version += 1
      if delivery == .now { controllerCallback() } else { pendingExternal = true }
    case .ack:
      time += 0.02
      controllerCallback()
    case .deliver:
      time += 0.05
      host.lag = 0
      lagOps = 0
      host.hidden = false
      hideOps = 0
      controllerCallback()
    case let .lag(edits, count):
      host.startLag(edits)
      lagOps = count
    case let .reentrant(count):
      reentrantOps = count
      host.reentrant = { [unowned self] in self.controllerCallback() }
    case let .hide(count):
      host.hidden = true
      hideOps = count
    case let .window(size):
      host.window = size
    case let .fieldSwitch(field, prefill, cursor, identity, delivery):
      time += 1
      trueField = field
      host.identity = config.identities ? FuzzRun.uuid(identity) : nil
      host.lag = 0
      lagOps = 0
      host.hidden = false
      hideOps = 0
      host.set(text: prefill, cursor: cursor.map { Int(Double(prefill.count) * $0) } ?? prefill.count)
      // A held shift stays held: the keyboard remains on screen across fields.
      invalidateChain()
      version += 1
      if delivery == .now { controllerCallback() } else { pendingField = true; pendingExternal = true }
    case .dismissShow:
      time += 5
      hideAndShow()
    case let .toggle(setting):
      // Settings change in the app, so the keyboard reloads them when it reappears.
      time += 2
      setting.toggle(&settings)
      version += 1
      hideAndShow()
    }

    let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1e9
    if skippedOp { skipped += 1 }
    if elapsed > slowOpThreshold {
      record("slowOp", "\(op) took \(elapsed)s", truthful: truthful, pending: pending)
    }

    if op.isKeyboardEdit || glideCalled {
      let net = net(preBefore: Array(preBefore), hadSelection: !preSelection.isEmpty)
      if net.edited, host.text != preText { version += 1 }
      check(op: op, net: net, preBefore: preBefore, preAfter: preAfter, preSelection: preSelection, preText: preText,
            preShift: preShift, truthful: truthful, pending: pending, tapped: tapped, stale: stale,
            preVersion: preVersion, preSuggestions: preSuggestions, glideWord: glideWord, glideCalled: glideCalled)
      if op.isKeyboardEdit && !skippedOp { countDown() }
    }
    if op.isShift { userTouchedShift = true }
    if !preLearns && !policy.learns && !pendingField && personal.totalCount != preTotal {
      record("privateLearning", "\(op) changed personal totalCount \(preTotal) -> \(personal.totalCount) in \(deliveredField)",
             truthful: truthful, pending: pending)
    }
    for token in secretTokens where personal.count(of: token) > 0 || personal.isKnown(token) {
      record("privateLearning", "learned secret token \(token) after \(op)", tag: "token", truthful: truthful, pending: pending)
      secretTokens.remove(token)
    }
    switch op {
    case .ack, .deliver, .dismissShow: checkDesync(op)
    case .paste(_, .now), .moveCursor(_, .now), .select(_, _, .now), .replaceAll(_, .now), .deleteRange(_, _, .now),
      .typeAfter(_, .now), .fieldSwitch(_, _, _, _, .now):
      checkDesync(op)
    default: break
    }
    captures.append(Capture(version: version, state: trueState(), slots: engine.suggestions.slots,
                            pending: pendingExternal || pendingField))
    for character in host.text.unicodeScalars { fingerprint = (fingerprint ^ UInt64(character.value)) &* 0x100_0000_01b3 }
    fingerprint = (fingerprint ^ UInt64(host.cursor)) &* 0x100_0000_01b3
  }

  /// `hostDidDisappear` (KeysView cancels touches, releasing a held shift) then `hostWillAppear`.
  func hideAndShow() {
    if shiftHeld {
      shiftHeld = false
      engine.shiftUp()
    }
    engine.save()
    engine.settings = settings
    engine.traits = trueField.traits
    engine.page = engine.traits.keyboard == .numbersAndPunctuation ? .numbers : .letters
    deliveredField = trueField
    pendingField = false
    if host.lag == 0, !host.hidden { pendingExternal = false }
    engine.documentDidChange()
  }

  func swipe(_ points: [KeyPoint], called: inout Bool, word: inout String?) {
    // KeysView only reports glides when the controller allows them; otherwise it is a tap.
    let start = (engine.glide?.geometry ?? .qwerty).nearestLetter(to: points[0]).map { String(UnicodeScalar($0)) } ?? "a"
    guard engine.policy.allowsGlide else {
      engine.insertCharacter(start, tap: points.first)
      return
    }
    called = true
    let candidates = engine.insertGlide(points)
    if candidates.isEmpty {
      engine.insertCharacter(start, tap: points.first)
    } else {
      word = candidates.first?.text
    }
  }

  /// Host edits near the cursor end word undo; edits far away (outside the proxy's
  /// window) leave the word and its undo intact.
  func external(_ delivery: FuzzDelivery, _ preBefore: String, _ preAfter: String, _ preSelection: String) {
    if host.trueSelection != preSelection || host.trueBefore.suffix(32) != preBefore.suffix(32)
      || host.trueAfter.prefix(32) != preAfter.prefix(32)
    {
      invalidateChain()
    }
    version += 1
    if delivery == .now { controllerCallback() } else { pendingExternal = true }
  }

  func countDown() {
    if lagOps > 0 {
      lagOps -= 1
      if lagOps == 0 {
        host.lag = 0
        controllerCallback()
        checkDesync(.ack)
      }
    }
    if reentrantOps > 0 {
      reentrantOps -= 1
      if reentrantOps == 0 { host.reentrant = nil }
    }
    if hideOps > 0 {
      hideOps -= 1
      if hideOps == 0 {
        host.hidden = false
        controllerCallback()
      }
    }
  }

  func checkDesync(_ op: FuzzOp) {
    guard hostTruthful, !pendingExternal, !pendingField else { return }
    let composing = engine.composingText
    if !composing.isEmpty, !host.trueBefore.hasSuffix(composing) {
      record("composingDesync", "after \(op): composing \(composing.debugDescription) vs before \(host.trueBefore.debugDescription)",
             truthful: true, pending: false)
    }
  }

  static func isWordCharacter(_ c: Character) -> Bool { c.isLetter || c.isNumber || c == "'" || c == "\u{2019}" }

  /// Whether `text[index]` continues a word: letters and digits, or an apostrophe inside one.
  static func continuesWord(_ text: [Character], at index: Int) -> Bool {
    let c = text[index]
    if c.isLetter || c.isNumber { return true }
    guard c == "'" || c == "\u{2019}", index > 0 else { return false }
    return text[index - 1].isLetter || text[index - 1].isNumber
  }

  static func normalize(_ s: String) -> String {
    s.replacingOccurrences(of: "\u{2019}", with: "'").lowercased()
  }

  static func doubleSpaces(_ s: String) -> Int {
    var count = 0
    var previous: Character?
    for c in s {
      if c == " ", previous == " " { count += 1 }
      previous = c
    }
    return count
  }

  /// Whether a letter typed after `context` should be capitalized; nil when ambiguous.
  static func expectsCapital(after context: [Character], _ mode: InputTraits.Capitalization) -> Bool? {
    switch mode {
    case .none: return false
    case .allCharacters: return true
    case .words: return context.isEmpty || context.last!.isWhitespace
    case .sentences:
      if let last = context.last, "(\"\u{201C}\u{2018}'[{".contains(last) { return nil }
      var index = context.count
      var sawSpace = false
      while index > 0, context[index - 1] == " " || context[index - 1] == "\t" {
        index -= 1
        sawSpace = true
      }
      if index == 0 { return true }
      if context[index - 1].isNewline { return true }
      guard sawSpace else { return false }
      var end = index
      while end > 0, "\"')]}\u{201D}\u{2019}".contains(context[end - 1]) { end -= 1 }
      return end > 0 && ".!?".contains(context[end - 1])
    }
  }

  func check(op: FuzzOp, net: Net, preBefore: String, preAfter: String, preSelection: String, preText: String,
             preShift: ShiftState, truthful: Bool, pending: Bool, tapped: Suggestion?,
             stale: (capture: Capture, suggestion: Suggestion)?, preVersion: Int, preSuggestions: [Suggestion],
             glideWord: String?, glideCalled: Bool)
  {
    let postBefore = host.trueBefore
    let before = Array(preBefore)
    func fail(_ cls: String, _ detail: String, tag: String = "") {
      record(cls, "\(op): \(detail) | before \(preBefore.debugDescription) after \(preAfter.debugDescription) sel \(preSelection.debugDescription) -> \(postBefore.debugDescription)|\(host.trueAfter.debugDescription) removed \(net.removedText.debugDescription) inserted \(net.inserted.debugDescription)",
             tag: tag, truthful: truthful, pending: pending)
    }

    // I3: text after the cursor/selection.
    if host.trueAfter != preAfter {
      fail("afterTextModified", "after-text changed")
    }
    // I18: corrupt insertions.
    if net.inserted.unicodeScalars.contains(where: { $0.value == 0 || $0.value == 0xFFFD || $0.value == 0xFFFC }) {
      fail("corruptInsertion", "control scalar inserted")
    }

    let isEmojiTap = tapped?.kind == .emoji
    var isBackspace = false, isWordDelete = false, isSpace = false
    var isTerminator = false  // space, punctuation or return
    switch op {
    case .backspace: isBackspace = true
    case .deleteWord: isWordDelete = true
    case .space: isSpace = true; isTerminator = true
    case .returnKey: isTerminator = true
    case let .key(k, _): isTerminator = !(k.first?.isLetter ?? false)
    default: break
    }

    // I4 / I5: word-scoped deletion bounds.
    if !isBackspace, !isWordDelete, net.removed > 0 {
      if !isEmojiTap {
        let text = Array(net.removedText)
        var body = text[...]
        if let first = body.first, first.isWhitespace { body = body.dropFirst() }
        if let last = body.last, last.isWhitespace { body = body.dropLast() }
        if body.contains(where: \.isWhitespace) {
          fail("editOutsideCurrentWord", "removed more than one token")
        }
        if case .letter = op {
          fail("editOutsideCurrentWord", "letter tap removed text", tag: "letter")
        }
      }
      if let first = net.removedText.first, Self.isWordCharacter(first), before.count > net.removed,
        Self.continuesWord(before, at: before.count - net.removed - 1)
      {
        fail("partialWordReplacement", "replacement started inside a word")
      }
      if isTerminator, net.removedText.contains(where: \.isLetter), let next = preAfter.first, next.isLetter || next.isNumber {
        fail("partialWordReplacement", "corrected in the middle of a word", tag: "midWord")
      }
      if !preSelection.isEmpty {
        fail("editOutsideCurrentWord", "removed text before a replaced selection", tag: "selection")
      }
    }

    // I8: autospacing must not create double spaces.
    if !isSpace, !isBackspace, !isWordDelete, Self.doubleSpaces(host.text) > Self.doubleSpaces(preText) {
      fail("autospaceDoubleSpace", "new double space")
    }

    // I8b: swipes separate themselves from the previous word.
    let traits = deliveredField.traits
    let plainField = !traits.isPrivate && traits.keyboard != .email && traits.keyboard != .url && !traits.isNumeric
    if glideCalled, let word = glideWord, !word.isEmpty, plainField {
      // Locate the decoded word at the end of the edit; whatever precedes it must separate it.
      let post = Array(postBefore)
      let length = word.count
      if post.count > length, Self.normalize(String(post.suffix(length))) == Self.normalize(word),
        post.count - length > before.count - net.removed - 1
      {
        let last = post[post.count - length - 1]
        if last.isLetter || last.isNumber {
          fail("swipeGlued", "swipe joined the previous word")
        } else if ".,!?;:".contains(last) {
          fail("swipeGlued", "swipe joined punctuation", tag: "afterPunctuation")
        }
      }
    }

    // I17: the space after undoing an autocorrection keeps the literal.
    if undidAutocorrect {
      if isTerminator, net.removedText.contains(where: \.isLetter) {
        fail("recorrectAfterUndo", "re-corrected the restored literal")
      }
      if net.edited { undidAutocorrect = false }
    }

    // I6: Backspace.
    if isBackspace {
      let multi = net.removed > 1 || !net.inserted.isEmpty
      if !preSelection.isEmpty, net.removed > 0 {
        fail("backspaceDeletedTooMuch", "deleted beyond the selection", tag: "selection")
      } else if multi {
        if let last = chain.last {
          let acceptable = chain.flatMap(\.acceptable)
          // Host edits far from the cursor may since have changed the start of the text.
          if !acceptable.contains(where: { $0.suffix(32) == postBefore.suffix(32) }) {
            fail("undoInexact", "multi-character delete is not an exact undo (expected one of \(acceptable.map(\.debugDescription)))")
          } else if last.autocorrect, chain.count == 1 {
            undidAutocorrect = true
          }
        } else {
          fail("backspaceDeletedTooMuch", "multi-character delete without a preceding word edit",
               tag: contextChangedSinceChain ? "afterContextChange" : "noWordUnit")
        }
      } else if !net.edited || (net.removed == 0 && net.inserted.isEmpty && !net.selectionConsumed) {
        if !preBefore.isEmpty || !preSelection.isEmpty {
          fail("backspaceNoop", "Backspace did nothing")
        }
      }
      chain = []
      contextChangedSinceChain = false
    }

    // I7: delete word.
    if isWordDelete {
      if !preSelection.isEmpty {
        if net.removed > 0 { fail("wordDeleteWrong", "deleted beyond the selection", tag: "selection") }
      } else if !preBefore.isEmpty, net.removed == 0 {
        fail("wordDeleteWrong", "deleted nothing")
      } else {
        var body = Array(net.removedText)[...]
        while let last = body.last, last.isWhitespace { body = body.dropLast() }
        if body.contains(where: \.isWhitespace) { fail("wordDeleteWrong", "spans two tokens") }
        if let first = body.first, Self.isWordCharacter(first), before.count > net.removed,
          Self.continuesWord(before, at: before.count - net.removed - 1)
        {
          fail("wordDeleteWrong", "left part of a word", tag: "partial")
        }
      }
      if !net.inserted.isEmpty { fail("wordDeleteWrong", "inserted text") }
      chain = []
    }

    // I9 - I11, I19: suggestion taps.
    if let tapped {
      var fresh = stale == nil
      var equivalentExists = false
      if let stale {
        let sameVersion = stale.capture.version == preVersion
        let sameState = sameVersion || stale.capture.state == trueStateBefore(preBefore, preAfter, preSelection)
        equivalentExists = preSuggestions.contains { $0.text == tapped.text && $0.kind == tapped.kind }
        if sameVersion, !stale.capture.pending { fresh = true }
        if !sameState, !equivalentExists, net.edited, host.text != preText {
          fail("staleSuggestionApplied", "stale \(tapped.kind) \(tapped.text.debugDescription) edited text")
        }
      }
      if fresh || equivalentExists, net.edited, host.text != preText {
        var result = postBefore
        if result.hasSuffix(" ") { result.removeLast() }
        if !Self.normalize(result).hasSuffix(Self.normalize(tapped.text)) {
          fail("suggestionWrongText", "\(tapped.kind) \(tapped.text.debugDescription) not at the cursor")
        }
      }
      // A kept literal followed by whitespace is already committed; there is nothing to insert.
      let committedLiteral = tapped.kind == .literal && preAfter.first?.isWhitespace == true
      if fresh, truthful, !pending, !net.edited, !committedLiteral {
        fail("freshSuggestionIgnored", "\(tapped.kind) \(tapped.text.debugDescription) ignored", tag: stale == nil ? "" : "sameState")
      }
      if isEmojiTap, net.edited {
        let removed = net.removedText
        if removed.contains(where: { !($0.isLetter || $0 == " " || $0 == "'" || $0 == "\u{2019}") }) ||
          removed.split(separator: " ").count > 4
        {
          fail("emojiTapOverreach", "emoji removed non-phrase text")
        }
        if preBefore.last?.isWhitespace == true, removed.contains(where: \.isLetter) {
          fail("emojiTapOverreach", "emoji removed committed words")
        }
      }
    }

    // I12: capitalization of tapped letters.
    if case let .letter(character, _, _) = op, net.edited {
      let manual: Bool = switch preShift {
      case .locked, .once(automatic: false): true
      default: false
      }
      if let last = net.inserted.last, last.isLetter, Self.normalize(String(last)) == Self.normalize(String(character)),
        String(last).uppercased() != String(last).lowercased(),
        truthful, !pending, !manual, !shiftHeld, !userTouchedShift,
        let expected = Self.expectsCapital(after: Array(postBefore.dropLast()), policy.capitalization)
      {
        let upper = last.isUppercase
        if upper, !expected {
          fail("capsSpurious", "capitalized \(last) (shift \(preShift), \(policy.capitalization))")
        } else if !upper, expected {
          fail("capsMissed", "did not capitalize \(last) (shift \(preShift), \(policy.capitalization))")
        }
      }
      userTouchedShift = false
    }

    // I14: literal fields.
    let literalField = !pendingField && deliveredField.traits.isPrivate
    if literalField {
      switch op {
      case let .letter(character, _, _):
        if net.removed > 0 || Self.normalize(net.inserted) != Self.normalize(String(character)) {
          fail("literalFieldTransform", "letter changed in \(deliveredField)")
        }
      case let .key(text, _):
        if net.removed > 0 || net.inserted != text {
          fail("literalFieldTransform", "key \(text.debugDescription) changed in \(deliveredField)")
        }
      case .space:
        if net.removed > 0 || net.inserted != " " { fail("literalFieldTransform", "space changed in \(deliveredField)") }
      case .returnKey:
        if net.removed > 0 || net.inserted != "\n" { fail("literalFieldTransform", "return changed in \(deliveredField)") }
      default: break
      }
    }

    // Word-unit chain for undo checks.
    if !isBackspace, !isWordDelete, net.edited {
      let insertedWord = net.inserted.contains { $0.isLetter || $0.unicodeScalars.contains { $0.properties.isEmojiPresentation } }
      let autocorrect = isTerminator && net.removedText.contains(where: \.isLetter)
      let wordUnit = insertedWord && (glideCalled || tapped != nil || autocorrect)
      if wordUnit {
        var acceptable = [preBefore]
        if !autocorrect { acceptable.append(preBefore + " ") }
        if glideCalled, let word = glideWord, Self.normalize(postBefore).hasSuffix(Self.normalize(word)) {
          // A swipe can also commit (and correct) the word being typed; undo removes only the swiped word.
          let stem = String(postBefore.dropLast(word.count))
          acceptable.append(stem)
          if stem.hasSuffix(" ") { acceptable.append(String(stem.dropLast())) }
        }
        let entry = ChainEntry(preBefore: preBefore, inserted: net.inserted, autocorrect: autocorrect, acceptable: acceptable)
        if net.removed > 0, let last = chain.last, net.removed <= last.inserted.count + 1 {
          chain.append(entry)
        } else {
          chain = [entry]
        }
        contextChangedSinceChain = false
      } else if host.text != preText {
        chain = []
        contextChangedSinceChain = false
      }
    }
  }

  func finish() -> FuzzRunResult {
    for word in personal.knownWords {
      let lowered = word.lowercased()
      if secretTokens.contains(where: { lowered.contains($0) }) {
        record("privateLearning", "learned a word containing a secret token: \(word)", tag: "final", truthful: true, pending: false)
      }
    }
    return FuzzRunResult(violations: violations, ops: ops, config: config, fingerprint: fingerprint,
                         executed: ops.count, skipped: skipped, finalText: host.text)
  }
}

// MARK: - Generator

struct FuzzGenerator {
  var rng: SeededGenerator
  var plan: [Character] = []
  /// The field a planned word's vocabulary was chosen for.
  var planField: FuzzField = .standard
  var chordLetters = 0
  var burst: [FuzzOp] = []
  var tapNoise: Double
  var ackProbability: Double
  var finishedWord = false

  static let common = [
    "the", "and", "you", "hello", "thanks", "there", "their", "they're", "going", "to", "be", "it's", "its", "don't",
    "i", "i'm", "what", "where", "we", "were", "we'll", "well", "can't", "new", "york", "okay", "ok", "so", "love",
    "good", "morning", "night", "pizza", "coffee", "heart", "red", "happy", "see", "soon", "lol", "omg", "a", "an",
    "in", "on", "at", "is", "was", "this", "that", "with", "for", "me", "my", "test", "beautiful", "tomorrow",
    "something", "friend", "yesterday", "because", "really", "people", "said", "time", "work", "home", "call",
    "later", "maybe", "sure", "yes", "no", "not", "have", "just", "like", "know", "think", "want", "need", "get",
    "iphone", "github", "pulpo", "london", "sarah", "thumbsup", "mr", "dr", "u", "ur",
  ]
  static let typos = [
    "teh", "wierd", "recieve", "becuase", "definately", "seperate", "tommorow", "adn", "taht", "thier", "hte",
    "waht", "jsut", "knwo", "dont", "im", "youre", "cant", "wont", "didnt", "isnt", "thats", "ive", "helo", "freind",
  ]
  static let unknown = ["zorbly", "blarf", "quixxo", "snarfle", "plonk", "wibble"]
  static let punctuation = [".", ".", ".", ",", ",", "!", "?", "?", "'", "\"", "-", ":", ";", "(", ")", "@", "#", "_", "/", "&", "1", "2", "5", "0", "$"]
  static let emoji = ["😀", "👍", "👍🏽", "❤️", "🍕", "👨‍👩‍👧", "🇺🇸", "🙏🏿"]
  static let transcripts = ["Then we left.", "hello there", "OK see you soon.", " spaced ", "What? Really!"]
  static let pastes = ["hello", " world ", "Copied text. ", "teh", "https://example.com", "\n", "two  spaces", "x", "Émile's café", "👍", "don't"]
  static let prefills = ["", "", "Hi", "Hello there. ", "Some existing text", "teh", "line one\nline two ", "a", "Hello world", "ok  "]

  init(seed: UInt64) {
    rng = SeededGenerator(state: seed &* 0x9E37_79B9_7F4A_7C15 ^ 0xF00D)
    tapNoise = [0, 0.12, 0.25][Int.random(in: 0..<3, using: &rng)]
    ackProbability = [0, 0.3, 0.7][Int.random(in: 0..<3, using: &rng)]
  }

  mutating func chance(_ p: Double) -> Bool { Double.random(in: 0..<1, using: &rng) < p }
  mutating func pick<T>(_ items: [T]) -> T { items[Int.random(in: 0..<items.count, using: &rng)] }
  mutating func dt(_ low: Double, _ high: Double) -> Double { (Double.random(in: low..<high, using: &rng) * 1000).rounded() / 1000 }

  mutating func config() -> FuzzConfig {
    var config = FuzzConfig()
    config.field = chance(0.8) ? .standard : pick([.twitter, .noAutocorrect, .words, .straightQuotes, .webSearch, .email, .secure])
    config.prefill = chance(0.3) ? pick(Self.prefills) : ""
    if chance(0.2) { config.settingsToggles = [pick(FuzzSetting.allCases)] }
    config.identities = chance(0.85)
    config.emptyAsNil = chance(0.15)
    return config
  }

  mutating func secretToken() -> String {
    "zq" + String((0..<Int.random(in: 3...6, using: &rng)).map { _ in pick(Array("abcdefghijklmnoprstuvwxy")) })
  }

  mutating func word(for field: FuzzField) -> String {
    switch field {
    case .email: return secretToken() + "@" + secretToken() + ".com"
    case .url: return "www." + secretToken() + ".com"
    case .secure, .username: return secretToken() + (chance(0.3) ? "!" : "")
    default: break
    }
    let roll = Double.random(in: 0..<1, using: &rng)
    var word: String
    if roll < 0.6 {
      word = pick(Self.common)
    } else if roll < 0.82 {
      word = pick(Self.typos)
    } else if roll < 0.9 {
      word = pick(Self.unknown)
    } else {
      word = String((0..<Int.random(in: 1...7, using: &rng)).map { _ in pick(Array("abcdefghijklmnoprstuvwy")) })
    }
    if chance(0.12), word.count > 2 { word = typo(word) }
    return word
  }

  mutating func typo(_ word: String) -> String {
    var letters = Array(word)
    let index = Int.random(in: 0..<letters.count, using: &rng)
    switch Int.random(in: 0..<3, using: &rng) {
    case 0 where index + 1 < letters.count && letters[index].isLetter && letters[index + 1].isLetter:
      letters.swapAt(index, index + 1)
    case 1 where letters[index].isLetter: letters.remove(at: index)
    default: if letters[index].isLetter { letters.insert(letters[index], at: index) }
    }
    return String(letters)
  }

  mutating func tap(_ character: Character) -> KeyPoint? {
    guard !chance(0.08), let byte = String(character).utf8.first, let center = LetterGeometry.qwerty.center(byte) else { return nil }
    let x = center.x + rng.gaussian(tapNoise), y = center.y + rng.gaussian(tapNoise * 0.8)
    return KeyPoint(x: (x * 1000).rounded() / 1000, y: (y * 1000).rounded() / 1000)
  }

  mutating func planned(_ run: FuzzRun) -> FuzzOp {
    let character = plan.removeFirst()
    finishedWord = plan.isEmpty
    if character.isLetter {
      if run.engine.page != .letters {
        plan.insert(character, at: 0)
        return .page(.letters)
      }
      if chordLetters > 0 {
        chordLetters -= 1
        if chordLetters == 0 { burst.append(.shiftUp) }
      }
      return .letter(character, tap(character), dt: dt(0.06, 0.3))
    }
    return .key(String(character), dt: dt(0.1, 0.4))
  }

  mutating func next(_ run: FuzzRun) -> FuzzOp {
    if !burst.isEmpty { return burst.removeFirst() }
    var op: FuzzOp
    if finishedWord {
      // Real typing mostly ends a word with a space or punctuation.
      finishedWord = false
      let roll = Double.random(in: 0..<1, using: &rng)
      if roll < 0.6 {
        op = .space(dt: chance(0.15) ? dt(1, 3) : dt(0.08, 0.4))
      } else if roll < 0.72, !run.deliveredField.isNumeric {
        op = .key(pick([".", ",", "!", "?", "."]), dt: dt(0.1, 0.5))
        if chance(0.6) { burst.append(.space(dt: dt(0.08, 0.4))) }
      } else {
        op = choose(run)
      }
    } else {
      op = choose(run)
    }
    if op.isKeyboardEdit, chance(ackProbability) { burst.append(.ack) }
    return op
  }

  mutating func choose(_ run: FuzzRun) -> FuzzOp {
    let field = run.deliveredField
    if field.isNumeric {
      switch Int.random(in: 0..<100, using: &rng) {
      case 0..<55: return .key(String(Int.random(in: 0...9, using: &rng)), dt: dt(0.08, 0.3))
      case 55..<60: return .key(field == .decimal ? "." : "0", dt: 0.2)
      case 60..<75: return .backspace(dt: dt(0.08, 0.3))
      case 75..<78: return .deleteWord
      case 78..<84: return .ack
      case 84..<88: return .moveCursor(dt(0, 1), pick([.now, .now, .pending]))
      case 88..<95: return fieldSwitch()
      default: return .dismissShow
      }
    }
    // A field change (including a delayed one arriving) starts a new word.
    if planField != field { plan = [] }
    if !plan.isEmpty, chance(0.88) { return planned(run) }
    let weights: [(Double, Int)] = [
      (34, 0), (9, 1), (5, 2), (2, 3), (0.5, 4), (1, 5), (7, 6), (1.5, 7), (1.5, 8), (6, 9), (2, 10), (8, 11),
      (0.5, 12), (1, 13), (1, 14), (0.5, 15), (0.5, 16), (1.5, 17), (1.5, 18), (1, 19), (0.5, 20), (0.5, 21),
      (0.3, 22), (2, 23), (1.5, 24), (0.8, 25), (0.4, 26), (0.3, 27),
    ]
    var roll = Double.random(in: 0..<weights.reduce(0) { $0 + $1.0 }, using: &rng)
    var choice = 0
    for (weight, id) in weights {
      if roll < weight { choice = id; break }
      roll -= weight
    }
    switch choice {
    case 0:
      planField = field
      plan = Array(word(for: field))
      if field.usesSecretTokens { run.secretTokens.formUnion(secretParts(String(plan))) }
      if chance(0.06) { burst.append(.shiftTap) }
      return planned(run)
    case 1: return .space(dt: chance(0.2) ? dt(1, 3) : dt(0.08, 0.4))
    case 2: return .key(pick(Self.punctuation), dt: dt(0.1, 0.5))
    case 3: return .shiftTap
    case 4: return .shiftDoubleTap
    case 5:
      if run.shiftHeld { return .shiftUp }
      planField = field
      plan = Array(word(for: field))
      chordLetters = Int.random(in: 1...3, using: &rng)
      return .shiftDown
    case 6: return .backspace(dt: dt(0.08, 0.4))
    case 7:
      let count = Int.random(in: 2...9, using: &rng)
      burst = Array(repeating: FuzzOp.backspace(dt: 0.1), count: count - 1)
      if chance(0.4) { burst += Array(repeating: FuzzOp.deleteWord, count: Int.random(in: 1...3, using: &rng)) }
      return .backspace(dt: 0.1)
    case 8: return .deleteWord
    case 9: return .tapSlot(Int.random(in: 0..<3, using: &rng))
    case 10: return .tapStale(age: Int.random(in: 1...6, using: &rng), slot: Int.random(in: 0..<3, using: &rng))
    case 11:
      var word = field.usesSecretTokens ? secretToken() : pick(Self.common)
      word = word.filter(\.isLetter)
      if word.count < 2 { word = "hello" }
      if field.usesSecretTokens { run.secretTokens.insert(word) }
      return .swipe(word, seed: rng.next() % 100_000, noise: pick([0, 0.1, 0.2]))
    case 12: return .garbageSwipe(seed: rng.next() % 100_000)
    case 13: return .returnKey
    case 14: return .emoji(pick(Self.emoji))
    case 15: return .transcript(pick(Self.transcripts))
    case 16: return .page(pick([.numbers, .symbols, .letters]))
    case 17: return .paste(pick(Self.pastes), delivery())
    case 18: return .moveCursor(dt(0, 1.01), delivery())
    case 19: return .select(dt(0, 1), Int.random(in: 1...8, using: &rng), delivery())
    case 20: return .replaceAll(pick(["", "", "Sent. ", "New draft"]), delivery())
    case 21: return .deleteRange(dt(0, 1), Int.random(in: 1...6, using: &rng), delivery())
    case 22: return .typeAfter(pick([" later", "x", "! "]), delivery())
    case 23: return .deliver
    case 24:
      switch Int.random(in: 0..<10, using: &rng) {
      case 0..<5: return .lag(Int.random(in: 1...3, using: &rng), ops: Int.random(in: 1...6, using: &rng))
      case 5..<7: return .reentrant(ops: Int.random(in: 1...6, using: &rng))
      case 7..<9: return .hide(ops: Int.random(in: 1...4, using: &rng))
      default: return .window(pick([nil, nil, 24, 48]))
      }
    case 25: return fieldSwitch()
    case 26: return .dismissShow
    default: return .toggle(pick(FuzzSetting.allCases))
    }
  }

  func secretParts(_ text: String) -> [String] {
    text.split { !$0.isLetter }.map(String.init).filter { $0.hasPrefix("zq") }
  }

  mutating func delivery() -> FuzzDelivery { chance(0.75) ? .now : .pending }

  mutating func fieldSwitch() -> FuzzOp {
    let field: FuzzField = chance(0.55) ? .standard : pick(FuzzField.allCases)
    let prefill = field.isNumeric ? pick(["", "12"]) : (field.usesSecretTokens ? "" : pick(Self.prefills))
    plan = []
    chordLetters = 0
    return .fieldSwitch(field, prefill: prefill, cursor: chance(0.8) ? nil : dt(0, 1), identity: rng.next() % 1_000_000,
                        chance(0.88) ? .now : .pending)
  }
}

// MARK: - Driver

extension EngineFuzz {
  static func generate(seed: UInt64, count: Int) -> FuzzRunResult {
    var generator = FuzzGenerator(seed: seed)
    let run = FuzzRun(seed: seed, config: generator.config())
    for _ in 0..<count { run.execute(generator.next(run)) }
    if run.shiftHeld { run.execute(.shiftUp) }
    return run.finish()
  }

  static func replay(seed: UInt64 = 0, config: FuzzConfig, ops: [FuzzOp]) -> FuzzRunResult {
    let run = FuzzRun(seed: seed, config: config)
    for op in ops { run.execute(op) }
    return run.finish()
  }

  /// Delta-debugging shrink keeping a violation of the same class and tag.
  static func shrink(seed: UInt64, config: FuzzConfig, ops: [FuzzOp], key: String, budget: Int = 1500) -> [FuzzOp] {
    var replays = 0
    func reproduces(_ candidate: [FuzzOp]) -> Bool {
      replays += 1
      return replay(seed: seed, config: config, ops: candidate).violations.contains { $0.key == key }
    }
    var current = ops
    var granularity = 2
    while current.count >= 2, replays < budget {
      let chunk = max(1, current.count / granularity)
      var removedAny = false
      var start = 0
      while start < current.count, replays < budget {
        let end = min(current.count, start + chunk)
        let candidate = Array(current[..<start] + current[end...])
        if !candidate.isEmpty, reproduces(candidate) {
          current = candidate
          removedAny = true
        } else {
          start += chunk
        }
      }
      if !removedAny {
        if chunk == 1 { break }
        granularity = min(granularity * 2, current.count)
      } else {
        granularity = max(granularity - 1, 2)
      }
    }
    return current
  }
}
