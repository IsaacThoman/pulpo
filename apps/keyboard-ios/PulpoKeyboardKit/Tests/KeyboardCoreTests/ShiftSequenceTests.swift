import Foundation
import Testing
@testable import KeyboardCore

struct ShiftSequenceTests {
  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_SHIFT_SEQUENCE_VERIFY"] != nil))
  func evaluateFrozenRapidCasingVerification() throws {
    struct Corpus: Decodable { var verify: [String] }
    struct Row: Codable {
      var word: String
      var interval: Double
      var output: String
      var passed: Bool
    }
    let url = Fixtures.languageData.deletingLastPathComponent().appendingPathComponent("audits/shift-sequence-probe.json")
    let words = try JSONDecoder().decode(Corpus.self, from: Data(contentsOf: url)).verify
    var rows: [Row] = []
    for interval in [0.08, 0.12, 0.20] {
      for word in words {
        let (engine, document) = Fixtures.engine("prefix ")
        var time = 100.0
        engine.clock = { time }
        for character in word {
          time += interval
          engine.type(String(character))
        }
        time += interval
        engine.insertSpace()
        let passed = document.text == "prefix " + word + " " && engine.shift != .locked
        rows.append(Row(word: word, interval: interval, output: document.text, passed: passed))
      }
    }
    print("Rapid casing verification: \(rows.filter(\.passed).count)/\(rows.count)")
    if let path = ProcessInfo.processInfo.environment["PK_SHIFT_SEQUENCE_REPORT"] {
      try JSONEncoder().encode(rows).write(to: URL(fileURLWithPath: path), options: .atomic)
    }
    #expect(!rows.isEmpty)
    let failures = rows.filter { !$0.passed }
    #expect(failures.isEmpty, "Rapid casing failures: \(failures)")
  }

  @Test func changingPagesInterruptsShiftTaps() {
    let (engine, _) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    engine.page = .numbers
    engine.page = .letters
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift != .locked)
  }

  @Test func assigningTheSamePagePreservesConsecutiveShiftTaps() {
    let (engine, _) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    engine.page = .letters
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .locked)
  }

  @Test(arguments: ["caret", "field", "selection"])
  func acceptedExternalChangesInterruptShiftTaps(change: String) {
    let (engine, document) = Fixtures.engine("prefix word ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    switch change {
    case "caret": document.moveCursor(to: 7)
    case "field": document.documentIdentifier = UUID()
    default: document.selectionOverride = "word"
    }
    engine.documentDidChange()
    #expect(engine.externalContextChanges == 1)
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift != .locked)
  }

  @Test(arguments: ["acknowledgment", "recent-lag", "window"])
  func ownContextCallbacksPreserveConsecutiveShiftTaps(callback: String) {
    let (engine, document) = Fixtures.engine("a sufficiently long prefix before this word ")
    engine.clock = { 100 }
    let earlier = document.text
    engine.insertCharacter("a")
    engine.shiftDown(); engine.shiftUp()
    if callback == "recent-lag" { document.contextBeforeOverride = earlier }
    if callback == "window" { document.contextBeforeOverride = String(document.text.suffix(24)) }
    engine.documentDidChange()
    #expect(engine.externalContextChanges == 0)
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .locked)
  }

  @Test func agedEchoingHostLagPreservesConsecutiveShiftTaps() {
    let (engine, document) = Fixtures.engine("prefix ")
    var time = 100.0
    engine.clock = { time }
    engine.insertCharacter("a")
    engine.documentDidChange()
    let echoed = document.text
    engine.insertCharacter("b")
    time += 1.2
    engine.shiftDown(); engine.shiftUp()
    document.contextBeforeOverride = echoed
    engine.documentDidChange()
    #expect(engine.laggingContextUpdates == 1)
    #expect(engine.externalContextChanges == 0)
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .locked)
  }

  @Test(arguments: ["page", "caret", "field"])
  func interruptionsPreserveIntentionalCapsLock(change: String) {
    let (engine, document) = Fixtures.engine("prefix word ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    engine.shiftDown(); engine.shiftUp()
    switch change {
    case "page": engine.page = .numbers; engine.page = .letters
    case "caret": document.moveCursor(to: 7); engine.documentDidChange()
    default: document.documentIdentifier = UUID(); engine.documentDidChange()
    }
    #expect(engine.shift == .locked)
    engine.insertCharacter("a")
    #expect(engine.shift == .locked)
  }

  @Test(arguments: [0.349, 0.35, 0.351])
  func doubleTapTimeoutBoundary(interval: Double) {
    let (engine, _) = Fixtures.engine("prefix ")
    var time = 0.0
    engine.clock = { time }
    engine.shiftDown(); engine.shiftUp()
    time = interval
    engine.shiftDown(); engine.shiftUp()
    #expect((engine.shift == .locked) == (interval < 0.35))
  }

  @Test(arguments: ["delete", "return", "suggestion"])
  func acceptedEditsInterruptShiftTaps(edit: String) throws {
    let (engine, document) = Fixtures.engine("prefix word")
    engine.clock = { 100 }
    let literal = try #require(engine.suggestions.slots.first { $0.kind == .literal })
    engine.shiftDown(); engine.shiftUp()
    switch edit {
    case "delete": engine.deleteBackward()
    case "return": engine.insertReturn()
    default: engine.select(literal)
    }
    #expect(document.text != "prefix word", "The interrupting action must actually edit")
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift != .locked)
  }

  @Test(arguments: ["eBay", "iOS", "macOS", "LaTeX", "McAfee", "YouTube"])
  func interveningCharactersBreakTheShiftDoubleTap(word: String) {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.type(word)
    #expect(document.text == "prefix " + word)
    #expect(engine.shift != .locked)
    engine.insertSpace()
    #expect(document.text == "prefix " + word + " ")
  }

  @Test func interveningSpaceBreaksTheShiftDoubleTap() {
    let (engine, _) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    engine.insertSpace()
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift != .locked)
  }

  @Test func heldShiftTypingDoesNotCountAsADoubleTap() {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.shiftDown()
    engine.insertCharacter("a")
    engine.shiftUp()
    engine.shiftDown()
    engine.insertCharacter("b")
    engine.shiftUp()
    engine.insertCharacter("c")
    #expect(document.text == "prefix ABc")
    #expect(engine.shift != .locked)
  }

  @Test func consecutiveShiftTapsStillLockCaps() {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .locked)
    engine.type("ab")
    #expect(document.text == "prefix AB")
  }
}
