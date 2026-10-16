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
