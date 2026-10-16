import Testing
@testable import KeyboardCore

/// Post-review integration checks; not a fresh blind evaluation.
struct ExternalTextSpacingBoundaryTests {
  @Test(arguments: [".NET", ".env", ":)", ":-)", ";)", "!important", "?flag", "’tis", "’s", ")tail", "”quoted", ",next"])
  func punctuationLedTokensKeepTheRequestedWordSeparator(text: String) {
    let (engine, document) = Fixtures.engine("Use")
    engine.insertText(text, spacing: true)
    #expect(document.text == "Use " + text)
  }

  @Test(arguments: [".NET", ".env", ":)", "!important", "?flag", "’tis"])
  func transcriptsKeepPunctuationLedTokensSeparatedAtTheCaret(text: String) {
    let (engine, document) = Fixtures.engine("Use suffix")
    document.moveCursor(to: 3)
    engine.documentDidChange()
    engine.insertTranscript(text)
    #expect(document.text == "Use " + text + " suffix")
    #expect(document.deletions == 0)
  }

  @Test(arguments: [", next", "?! next", "...", "… next", ")", "]}", "”", "’", "”) next"])
  func boundedPunctuationRunsAttachWithoutRewritingTheirRemainder(text: String) {
    let (engine, document) = Fixtures.engine("word")
    engine.insertText(text, spacing: true)
    #expect(document.text == "word" + text)
  }

  @Test(arguments: ["\u{00A0}", "\u{202F}", "\u{2003}", "\r\n"])
  func suppliedUnicodeWhitespaceIsPreservedExactly(separator: String) {
    let (engine, document) = Fixtures.engine("word")
    let supplied = separator + "next\tline  "
    engine.insertText(supplied, spacing: true)
    #expect(Array(document.text.utf8) == Array(("word" + supplied).utf8))
  }

  @Test(arguments: [".NET", ":)", "’tis", "’s", "...", ", next"])
  func literalInsertionWithoutAnOwedSpaceRemainsLiteral(text: String) {
    let (engine, document) = Fixtures.engine("word")
    engine.insertText(text, spacing: false)
    #expect(document.text == "word" + text)
  }

  @Test(arguments: [".NET", ":)", "!important", "?flag", "’tis"])
  func punctuationLedTokensConsumeAnOwedSwipeSpaceExactlyOnce(text: String) {
    let (engine, document) = Fixtures.engine("and ")
    var generator = SeededGenerator(state: 90)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    #expect(document.text == "and hello")
    #expect(engine.phantomSpace)
    engine.insertText(text)
    #expect(document.text == "and hello " + text)
    #expect(!engine.phantomSpace)
    engine.insertText("!")
    #expect(document.text == "and hello " + text + "!")
  }

  @Test func suppliedNBSPConsumesAnOwedSwipeSpaceWithoutDuplication() {
    let (engine, document) = Fixtures.engine("and ")
    var generator = SeededGenerator(state: 90)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    engine.insertText("\u{00A0}next")
    #expect(document.text == "and hello\u{00A0}next")
    #expect(!engine.phantomSpace)
  }

  @Test(arguments: ["\"", "'", "“", "‘", "¿", "¡"])
  func openQuotesAndSpanishOpenersStillAttachToFollowingText(opener: String) {
    let (engine, document) = Fixtures.engine("say " + opener)
    engine.insertText("next", spacing: true)
    #expect(document.text == "say " + opener + "next")
  }

  @Test(arguments: ["word\"", "word'", "word”", "word’"])
  func closedQuotesStillSeparateTheFollowingWord(prefix: String) {
    let (engine, document) = Fixtures.engine(prefix)
    engine.insertText("next", spacing: true)
    #expect(document.text == prefix + " next")
  }
}
