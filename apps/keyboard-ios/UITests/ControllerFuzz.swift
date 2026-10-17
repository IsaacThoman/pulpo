import UIKit
import XCTest
@testable import KeyboardUI

/// One event in a controller-level sequence. Replays need no random source.
enum ControllerFuzzOp: Equatable, CustomStringConvertible {
  case key(Character)
  case hostApplies(Int, batched: Bool)
  case deliver(Int, callbacks: Int)
  /// The proxy receives a report without any callback.
  case receiveSilently
  case settle
  case pump
  case advance(Double)
  case tapSlot(Int)
  case paste(String)
  case clear
  case moveCursorToStart
  /// The host reverts to its state `age` changes ago, as an undo does.
  case hostUndo(age: Int)
  case emojiIndexArrives
  case appearanceFlip
  case dismissShow

  static let callbackPatterns: [[ControllerHarness.Callback]] = [
    [.textWill, .textDid], [.selectionWill, .selectionDid], [.textWill, .textDid, .selectionWill, .selectionDid],
    [.textDid, .textDid], [.selectionDid], [.textDid, .selectionDid, .textDid],
  ]

  var description: String {
    switch self {
    case .key(let c): return ".key(\(String(c).debugDescription))"
    case let .hostApplies(n, batched): return ".hostApplies(\(n), batched: \(batched))"
    case let .deliver(n, callbacks): return ".deliver(\(n), callbacks: \(callbacks))"
    case .receiveSilently: return ".receiveSilently"
    case .settle: return ".settle"
    case .pump: return ".pump"
    case .advance(let dt): return ".advance(\(dt))"
    case .tapSlot(let i): return ".tapSlot(\(i))"
    case .paste(let t): return ".paste(\(t.debugDescription))"
    case .clear: return ".clear"
    case .moveCursorToStart: return ".moveCursorToStart"
    case .hostUndo(let age): return ".hostUndo(age: \(age))"
    case .emojiIndexArrives: return ".emojiIndexArrives"
    case .appearanceFlip: return ".appearanceFlip"
    case .dismissShow: return ".dismissShow"
    }
  }
}

struct ControllerFuzzViolation: CustomStringConvertible {
  var kind: String
  var seed: UInt64
  var op: Int
  var detail: String
  var description: String { "[\(kind)] seed \(seed) op \(op): \(detail)" }
}

/// Runs sequences against `ControllerHarness` and checks suggestion taps:
///
/// - I1 `freshTapIgnored`: a tap on a displayed choice applies when the bar
///   showed it for the true document and, since then, neither the keyboard nor
///   the host changed the text, cursor, field or policy. Reports of the
///   keyboard's own edits may still be in flight, late, duplicated or batched.
///   A tap ignored after a late callback reporting an earlier own state is
///   counted apart (`freshTapIgnoredAfterLateReport`): to a host that never
///   echoed the keyboard's edits, that report looks exactly like an undo.
/// - I2 `staleTapApplied`: a tap on a choice shown before a later keystroke, a
///   host change the proxy has received, or a policy change edits nothing.
///   Host changes that recreate a state the keyboard itself produced are
///   counted apart (`ambiguousRevertApplied`): they look exactly like lag.
/// - I3 `freshTapWrongText`: an applied fresh choice ends at the cursor and
///   replaces only the word or phrase it was shown for.
@MainActor
final class ControllerFuzzRun {
  struct Render {
    var suggestions: [Suggestion]
    var sound: Bool
    var sent: Int
    var external: Int
    var policy: Int
    var before: String
    var after: String
    var lateReports: Int
  }

  /// Kinds that reflect an ambiguity no keyboard can resolve from the proxy:
  /// a host change that recreates one of its own states looks exactly like lag,
  /// and a late report of an earlier key looks exactly like an undo to it.
  static let ambiguousKinds: Set<String> = ["ambiguousRevertApplied", "freshTapIgnoredAfterLateReport"]

  let seed: UInt64
  let harness: ControllerHarness
  var renders: [Render] = []
  var policy = 0
  /// Reports of the keyboard's own edits that trail the text already sent,
  /// delivered with callbacks: a host still catching up.
  var lateReports = 0
  var hostHistory: [SimulatedProxy.State] = []
  /// Host states reached through the keyboard's own edits.
  var ownStates: [SimulatedProxy.State] = []
  var violations: [ControllerFuzzViolation] = []
  var counts: [String: Int] = [:]
  var ops: [ControllerFuzzOp] = []
  var opIndex = 0
  static let emojiIndex: (EmojiCatalog, EmojiSuggester)? = {
    guard let url = KeyboardResources.url("emoji", "json"), let catalog = try? EmojiCatalog.load(url: url) else { return nil }
    return (catalog, EmojiSuggester(catalog: catalog))
  }()

  init(seed: UInt64, optimistic: Bool, emptyAsNil: Bool) {
    self.seed = seed
    harness = ControllerHarness(optimistic: optimistic, emptyAsNil: emptyAsNil)
    hostHistory = [harness.proxy.host]
    record()
  }

  var proxy: SimulatedProxy { harness.proxy }

  func record() {
    let eventual = proxy.eventual
    // The bar must show what the engine offers now, for the text the host will hold.
    let sound = harness.engine.contextBeforeCursor == eventual.before && !proxy.inboxHasHostChange
      && harness.bar.suggestions == harness.engine.suggestions.slots
    let render = Render(suggestions: harness.bar.suggestions, sound: sound, sent: proxy.sentEdits, external: proxy.hostChangeCount,
                        policy: policy, before: eventual.before, after: eventual.after, lateReports: lateReports)
    renders.append(render)
    if renders.count > 64 { renders.removeFirst(renders.count - 64) }
  }

  func noteHost(own: Bool) {
    if hostHistory.last != proxy.host {
      hostHistory.append(proxy.host)
      if own { ownStates.append(proxy.host) }
    }
  }

  /// What each recent operation left behind, for reading a violation.
  var trace: [String] = []

  func fail(_ kind: String, _ detail: String) {
    let recent = trace.suffix(8).joined(separator: "\n    ")
    violations.append(ControllerFuzzViolation(kind: kind, seed: seed, op: opIndex, detail: detail + "\n    " + recent))
  }

  func execute(_ op: ControllerFuzzOp) {
    ops.append(op)
    defer {
      let engine = harness.engine
      trace.append("\(opIndex) \(op): reported \(proxy.reported), engine \(engine.contextBeforeCursor.debugDescription), external \(engine.externalContextChanges), lag \(engine.laggingContextUpdates), sent \(proxy.sentEdits)")
      if trace.count > 16 { trace.removeFirst() }
      opIndex += 1
    }
    switch op {
    case .key(let character):
      harness.now += 0.12
      harness.tap(character)
    case let .hostApplies(count, batched):
      proxy.hostApplies(count, batched: batched)
      noteHost(own: true)
    case let .deliver(count, callbacks):
      deliver(count, ControllerFuzzOp.callbackPatterns[callbacks % ControllerFuzzOp.callbackPatterns.count])
    case .receiveSilently:
      proxy.receive()
    case .settle:
      proxy.hostApplies()
      noteHost(own: true)
      deliver(.max, [.textWill, .textDid])
    case .pump:
      harness.pump()
      record()
    case .advance(let dt):
      harness.now += dt
    case .tapSlot(let index):
      tap(index)
    case .paste(let text):
      proxy.hostChanges { $0.insert(text) }
      noteHost(own: false)
    case .clear:
      proxy.hostChanges { $0 = SimulatedProxy.State() }
      noteHost(own: false)
    case .moveCursorToStart:
      proxy.hostChanges { $0.cursor = 0; $0.selection = 0 }
      noteHost(own: false)
    case .hostUndo(let age):
      guard hostHistory.count > age else { return }
      let target = hostHistory[hostHistory.count - 1 - age]
      proxy.hostChanges { $0 = target }
      noteHost(own: false)
    case .emojiIndexArrives:
      guard let (catalog, suggester) = Self.emojiIndex else { return }
      harness.controller.emojiResourcesLoaded(catalog: catalog, suggester: suggester)
    case .appearanceFlip:
      proxy.keyboardAppearanceValue = proxy.keyboardAppearanceValue == .dark ? .light : .dark
      harness.fire([.selectionWill, .selectionDid])
    case .dismissShow:
      harness.disappear()
      harness.now += 3
      harness.appear()
    }
  }

  func deliver(_ count: Int, _ callbacks: [ControllerHarness.Callback]) {
    var delivered = 0
    while delivered < count, let report = proxy.inbox.first {
      if report.change == nil, report.state != proxy.eventual, !callbacks.isEmpty { lateReports += 1 }
      proxy.receive()
      harness.fire(callbacks)
      delivered += 1
    }
  }

  func tap(_ index: Int) {
    let slots = harness.slots.filter { $0.suggestion != nil }
    guard !slots.isEmpty else { return }
    let slot = slots[index % slots.count]
    guard let suggestion = slot.suggestion else { return }
    guard let render = renders.last(where: { $0.suggestions.contains(suggestion) }) else {
      counts["unrenderedTap", default: 0] += 1
      return
    }
    let sentBefore = proxy.sentEdits
    let ownSince = sentBefore != render.sent
    let externalSince = proxy.hostChangeCount != render.external
    let externalKnown = proxy.receivedHostChange > render.external
    let policySince = policy != render.policy
    let fresh = render.sound && !ownSince && !externalSince && !policySince
    let stale = ownSince || externalKnown || policySince
    slot.sendActions(for: .touchUpInside)
    let applied = proxy.sentEdits > sentBefore
    counts[fresh ? "freshTaps" : stale ? "staleTaps" : "otherTaps", default: 0] += 1
    let describe = "\(suggestion.kind) \(suggestion.text.debugDescription) shown for \(render.before.debugDescription), reported \(proxy.reported), host \(proxy.host), eventual \(proxy.eventual)"
    if fresh, !applied { fail(lateReports != render.lateReports ? "freshTapIgnoredAfterLateReport" : "freshTapIgnored", describe) }
    if stale, applied {
      let reverted = externalKnown && ownStates.contains(proxy.reported)
      fail(reverted ? "ambiguousRevertApplied" : "staleTapApplied", describe)
    }
    if fresh, applied { checkResult(suggestion, render: render) }
  }

  func checkResult(_ suggestion: Suggestion, render: Render) {
    let eventual = proxy.eventual
    func normalized(_ text: String) -> String { text.replacingOccurrences(of: "\u{2019}", with: "'").lowercased() }
    var result = eventual.before
    if result.hasSuffix(" ") { result.removeLast() }
    let detail = "\(suggestion.kind) \(suggestion.text.debugDescription) on \(render.before.debugDescription) gave \(eventual.before.debugDescription)"
    guard normalized(result).hasSuffix(normalized(suggestion.text)), eventual.after == render.after else {
      fail("freshTapWrongText", detail)
      return
    }
    var prefix = String(result.dropLast(suggestion.text.count))
    if prefix.hasSuffix(" "), !render.before.hasPrefix(prefix) { prefix.removeLast() }
    guard render.before.hasPrefix(prefix) || prefix.hasSuffix(" ") && render.before.hasPrefix(String(prefix.dropLast())) else {
      fail("freshTapWrongText", detail + " (changed earlier text)")
      return
    }
    let kept = render.before.hasPrefix(prefix) ? prefix : String(prefix.dropLast())
    let removed = render.before.dropFirst(kept.count)
    if let last = kept.last, let first = removed.first, last.isLetter || last.isNumber, first.isLetter || first.isNumber {
      fail("freshTapWrongText", detail + " (cut a word)")
    }
  }
}

/// A deterministic generator for controller sequences.
struct ControllerFuzzGenerator {
  var state: UInt64
  var plan: [Character] = []

  static let phrases = [
    "i want red heart", "i want beau", "teh cat", "pizza", "happy ", "thank you ", "red hear", "the best ",
    "hello world ", "we saw ", "beautiful ", "coffee ",
  ]

  init(seed: UInt64) { state = seed &* 0x9E37_79B9_7F4A_7C15 &+ 1 }

  mutating func next() -> UInt64 {
    state = state &* 6364136223846793005 &+ 1442695040888963407
    var z = state
    z = (z ^ (z >> 33)) &* 0xff51afd7ed558ccd
    z = (z ^ (z >> 33)) &* 0xc4ceb93fe5a4d4b4
    return z ^ (z >> 33)
  }

  mutating func int(_ range: Range<Int>) -> Int { range.lowerBound + Int(next() % UInt64(range.count)) }
  mutating func chance(_ p: Double) -> Bool { Double(next() % 1_000_000) / 1_000_000 < p }

  mutating func op() -> ControllerFuzzOp {
    if !plan.isEmpty, chance(0.55) { return .key(plan.removeFirst()) }
    let roll = int(0..<100)
    switch roll {
    case 0..<10:
      if plan.isEmpty { plan = Array(Self.phrases[int(0..<Self.phrases.count)]) }
      return .key(plan.removeFirst())
    case 10..<20: return .hostApplies(int(1..<4), batched: chance(0.3))
    case 20..<30: return .deliver(int(1..<3), callbacks: int(0..<ControllerFuzzOp.callbackPatterns.count))
    case 30..<33: return .receiveSilently
    case 33..<40: return .settle
    case 40..<55: return .pump
    case 55..<62: return .advance(chance(0.3) ? Double(int(1000..<3500)) / 1000 : Double(int(20..<400)) / 1000)
    case 62..<80: return .tapSlot(int(0..<3))
    case 80..<82: return .paste(chance(0.5) ? " ok" : "x")
    case 82..<84: return .clear
    case 84..<85: return .moveCursorToStart
    case 85..<88: return .hostUndo(age: int(1..<4))
    case 88..<91: return .emojiIndexArrives
    case 91..<95: return .appearanceFlip
    case 95..<97: return .dismissShow
    default: return .advance(Double(int(20..<200)) / 1000)
    }
  }
}
