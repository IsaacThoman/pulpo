import Testing
@testable import KeyboardCore

struct ShiftSequenceTests {
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
