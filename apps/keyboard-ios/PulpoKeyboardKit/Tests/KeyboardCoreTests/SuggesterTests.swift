import Foundation
import Testing
@testable import KeyboardCore

struct SuggesterTests {
  let model: LanguageModel
  let suggester: Suggester

  init() {
    (model, suggester, _) = Fixtures.stack()
  }

  func typed(_ text: String) -> TypedWord {
    TypedWord(text: text, taps: text.map { character in
      TextNormalizer.key(String(character)).utf8.first.flatMap { LetterGeometry.qwerty.center($0) }
    })
  }

  func correction(_ text: String, after previous: String? = nil) -> String? {
    let context = model.context(previousWord: previous, sentenceStart: previous == nil)
    return suggester.suggestions(for: typed(text), context: context, autocorrect: true).autocorrection
  }

  @Test(arguments: [
    ("teh", "the"), ("hwllo", "hello"), ("recieve", "receive"), ("becuase", "because"), ("adress", "address"),
    ("definately", "definitely"), ("wierd", "weird"), ("thw", "the"), ("tommorow", "tomorrow"), ("dont", "don't"),
    ("im", "I'm"), ("i", "I"), ("iphone", "iPhone"), ("cant", "can't"), ("somthing", "something"), ("wouldnt", "wouldn't"),
    ("Teh", "The"), ("TEH", "THE"), ("thier", "their"), ("yuo", "you"), ("acheive", "achieve"), ("goign", "going"),
  ])
  func correctsCommonTypos(input: String, expected: String) {
    #expect(correction(input, after: "and") == expected)
  }

  @Test(arguments: ["hello", "form", "its", "well", "were", "lol", "ok", "the", "a", "Monday", "email", "app", "AI"])
  func leavesRealWordsAlone(word: String) {
    #expect(correction(word, after: "and") == nil)
  }

  @Test func putsTheBestSuggestionInTheMiddle() {
    let context = model.context(previousWord: "and", sentenceStart: false)
    let set = suggester.suggestions(for: typed("teh"), context: context, autocorrect: true)
    #expect(set.slots.count == 3)
    #expect(set.slots[0] == Suggestion(text: "teh", kind: .literal))
    #expect(set.slots[1].text == "the" && set.slots[1].isAutocorrection)
  }

  @Test func completesWordsInProgress() {
    let context = model.context(previousWord: "the", sentenceStart: false)
    let texts = suggester.suggestions(for: typed("beau"), context: context, autocorrect: true).slots.map(\.text)
    #expect(texts.contains("beautiful"))
  }

  @Test func predictsTheNextWord() {
    #expect(suggester.predictions(context: model.context(previousWord: "thank", sentenceStart: false)).slots.map(\.text).contains("you"))
    #expect(suggester.predictions(context: model.context(previousWord: nil, sentenceStart: true)).slots.map(\.text).contains("I"))
    #expect(suggester.predictions(context: model.context(previousWord: "going", sentenceStart: false)).slots.map(\.text).contains("to"))
  }

  @Test func appliesTextReplacements() {
    suggester.textReplacements = ["omw": "On my way!"]
    let set = suggester.suggestions(for: typed("omw"), context: .unknown, autocorrect: false, replacements: true)
    #expect(set.autocorrection == "On my way!")
  }

  @Test func learnedWordsStopBeingCorrected() {
    let personal = PersonalDictionary(url: nil)
    let (model, suggester, _) = Fixtures.stack(personal: personal)
    let context = model.context(previousWord: "and", sentenceStart: false)
    #expect(suggester.suggestions(for: typed("pulpoy"), context: context, autocorrect: true).autocorrection != nil)
    personal.pin("pulpoy")
    #expect(suggester.suggestions(for: typed("pulpoy"), context: context, autocorrect: true).autocorrection == nil)
  }

  @Test func usesTouchLocationsToBreakTies() {
    // "cat" typed with the middle tap landing on the left edge of "s" (toward "a").
    let geometry = LetterGeometry.qwerty
    let a = geometry.center(UInt8(ascii: "a"))!
    let word = TypedWord(text: "cst", taps: [geometry.center(UInt8(ascii: "c")), KeyPoint(x: a.x + 0.55, y: a.y), geometry.center(UInt8(ascii: "t"))])
    let context = model.context(previousWord: "the", sentenceStart: false)
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == "cat")
  }

  @Test func suggestionsAreFastEnoughForEveryKeystroke() {
    let context = model.context(previousWord: "the", sentenceStart: false)
    let words = ["t", "th", "the", "thw", "inter", "interes", "internat", "becuase", "acommodate", "xylophon"]
    let clock = ContinuousClock()
    var worst = Duration.zero
    for word in words {
      // Best of five, so a busy machine doesn't fail a deterministic workload.
      let elapsed = (0..<5).map { _ in clock.measure { _ = suggester.suggestions(for: typed(word), context: context, autocorrect: true) } }.min()!
      worst = max(worst, elapsed)
    }
    print("Slowest suggestion pass: \(worst)")
    #expect(worst < .milliseconds(25))
  }
}
