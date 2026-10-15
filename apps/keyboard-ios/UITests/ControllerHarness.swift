import UIKit
import XCTest
@testable import KeyboardUI

/// A text proxy whose host runs on a schedule the test controls, like the remote
/// host of a keyboard extension. The keyboard's own edits wait in an outbox until
/// the host applies them; the host's reports wait in an inbox until the proxy
/// receives them, and only then do callbacks fire. A test can therefore deliver
/// reports late, batched, duplicated or without callbacks, and interleave them
/// with bar refreshes and taps.
final class SimulatedProxy: NSObject, UITextDocumentProxy {
  struct State: Equatable, CustomStringConvertible {
    var text: [Character] = []
    var cursor = 0
    var selection = 0

    init(_ text: String = "", cursor: Int? = nil) {
      self.text = Array(text)
      self.cursor = cursor ?? self.text.count
    }

    var before: String { String(text[..<cursor]) }
    var after: String { String(text[(cursor + selection)...]) }
    var selected: String? { selection > 0 ? String(text[cursor..<(cursor + selection)]) : nil }
    var string: String { String(text) }
    var description: String { "\(before.debugDescription)|\(after.debugDescription)" }

    mutating func insert(_ inserted: String) {
      let left = String(text[..<cursor]) + inserted
      let right = String(text[(cursor + selection)...])
      text = Array(left + right)
      cursor = min(Array(left).count, text.count)
      selection = 0
    }

    mutating func deleteBackward() {
      if selection > 0 {
        text.removeSubrange(cursor..<(cursor + selection))
        selection = 0
      } else if cursor > 0 {
        text.remove(at: cursor - 1)
        cursor -= 1
      }
    }

    mutating func move(by offset: Int) {
      cursor = max(0, min(text.count, cursor + offset))
      selection = 0
    }

    mutating func apply(_ edit: Edit) {
      switch edit {
      case .insert(let inserted): insert(inserted)
      case .delete: deleteBackward()
      case .move(let offset): move(by: offset)
      }
    }
  }

  enum Edit: Equatable { case insert(String), delete, move(Int) }

  /// The host app's document.
  var host = State()
  /// What the proxy reports to the keyboard.
  var reported = State()
  var identifier: UUID? = UUID()
  /// Own edits the host has not applied yet.
  var outbox: [Edit] = []
  /// A host report: its state, and the host change it carries, if any.
  struct Report {
    var state: State
    var change: Int?
  }
  /// Host reports the proxy has not received yet.
  var inbox: [Report] = []
  /// Host-side changes made so far, and the latest one the proxy has received.
  var hostChangeCount = 0
  var receivedHostChange = 0
  var inboxHasHostChange: Bool { inbox.contains { $0.change != nil } }
  /// Some proxies apply the keyboard's edits to their snapshot before the host does.
  var optimistic = false
  /// UIKit can report an empty side of the cursor as nil.
  var emptyAsNil = false
  /// Total edits the keyboard sent, for telling an applied tap from an ignored one.
  var sentEdits = 0
  var keyboardAppearanceValue: UIKeyboardAppearance = .default
  var returnKeyTypeValue: UIReturnKeyType = .default
  var keyboardTypeValue: UIKeyboardType = .default

  init(text: String = "") {
    super.init()
    host = State(text)
    reported = host
  }

  /// The host's document once it has applied every edit already sent.
  var eventual: State {
    var state = host
    for edit in outbox { state.apply(edit) }
    return state
  }

  /// The host applies up to `count` pending edits, reporting each, or the batch once.
  func hostApplies(_ count: Int = .max, batched: Bool = false) {
    var applied = 0
    while applied < count, !outbox.isEmpty {
      host.apply(outbox.removeFirst())
      applied += 1
      if !batched { inbox.append(Report(state: host)) }
    }
    if batched, applied > 0 { inbox.append(Report(state: host)) }
  }

  /// A change made in the host app (paste, cursor move, clear, undo). The proxy
  /// learns of it with the next delivery.
  func hostChanges(_ change: (inout State) -> Void) {
    change(&host)
    hostChangeCount += 1
    inbox.append(Report(state: host, change: hostChangeCount))
  }

  /// Receives the next host report without any callback. Returns false when none is waiting.
  @discardableResult
  func receive() -> Bool {
    guard !inbox.isEmpty else { return false }
    let report = inbox.removeFirst()
    reported = report.state
    if let change = report.change { receivedHostChange = change }
    return true
  }

  // MARK: UITextDocumentProxy

  var documentContextBeforeInput: String? {
    let before = reported.before
    return emptyAsNil && before.isEmpty ? nil : before
  }

  var documentContextAfterInput: String? {
    let after = reported.after
    return emptyAsNil && after.isEmpty ? nil : after
  }

  var selectedText: String? { reported.selected }
  var documentInputMode: UITextInputMode? { nil }
  var documentIdentifier: UUID { identifier ?? UUID() }
  var hasText: Bool { !reported.text.isEmpty }

  override func value(forKey key: String) -> Any? {
    if key == "documentIdentifier" { return MainActor.assumeIsolated { identifier as NSUUID? } }
    return super.value(forKey: key)
  }

  func insertText(_ text: String) {
    sentEdits += 1
    outbox.append(.insert(text))
    if optimistic { reported.insert(text) }
  }

  func deleteBackward() {
    sentEdits += 1
    outbox.append(.delete)
    if optimistic { reported.deleteBackward() }
  }

  func adjustTextPosition(byCharacterOffset offset: Int) {
    outbox.append(.move(offset))
    if optimistic { reported.move(by: offset) }
  }

  func setMarkedText(_ markedText: String, selectedRange: NSRange) {}
  func unmarkText() {}

  var keyboardType: UIKeyboardType {
    get { keyboardTypeValue }
    set { keyboardTypeValue = newValue }
  }

  var keyboardAppearance: UIKeyboardAppearance {
    get { keyboardAppearanceValue }
    set { keyboardAppearanceValue = newValue }
  }

  var returnKeyType: UIReturnKeyType {
    get { returnKeyTypeValue }
    set { returnKeyTypeValue = newValue }
  }
}

/// The extension's principal class with its text proxy replaced.
final class HarnessKeyboardViewController: PulpoKeyboardViewController {
  let simulated: SimulatedProxy

  init(proxy: SimulatedProxy) {
    simulated = proxy
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override var textDocumentProxy: UITextDocumentProxy { simulated }
}

/// Drives the real view controller, controller, engine and bar against a
/// `SimulatedProxy`, with a virtual clock for the engine and explicit run-loop
/// passes for bar refreshes and the asynchronous emoji index.
@MainActor
final class ControllerHarness {
  enum Callback: CaseIterable { case textWill, textDid, selectionWill, selectionDid }

  static let languageData = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("LanguageData")

  let proxy: SimulatedProxy
  let viewController: HarnessKeyboardViewController
  var now: TimeInterval = 1_000

  var controller: KeyboardController { viewController.controller! }
  var engine: KeyboardEngine { controller.engine }
  var bar: SuggestionBarView { controller.rootView.bar }

  init(text: String = "", optimistic: Bool = false, emptyAsNil: Bool = false) {
    KeyboardResources.directory = Self.languageData
    Self.forgetLearnedWords()
    proxy = SimulatedProxy(text: text)
    proxy.optimistic = optimistic
    proxy.emptyAsNil = emptyAsNil
    viewController = HarnessKeyboardViewController(proxy: proxy)
    viewController.loadViewIfNeeded()
    viewController.view.frame = CGRect(x: 0, y: 0, width: 402, height: controller.preferredHeight)
    engine.clock = { [unowned self] in self.now }
    appear()
    _ = pump(until: { self.engine.emojiSuggester != nil }, timeout: 120)
    pump()
  }

  /// Learning and emoji use from one scenario must not reorder another's suggestions.
  static func forgetLearnedWords() {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    if let url = support?.appendingPathComponent("PersonalDictionary.json") { try? FileManager.default.removeItem(at: url) }
    for defaults in [UserDefaults.standard, AppGroup.defaults].compactMap({ $0 }) {
      defaults.removeObject(forKey: "emojiRecents")
      defaults.removeObject(forKey: "emojiTones")
    }
  }

  func appear() {
    viewController.beginAppearanceTransition(true, animated: false)
    viewController.endAppearanceTransition()
    viewController.view.layoutIfNeeded()
  }

  func disappear() {
    viewController.beginAppearanceTransition(false, animated: false)
    viewController.endAppearanceTransition()
  }

  // MARK: Run loop

  /// Runs pending main-queue work: bar refreshes and task continuations.
  func pump(_ passes: Int = 3) {
    for _ in 0..<passes { _ = CFRunLoopRunInMode(.defaultMode, 0.002, false) }
  }

  func pump(until condition: () -> Bool, timeout: TimeInterval) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
      if Date() > deadline { return false }
      RunLoop.main.run(until: Date().addingTimeInterval(0.01))
    }
    return true
  }

  // MARK: Host

  func fire(_ callbacks: [Callback]) {
    for callback in callbacks {
      switch callback {
      case .textWill: viewController.textWillChange(nil)
      case .textDid: viewController.textDidChange(nil)
      case .selectionWill: viewController.selectionWillChange(nil)
      case .selectionDid: viewController.selectionDidChange(nil)
      }
    }
  }

  /// The proxy receives up to `count` host reports, each followed by `callbacks`.
  func deliver(_ count: Int = .max, callbacks: [Callback] = [.textWill, .textDid]) {
    var delivered = 0
    while delivered < count, proxy.receive() {
      delivered += 1
      fire(callbacks)
    }
  }

  /// The host catches up and reports everything, as on an idle device.
  func settle(callbacks: [Callback] = [.textWill, .textDid]) {
    proxy.hostApplies()
    deliver(callbacks: callbacks)
  }

  // MARK: Keyboard

  func key(_ action: KeyAction) -> Key? {
    controller.rootView.keys.layout.rows.flatMap(\.keys).first { $0.action == action }
  }

  /// A tap on a key, as `KeysView` reports it: touch down, then activation.
  func tap(_ character: Character) {
    let keys = controller.rootView.keys
    let lower = String(character).lowercased()
    guard let key = character == " " ? key(.space) : key(.character(lower)) else {
      XCTFail("No key for \(character)")
      return
    }
    controller.keysView(keys, touchDown: key)
    let point = keys.letterCenters[Character(lower)] ?? CGPoint(x: keys.bounds.midX, y: keys.bounds.maxY - 20)
    controller.keysView(keys, activate: key, at: point)
  }

  /// Types `text`; with `settling`, the host applies and reports each key at once.
  func type(_ text: String, settling: Bool = true, interval: TimeInterval = 0.25) {
    for character in text {
      now += interval
      tap(character)
      if settling { settle() }
      pump()
    }
  }

  // MARK: Bar

  var slots: [SlotControl] { bar.subviews.compactMap { $0 as? SlotControl }.filter { !$0.isHidden } }
  var displayed: [Suggestion] { slots.compactMap(\.suggestion) }

  func slot(_ text: String) -> SlotControl? { slots.first { $0.suggestion?.text == text } }

  /// Taps the visible slot showing `text`, as a touch up inside it does.
  @discardableResult
  func tapSlot(_ text: String) -> Suggestion? {
    guard let slot = slot(text), let suggestion = slot.suggestion else { return nil }
    slot.sendActions(for: .touchUpInside)
    return suggestion
  }
}
