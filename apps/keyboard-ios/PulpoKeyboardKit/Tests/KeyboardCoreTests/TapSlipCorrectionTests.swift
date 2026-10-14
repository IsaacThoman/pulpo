import Foundation
import Testing
@testable import KeyboardCore

/// Tap slips found by the frozen tap benchmark: missed or mistyped spaces,
/// skipped apostrophes, and doubly mistyped words that context clearly identifies.
struct TapSlipCorrectionTests {
  let model: LanguageModel
  let suggester: Suggester

  init() {
    (model, suggester, _) = Fixtures.stack()
  }

  func centered(_ text: String) -> TypedWord {
    TypedWord(text: text, taps: text.map { character in
      TextNormalizer.key(String(character)).utf8.first.flatMap { LetterGeometry.qwerty.center($0) }
    })
  }

  func correction(_ word: TypedWord, after previous: String?, preceding: String? = nil) -> String? {
    let context = model.context(previousWord: previous, sentenceStart: previous == nil, precedingWord: preceding)
    return suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection
  }

  @Test(arguments: [("one", "ofthe", "of the"), ("is", "inthe", "in the"), ("I", "wantto", "want to"),
                    ("good", "additionto", "addition to"), ("was", "forsure", "for sure"), ("on", "mymind", "my mind")])
  func missedSpacesSplitIntoTwoWords(previous: String, typed: String, expected: String) {
    #expect(correction(centered(typed), after: previous) == expected)
  }

  @Test func spaceTapsLandingAboveTheSpaceBarBecomeSpaces() {
    var word = centered("stormsbon")
    let b = LetterGeometry.qwerty.center(Character("b").asciiValue!)!
    word.taps[6] = KeyPoint(x: b.x, y: b.y + 0.45)
    #expect(correction(word, after: "radio") == "storms on")
  }

  @Test func halvesMayCarryOneTouchDirectedSlip() {
    var word = centered("inrhe")
    let r = LetterGeometry.qwerty.center(Character("r").asciiValue!)!
    word.taps[2] = KeyPoint(x: r.x + 0.45, y: r.y)
    #expect(correction(word, after: "allowed") == "in the")
  }

  @Test(arguments: ["indifferent", "useState", "TikTok", "noto", "leta"])
  func validWordsCodeAndShortTokensAreNotSplit(typed: String) {
    let result = correction(centered(typed), after: "and")
    #expect(result?.contains(" ") != true, "\(typed) -> \(result ?? "nil")")
  }

  @Test func titleCasedTokensInsideASentenceAreNotSplit() {
    let context = model.context(previousWord: "with", sentenceStart: false)
    #expect(suggester.spaceSplit(for: centered("Isoutdated"), context: context) == nil)
  }

  @Test func closedCompoundsBeatTheirHalves() {
    var word = centered("anyrhing")
    let r = LetterGeometry.qwerty.center(Character("r").asciiValue!)!
    word.taps[3] = KeyPoint(x: r.x + 0.4, y: r.y)
    #expect(correction(word, after: "making", preceding: "not") == "anything")
  }

  @Test(arguments: [("think", "shes", "she's"), ("think", "hes", "he's"), ("and", "whats", "what's")])
  func skippedApostrophesAreRestoredBeforeDroppingALetter(previous: String, typed: String, expected: String) {
    #expect(correction(centered(typed), after: previous) == expected)
  }

  @Test func twoSlipsNeedStrongContextAndNoCloseRival() {
    #expect(correction(centered("vofeo"), after: "play") == "video")
    // Two dropped letters are not two touch slips, however common the result.
    #expect(suggester.suggestions(for: centered("theeat"), context: .unknown, autocorrect: true).autocorrection != "that")
  }

  @Test func committedSplitsReplaceTheTokenAndUndoRestoresIt() {
    let (engine, document) = Fixtures.engine("I ")
    engine.type("wantto ")
    #expect(document.text == "I want to ")
    engine.deleteBackward()
    #expect(document.text == "I wantto")
    engine.insertSpace()
    #expect(document.text == "I wantto ")
  }
}
