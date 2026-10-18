import Testing
@testable import KeyboardCore

struct ExternalTextSpacingTests {
  @Test(arguments: [", next", ".", "!", "?", ";", ":", ")", "]", "}", "”", "’", "…"])
  func suppliedClosingPunctuationAttaches(text: String) {
    let (engine, document) = Fixtures.engine("word")
    engine.insertText(text, spacing: true)
    #expect(document.text == "word" + text)
  }

  @Test(arguments: [" ", "\t", "\n"])
  func suppliedWhitespaceIsPreservedWithoutAnExtraSeparator(separator: String) {
    let (engine, document) = Fixtures.engine("word")
    engine.insertText(separator + "next  line\n", spacing: true)
    #expect(document.text == "word" + separator + "next  line\n")
  }

  @Test(arguments: ["(", "[", "{", "“", "‘", "¿", "¡", "\"", "'"])
  func textAttachesInsideOpeningDelimiters(opener: String) {
    let (engine, document) = Fixtures.engine("prefix " + opener)
    engine.insertText("next", spacing: true)
    #expect(document.text == "prefix " + opener + "next")
  }

  @Test(arguments: ["word", "word.", "word,", "word)", "word\"", "word'"])
  func wordsAndClosedDelimitersStillRequireASeparator(prefix: String) {
    let (engine, document) = Fixtures.engine(prefix)
    engine.insertText("next", spacing: true)
    #expect(document.text == prefix + " next")
  }

  @Test func defaultFixedTextRemainsLiteral() {
    let (engine, document) = Fixtures.engine("example")
    engine.insertText(".com")
    engine.insertText(" ")
    engine.insertText("🙂")
    #expect(document.text == "example.com 🙂")
  }

  @Test func punctuationConsumesASwipesOwedSpaceWithoutAddingOne() {
    let (engine, document) = Fixtures.engine("and ")
    var generator = SeededGenerator(state: 90)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    #expect(document.text == "and hello")
    #expect(engine.phantomSpace)
    engine.insertText(", friend")
    #expect(document.text == "and hello, friend")
    #expect(!engine.phantomSpace)
    engine.insertCharacter("!")
    #expect(document.text == "and hello, friend!")
  }

  @Test func suppliedSpaceConsumesASwipesOwedSpaceExactlyOnce() {
    let (engine, document) = Fixtures.engine("and ")
    var generator = SeededGenerator(state: 90)
    engine.insertGlide(SyntheticSwipe.points(for: "hello", noise: 0, generator: &generator))
    engine.insertText(" 🙂")
    #expect(document.text == "and hello 🙂")
    #expect(!engine.phantomSpace)
  }
}
