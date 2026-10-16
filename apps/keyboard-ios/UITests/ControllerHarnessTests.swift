import UIKit
import XCTest
@testable import KeyboardUI

/// Suggestion taps through the real view controller, controller, engine and bar,
/// with host callbacks that arrive late, batched or duplicated, a slow host and
/// bar refreshes that land on the next run-loop pass.
@MainActor
final class ControllerHarnessTests: XCTestCase {
  let heart = "\u{2764}\u{FE0F}"

  func testNewHarnessClearsUnsavedPinnedLiteralsAndTapCalibration() throws {
    let first = ControllerHarness(waitsForEmoji: false)
    let firstSuggester = try XCTUnwrap(first.engine.suggester)
    first.type("and teh ")
    guard first.engine.deleteUndoesLastEdit else {
      XCTFail("Expected the setup to autocorrect teh before explicitly undoing it")
      return
    }
    let delete = try XCTUnwrap(first.controller.rootView.keys.keyViews.first { $0.key.action == .delete })
    XCTAssertTrue(delete.accessibilityActivate())
    first.settle()
    XCTAssertEqual(first.proxy.host.string, "And teh")
    XCTAssertTrue(firstSuggester.model.personal.isKnown("teh"))
    XCTAssertTrue(firstSuggester.model.personal.hasUnsavedChanges)
    let touch = try XCTUnwrap(firstSuggester.corrector.touch)
    let geometry = firstSuggester.corrector.geometry
    touch.learn(TypedWord(text: "the", taps: "the".utf8.map { geometry.center($0) }), intended: "the", geometry: geometry)
    XCTAssertGreaterThan(touch.weight, 0)

    let second = ControllerHarness(waitsForEmoji: false)
    let secondSuggester = try XCTUnwrap(second.engine.suggester)
    XCTAssertTrue(firstSuggester.model.personal === secondSuggester.model.personal, "Exercise the shared in-process model")
    XCTAssertFalse(secondSuggester.model.personal.isKnown("teh"))
    XCTAssertEqual(secondSuggester.model.personal.totalCount, 0)
    XCTAssertEqual(secondSuggester.corrector.touch?.weight, 0)
    second.type("and teh ")
    XCTAssertEqual(second.proxy.host.string, "And the ")
    XCTAssertTrue(second.engine.deleteUndoesLastEdit)
  }

  // MARK: A tap on what the person saw applies

  /// The installed-extension failure: under load the tap lands well over a second
  /// after the last key, before the host has applied it.
  func testDisplayedEmojiAppliesWhileTheHostLagsBehindTheTap() throws {
    let harness = ControllerHarness()
    harness.type("i want red hear")
    harness.now += 0.25
    harness.tap("t")
    harness.pump()
    XCTAssertNotNil(harness.slot(heart), "\(harness.displayed)")
    harness.now += 1.5
    XCTAssertNotNil(harness.tapSlot(heart))
    harness.pump()
    harness.settle()
    XCTAssertEqual(harness.proxy.host.string, "I want \(heart)")
  }

  func testDisplayedWordAppliesWhileTheHostLagsBehindTheTap() throws {
    let harness = ControllerHarness()
    harness.type("i want bea")
    harness.now += 0.25
    harness.tap("u")
    harness.pump()
    harness.now += 2
    XCTAssertNotNil(harness.tapSlot("beautiful"), "\(harness.displayed)")
    harness.pump()
    harness.settle()
    XCTAssertEqual(harness.proxy.host.string, "I want beautiful ")
  }

  /// The host applied every key, but its report of an earlier key arrives over a
  /// second late. The engine must not take it for a host edit back to that text.
  func testLateReportOfAnEarlierKeyKeepsTheDisplayedEmoji() throws {
    for optimistic in [false, true] {
      for refreshBeforeTap in [false, true] {
        let harness = ControllerHarness(optimistic: optimistic)
        harness.type("i want red hea")
        for letter in "rt" {
          harness.now += 0.25
          harness.tap(letter)
          harness.proxy.hostApplies()
          harness.pump()
        }
        XCTAssertNotNil(harness.slot(heart), "\(harness.displayed)")
        harness.now += 1.3
        harness.deliver(1)
        if refreshBeforeTap { harness.pump() }
        XCTAssertNotNil(harness.tapSlot(heart), "optimistic \(optimistic): \(harness.displayed)")
        harness.pump()
        harness.settle()
        harness.pump()
        XCTAssertEqual(harness.proxy.host.string, "I want \(heart)", "optimistic \(optimistic), refresh \(refreshBeforeTap)")
      }
    }
  }

  func testDuplicatedBatchedAndSilentReportsKeepTheDisplayedWord() throws {
    let patterns: [[ControllerHarness.Callback]] = [
      [.textDid, .textDid, .selectionDid], [.selectionWill, .selectionDid], [],
      [.textWill, .textDid, .selectionWill, .selectionDid, .textDid],
    ]
    for pattern in patterns {
      let harness = ControllerHarness()
      harness.type("i want ")
      for letter in "beau" {
        harness.now += 0.3
        harness.tap(letter)
      }
      harness.pump()
      XCTAssertNotNil(harness.slot("beautiful"), "\(harness.displayed)")
      harness.now += 1.6
      harness.proxy.hostApplies(batched: true)
      harness.deliver(callbacks: pattern)
      harness.deliver(callbacks: pattern)
      XCTAssertNotNil(harness.tapSlot("beautiful"))
      harness.pump()
      harness.settle()
      XCTAssertEqual(harness.proxy.host.string, "I want beautiful ", "\(pattern)")
    }
  }

  /// The emoji index finishes off the typing path and can land between a bar
  /// refresh and the tap. It changes what may be offered next, not the shown text.
  func testEmojiIndexArrivingBeforeTheTapKeepsTheDisplayedWord() throws {
    let harness = ControllerHarness()
    harness.type("i want beau")
    XCTAssertNotNil(harness.slot("beautiful"), "\(harness.displayed)")
    let index = try XCTUnwrap(ControllerFuzzRun.emojiIndex)
    harness.controller.emojiResourcesLoaded(catalog: index.0, suggester: index.1)
    XCTAssertNotNil(harness.tapSlot("beautiful"))
    harness.settle()
    XCTAssertEqual(harness.proxy.host.string, "I want beautiful ")
  }

  /// Hosts re-send traits with text callbacks; appearance or return-key changes
  /// leave the input policy, and so the shown choices, as they were.
  func testTraitChangesThatKeepThePolicyKeepTheDisplayedWord() throws {
    for change in ["appearance", "return"] {
      let harness = ControllerHarness()
      harness.type("i want beau")
      XCTAssertNotNil(harness.slot("beautiful"))
      if change == "appearance" { harness.proxy.keyboardAppearanceValue = .dark } else { harness.proxy.returnKeyTypeValue = .send }
      harness.fire([.selectionWill, .selectionDid])
      XCTAssertNotNil(harness.tapSlot("beautiful"))
      harness.settle()
      XCTAssertEqual(harness.proxy.host.string, "I want beautiful ", change)
    }
  }

  /// Field switches in quick succession, each reported once with callbacks, keep
  /// one field's choices out of the other and leave the returned-to field usable.
  func testRapidFieldSwitchesKeepEachFieldsChoicesApart() throws {
    let harness = ControllerHarness()
    let first = try XCTUnwrap(harness.proxy.identifier)
    harness.type("i want beau")
    XCTAssertNotNil(harness.slot("beautiful"))
    let firstText = harness.proxy.host
    harness.proxy.identifier = UUID()
    harness.proxy.hostChanges { $0 = SimulatedProxy.State("Hello ") }
    harness.deliver(callbacks: [.textWill, .selectionWill, .selectionDid, .textDid])
    let sent = harness.proxy.sentEdits
    harness.tapSlot("beautiful")
    XCTAssertEqual(harness.proxy.sentEdits, sent, "The first field's choice edited the second field")
    harness.pump()
    harness.proxy.identifier = first
    harness.proxy.hostChanges { $0 = firstText }
    harness.deliver()
    harness.pump()
    XCTAssertNotNil(harness.tapSlot("beautiful"), "\(harness.displayed)")
    harness.settle()
    XCTAssertEqual(harness.proxy.host.string, "I want beautiful ")
  }

  // MARK: Selection changes during a delete swipe

  func testNewHostSelectionDuringWordDeleteGestureAndVisibleUndoPreserveSurroundingText() throws {
    for optimistic in [false, true] {
      let harness = ControllerHarness(text: "prefix chosen suffix!", optimistic: optimistic, waitsForEmoji: false)
      let keys = harness.controller.rootView.keys
      let delete = try XCTUnwrap(harness.key(.delete))
      let initialEdits = harness.proxy.sentEdits

      // Touch-down deletes its own character before the finger becomes a swipe.
      harness.controller.keysView(keys, touchDown: delete)
      XCTAssertEqual(harness.proxy.outbox, [.delete])
      harness.settle()
      XCTAssertEqual(harness.proxy.host.string, "prefix chosen suffix")
      harness.controller.keysView(keys, previewWordDeletion: 3)

      // The host selects a different range while the gesture is still active.
      harness.proxy.hostChanges { state in
        state.cursor = "prefix ".count
        state.selection = "chosen".count
      }
      harness.deliver(callbacks: [.selectionWill, .selectionDid])
      XCTAssertEqual(harness.proxy.selectedText, "chosen")
      XCTAssertEqual(harness.proxy.sentEdits, initialEdits + 1)

      harness.controller.keysView(keys, commitWordDeletion: 3)
      XCTAssertEqual(harness.proxy.outbox, [.delete], "Selected text must be removed with one primitive, optimistic: \(optimistic)")
      XCTAssertEqual(harness.proxy.sentEdits, initialEdits + 2)
      harness.settle()
      harness.pump()
      XCTAssertEqual(harness.proxy.host.string, "prefix  suffix")

      let undo = try XCTUnwrap(harness.bar.subviews.compactMap { $0 as? UIButton }.first {
        $0.accessibilityIdentifier == "undo-delete" && !$0.isHidden
      })
      XCTAssertFalse(harness.bar.isHidden)
      undo.sendActions(for: .touchUpInside)
      XCTAssertEqual(harness.proxy.outbox, [.insert("chosen")])
      XCTAssertEqual(harness.proxy.sentEdits, initialEdits + 3)
      harness.settle()
      harness.pump()
      // The old gesture origin includes "!"; it must not enter selection undo.
      XCTAssertEqual(harness.proxy.host.string, "prefix chosen suffix")
      XCTAssertTrue(undo.isHidden)
    }
  }

  // MARK: Forgetting a word

  private func noticeAction(_ harness: ControllerHarness) -> UIButton? {
    var pending: [UIView] = [harness.bar]
    while let view = pending.popLast() {
      if let button = view as? UIButton, button.accessibilityIdentifier == "notice-action", !button.isHidden { return button }
      pending += view.subviews
    }
    return nil
  }

  /// Every host callback refreshes the bar. The offer to forget a word, still on
  /// screen, must still forget it when tapped.
  func testForgetOfferSurvivesBarRefreshes() throws {
    let harness = ControllerHarness()
    harness.type("i want beau")
    let word = try XCTUnwrap(harness.slot("beautiful")?.suggestion)
    var forgotten: [String] = []
    let forget = harness.bar.onForget
    harness.bar.onForget = { forgotten.append($0.text); forget?($0) }
    harness.bar.offerToForget(word)
    harness.fire([.selectionWill, .selectionDid])
    harness.pump()
    let index = try XCTUnwrap(ControllerFuzzRun.emojiIndex)
    harness.controller.emojiResourcesLoaded(catalog: index.0, suggester: index.1)
    harness.pump()
    XCTAssertTrue(harness.bar.isShowingNotice)
    try XCTUnwrap(noticeAction(harness)).sendActions(for: .touchUpInside)
    XCTAssertEqual(forgotten, ["beautiful"])
    XCTAssertFalse(harness.bar.isShowingNotice)
  }

  /// A loaded device can deliver a quick tap's lift past the hold delay. Only
  /// words have a hold action; on an emoji or kept literal a hold must not
  /// begin, since a recognized hold cancels the touch and the tap is lost.
  func testOnlyForgettableWordsCanBeHeld() throws {
    func holdBegins(_ harness: ControllerHarness, _ text: String) throws -> Bool {
      let slot = try XCTUnwrap(harness.slot(text), "\(harness.displayed)")
      let hold = try XCTUnwrap(slot.gestureRecognizers?.first { $0 is UILongPressGestureRecognizer })
      return slot.gestureRecognizerShouldBegin(hold)
    }
    let emoji = ControllerHarness()
    emoji.type("i want red heart")
    XCTAssertFalse(try holdBegins(emoji, heart))
    let words = ControllerHarness()
    words.type("i want zqxv")
    XCTAssertFalse(try holdBegins(words, try XCTUnwrap(words.displayed.first { $0.kind == .literal }).text))
    words.type(" beau")
    XCTAssertTrue(try holdBegins(words, "beautiful"))
  }

  func testDismissalWithdrawsTheForgetOffer() throws {
    let harness = ControllerHarness()
    harness.type("i want beau")
    harness.bar.offerToForget(try XCTUnwrap(harness.slot("beautiful")?.suggestion))
    harness.disappear()
    harness.appear()
    harness.pump()
    XCTAssertFalse(harness.bar.isShowingNotice)
    XCTAssertNotNil(harness.tapSlot("beautiful"))
    harness.settle()
    XCTAssertEqual(harness.proxy.host.string, "I want beautiful ")
  }

  // MARK: Stale choices still never apply

  func testChoicesFromEarlierTextCursorFieldOrPolicyNeverApply() throws {
    let cases = ["keystroke", "paste", "pasteSilently", "cursor", "field", "policy", "undoAfterAcknowledgment"]
    for name in cases {
      let harness = ControllerHarness()
      harness.type("i want beau")
      XCTAssertNotNil(harness.slot("beautiful"), name)
      let sent = harness.proxy.sentEdits
      harness.now += 1.5
      switch name {
      case "keystroke":
        harness.tap("t")
      case "paste":
        harness.proxy.hostChanges { $0.insert("ty") }
        harness.deliver()
      case "pasteSilently":
        harness.proxy.hostChanges { $0.insert("ty") }
        harness.proxy.receive()
      case "cursor":
        harness.proxy.hostChanges { $0.cursor = 2 }
        harness.proxy.receive()
      case "field":
        harness.proxy.identifier = UUID()
        harness.proxy.hostChanges { _ in }
        harness.deliver()
      case "policy":
        harness.proxy.keyboardTypeValue = .emailAddress
        harness.fire([.textWill, .textDid])
      default:
        // The host applied and reported "beau", then undid back to "I want ".
        harness.proxy.hostChanges { $0 = SimulatedProxy.State("I want ") }
        harness.deliver()
      }
      let edits = harness.proxy.sentEdits
      harness.tapSlot("beautiful")
      XCTAssertEqual(harness.proxy.sentEdits, edits, "\(name): a stale choice edited the text")
      if name == "keystroke" { XCTAssertEqual(edits, sent + 1) }
      harness.settle()
      XCTAssertFalse(harness.proxy.host.string.contains("beautiful"), name)
    }
  }
}

/// Randomized controller sequences checked by `ControllerFuzzRun`'s invariants.
/// Seed ranges are frozen: development 1...150 and held-out 100_001...100_150.
/// `PK_HARNESS_SEEDS` (`start-end`), `PK_HARNESS_OPS` and `PK_HARNESS_REPORT`
/// select a long run from `xcodebuild` through `TEST_RUNNER_` variables.
@MainActor
final class ControllerFuzzTests: XCTestCase {
  static func run(seeds: ClosedRange<UInt64>, ops: Int) -> (violations: [ControllerFuzzViolation], counts: [String: Int], repros: [String]) {
    var violations: [ControllerFuzzViolation] = []
    var counts: [String: Int] = [:]
    var repros: [String] = []
    for seed in seeds {
      var generator = ControllerFuzzGenerator(seed: seed)
      let run = ControllerFuzzRun(seed: seed, optimistic: seed % 2 == 0, emptyAsNil: seed % 5 == 0)
      for _ in 0..<ops { run.execute(generator.op()) }
      run.execute(.settle)
      run.execute(.pump)
      violations += run.violations
      for (key, value) in run.counts { counts[key, default: 0] += value }
      for violation in run.violations.prefix(1) where repros.count < 12 {
        repros.append("\(violation)\n  ops: [\(run.ops.prefix(violation.op + 1).map(\.description).joined(separator: ", "))]")
      }
    }
    return (violations, counts, repros)
  }

  func testShortRandomizedControllerSequencesKeepTapInvariants() {
    let result = Self.run(seeds: 1...6, ops: 80)
    XCTAssertGreaterThan(result.counts["freshTaps", default: 0], 5)
    let hard = result.violations.filter { !ControllerFuzzRun.ambiguousKinds.contains($0.kind) }
    XCTAssertTrue(hard.isEmpty, result.repros.joined(separator: "\n"))
  }

  func testLongRandomizedControllerRun() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let range = environment["PK_HARNESS_SEEDS"] else { throw XCTSkip("Set PK_HARNESS_SEEDS for a long run") }
    let bounds = range.split(separator: "-").compactMap { UInt64($0) }
    guard bounds.count == 2 else { throw XCTSkip("PK_HARNESS_SEEDS is start-end") }
    let ops = environment["PK_HARNESS_OPS"].flatMap(Int.init) ?? 150
    let started = Date()
    let result = Self.run(seeds: bounds[0]...bounds[1], ops: ops)
    var byKind: [String: Int] = [:]
    var seedsByKind: [String: Set<UInt64>] = [:]
    for violation in result.violations {
      byKind[violation.kind, default: 0] += 1
      seedsByKind[violation.kind, default: []].insert(violation.seed)
    }
    let lines = byKind.keys.sorted().map { "\($0): \(byKind[$0]!) violations / \(seedsByKind[$0]!.count) seeds" }
    let summary = "HARNESS seeds \(range) ops \(ops) in \(Int(Date().timeIntervalSince(started)))s counts \(result.counts.sorted { $0.key < $1.key })\n"
      + lines.joined(separator: "\n") + "\n" + result.repros.joined(separator: "\n")
    print(summary)
    if let path = environment["PK_HARNESS_REPORT"] { try? summary.write(toFile: path, atomically: true, encoding: .utf8) }
  }
}
