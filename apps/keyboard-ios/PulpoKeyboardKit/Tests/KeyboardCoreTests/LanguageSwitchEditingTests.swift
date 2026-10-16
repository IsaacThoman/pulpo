import Foundation
import Testing
@testable import KeyboardCore

struct LanguageSwitchEditingTests {
  private func replacement() throws -> LanguageStack {
    try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent("es.pkdict"), personalURL: nil)
  }

  @Test(arguments: [".", ",", "!", "?", ";", ":"])
  func suggestionSpacingSurvivesRepeatedLanguageChanges(punctuation: String) throws {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.type("teh")
    let choice = try #require(engine.suggestions.slots.first { $0.text == "the" })
    engine.select(choice)
    #expect(document.text == "prefix the ")
    let old = try #require(engine.suggestions.slots.first)
    let next = try replacement()
    engine.useLanguageStack(next)
    engine.useLanguageStack(next)
    engine.select(old) // An old model choice must still be ignored.
    #expect(document.text == "prefix the ")
    engine.insertCharacter(punctuation)
    #expect(document.text == "prefix the" + punctuation)
  }

  @Test(arguments: [".", ","])
  func swipeSpaceStaysAfterPunctuationBeforeHostText(punctuation: String) throws {
    let (engine, document) = Fixtures.engine("prefix world")
    document.moveCursor(to: 7)
    engine.documentDidChange()
    var generator = SeededGenerator(state: 782)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    #expect(document.text == "prefix hello world")
    let old = try #require(engine.suggestions.slots.first { $0.kind == .alternative })
    let next = try replacement()
    engine.useLanguageStack(next)
    engine.useLanguageStack(next)
    #expect(!engine.deleteUndoesLastEdit)
    #expect(engine.suggestions.slots.allSatisfy { $0.kind != .alternative })
    engine.select(old)
    #expect(document.text == "prefix hello world")
    engine.insertCharacter(punctuation)
    #expect(document.text == "prefix hello" + punctuation + " world")
  }

  @Test func explicitlyTypedSpaceStaysBeforePunctuation() throws {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.type("hello ")
    engine.useLanguageStack(try replacement())
    engine.insertCharacter(",")
    #expect(document.text == "prefix hello ,")
  }

  @Test func hostEditInvalidatesPreservedAutomaticSpace() throws {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.type("teh")
    engine.select(try #require(engine.suggestions.slots.first { $0.text == "the" }))
    engine.useLanguageStack(try replacement())
    document.text = "host "
    document.cursor = document.text.endIndex
    engine.documentDidChange()
    engine.insertCharacter(",")
    #expect(document.text == "host ,")
  }

  @Test func correctionUndoDoesNotSurviveLanguageChange() throws {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.type("teh ")
    #expect(document.text == "prefix the ")
    #expect(engine.deleteUndoesLastEdit)
    engine.useLanguageStack(try replacement())
    #expect(!engine.deleteUndoesLastEdit)
    engine.deleteBackward()
    #expect(document.text == "prefix the")
  }

  @Test func swipeUndoDoesNotSurviveLanguageChange() throws {
    let (engine, document) = Fixtures.engine("prefix world")
    document.moveCursor(to: 7)
    engine.documentDidChange()
    var generator = SeededGenerator(state: 782)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    #expect(document.text == "prefix hello world")
    #expect(engine.deleteUndoesLastEdit)
    engine.useLanguageStack(try replacement())
    #expect(!engine.deleteUndoesLastEdit)
    engine.deleteBackward()
    #expect(document.text == "prefix helloworld")
  }

  @Test func languageChangeInterruptsShiftDoubleTap() throws {
    let (engine, _) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .once(automatic: false))
    engine.useLanguageStack(try replacement())
    #expect(engine.shift == .once(automatic: false))
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .off)
  }

  @Test func languageChangePreservesIntentionalCapsLock() throws {
    let (engine, document) = Fixtures.engine("prefix ")
    engine.clock = { 100 }
    engine.shiftDown(); engine.shiftUp()
    engine.shiftDown(); engine.shiftUp()
    #expect(engine.shift == .locked)
    engine.useLanguageStack(try replacement())
    #expect(engine.shift == .locked)
    engine.insertCharacter("a")
    #expect(document.text == "prefix A")
  }
}
