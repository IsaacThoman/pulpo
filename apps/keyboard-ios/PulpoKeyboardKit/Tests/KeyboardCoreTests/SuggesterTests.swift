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

  @Test(arguments: KeyboardQualityTests.typos + [("i", "I"), ("iphone", "iPhone"), ("Teh", "The"), ("TEH", "THE")])
  func correctsCommonTypos(input: String, expected: String) {
    #expect((correction(input, after: "and") ?? input) == expected)
  }

  @Test(arguments: KeyboardQualityTests.literals)
  func leavesRealWordsAlone(word: String) {
    #expect(correction(word, after: "and") == nil)
  }

  @Test(arguments: [
    ("the nfl", "nfl"), ("and", "espn"), ("was", "katy"), ("follow", "brady"),
    ("to", "play"), ("you", "too"), ("of", "god"), ("really", "I'm"),
    ("to", "as"), ("think", "in"), ("I", "liked"), ("it", "was"), ("to", "pass"),
  ])
  func preservesValidWordsAgainstStrongContext(previous: String, word: String) {
    let context = model.context(previousWord: previous.split(separator: " ").last.map(String.init), sentenceStart: false)
    #expect(suggester.isValid(word))
    #expect(suggester.suggestions(for: typed(word), context: context, autocorrect: true).autocorrection == nil)
    #expect(suggester.suggestions(for: TypedWord(text: word), context: context, autocorrect: true).autocorrection == nil)
  }

  @Test func validWordMistapsStillUseTouchEvidence() {
    let context = model.context(previousWord: "think", sentenceStart: false, precedingWord: "I")
    var nearMiss = typed("in")
    let n = LetterGeometry.qwerty.center(Character("n").asciiValue!)!
    nearMiss.taps[1] = KeyPoint(x: n.x + 0.45, y: n.y)
    #expect(suggester.suggestions(for: nearMiss, context: context, autocorrect: true).autocorrection == "I'm")
    #expect(suggester.suggestions(for: typed("in"), context: context, autocorrect: true).autocorrection == nil)
    nearMiss.taps[1] = KeyPoint(x: n.x, y: n.y - 0.45)
    #expect(suggester.suggestions(for: nearMiss, context: context, autocorrect: true).autocorrection == nil)
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

  @Test func predictionsUseTwoWordsOfContext() {
    let context = model.context(previousWord: "my", sentenceStart: false, precedingWord: "on")
    #expect(context.trigram != nil)
    #expect(model.predictions(in: context, limit: 3).map(\.word).contains("way"))
    let greeting = model.context(previousWord: "are", sentenceStart: false, precedingWord: "how")
    #expect(model.predictions(in: greeting, limit: 3).first?.word == "you")
  }

  @Test(arguments: [("computing", "power"), ("ballet", "dancers"), ("Christmas", "trees"), ("fact", "about")])
  func smallerSuggestionStripsDoNotDiscardBetterBackoffCandidates(preceding: String, previous: String) {
    let context = model.context(previousWord: previous, sentenceStart: false, precedingWord: preceding)
    let expanded = model.predictions(in: context, limit: 20).map(\.word)
    #expect(model.predictions(in: context, limit: 3).map(\.word) == Array(expanded.prefix(3)))
    #expect(model.predictions(in: context, limit: 1).map(\.word) == Array(expanded.prefix(1)))
  }

  @Test func unknownAndSparseHistoriesStillOfferSafePredictions() {
    let context = model.context(previousWord: "Zorbly", sentenceStart: false)
    let words = model.predictions(in: context, limit: 3).map(\.word)
    #expect(words.count == 3)
    #expect(!words.contains { model.personal.isBlocked($0) })
    #expect(model.predictions(in: context, limit: 0).isEmpty)
    model.personal.forget(words[0])
    #expect(!model.predictions(in: context, limit: 3).map(\.word).contains(words[0]))
  }

  @Test func forgettingASentenceCapitalizedPredictionHidesItsOtherForms() {
    let personal = model.personal
    personal.pin("hello")
    personal.learn("hello", after: "say")
    personal.forget("Hello")
    #expect(personal.count(of: "hello") == 0)
    #expect(personal.pairCount("say", "hello") == 0)
    #expect(personal.isBlocked("hello"))
    #expect(personal.isBlocked("HELLO"))
    #expect(!suggester.predictions(context: model.context(previousWord: "say", sentenceStart: false)).slots.map(\.text).contains("hello"))
    personal.pin("hello")
    #expect(!personal.isBlocked("Hello"))
  }

  @Test func contextAlsoGuidesCompletions() {
    let context = model.context(previousWord: "my", sentenceStart: false, precedingWord: "on")
    let set = suggester.suggestions(for: typed("wa"), context: context, autocorrect: false)
    #expect(set.slots.map(\.text).contains("way"))
    #expect(set.autocorrection == nil)
    model.personal.pin("Zorbly")
    let personal = suggester.suggestions(for: typed("Zor"), context: .unknown, autocorrect: false)
    #expect(personal.slots.map(\.text).contains("Zorbly"))
  }

  @Test func dictionaryErrorEntriesAreNotValidSpellings() {
    #expect(!suggester.isValid("wierd"))
    #expect(correction("wierd", after: "is") == "weird")
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

  @Test(arguments: ["we're", "we’re", "don't", "don’t", "I'll", "ill", "résumé", "naïve", "café", "fooBar", "SwiftUI", "TypeScript", "Thoman", "Mireya", "npm", "pnpm"])
  func preservesIntentionalSpelling(word: String) {
    #expect(correction(word, after: "and") == nil)
  }

  @Test(arguments: [("youre", "you're"), ("theres", "there's"), ("togther", "together")])
  func prefersSafeSpellingOverAnUnrelatedFrequentWord(input: String, expected: String) {
    #expect(correction(input, after: "and") == expected)
  }

  @Test func aCompletionRetainsItsCorrectionEvidence() {
    let context = model.context(previousWord: "you", sentenceStart: false, precedingWord: "do")
    let word = typed("hav")
    let have = suggester.candidates(for: word, context: context).first { $0.text == "have" }
    #expect(have != nil)
    #expect(have?.isCompletion == false)
    #expect(have?.cost == SpellCorrector.insertionCost)
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == "have")
  }

  @Test(arguments: [("I", "said", "nah"), ("I", "am", "meh"), (nil, "sounds", "sus"), ("that", "was", "bruh")])
  func preservesUncertainShortConversationalTokens(preceding: String?, previous: String, word: String) {
    let context = model.context(previousWord: previous, sentenceStart: false, precedingWord: preceding)
    let set = suggester.suggestions(for: typed(word), context: context, autocorrect: true)
    #expect(set.autocorrection == nil)
    #expect(set.slots.contains { $0.text == word && $0.kind == .literal })
  }

  @Test(arguments: ["Soren", "Noor", "Asha"])
  func preservesNewNamesWithinASentence(word: String) {
    #expect(!suggester.isValid(word))
    #expect(correction(word, after: "with") == nil)
  }

  @Test func sentenceInitialCapitalizationStillAllowsSpellingCorrection() {
    #expect(correction("Helllo") == "Hello")
    #expect(correction("Teh", after: "and") == "The")
    #expect(correction("cant", after: "I") == "can't")
  }

  @Test(arguments: ["amd", "bern"])
  func spellingShortcutsDoNotReplaceValidCaseAliases(word: String) {
    #expect(suggester.isValid(word))
    for previous in ["and", "with", "the"] {
      #expect(correction(word, after: previous) == nil)
    }
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

  @Test func suggestionsStayResponsiveWithAFullPersonalDictionary() {
    let personal = PersonalDictionary(url: nil)
    for index in 0..<PersonalDictionary.maximumWords {
      var number = index
      var suffix = ""
      for _ in 0..<4 {
        suffix.append(Character(UnicodeScalar(97 + number % 26)!))
        number /= 26
      }
      personal.pin("name" + suffix)
    }
    let (_, suggester, _) = Fixtures.stack(personal: personal)
    let clock = ContinuousClock()
    let time = (0..<3).map { _ in clock.measure {
      _ = suggester.suggestions(for: TypedWord(text: "nametyp"), context: .unknown, autocorrect: true)
    } }.min()!
    print("Full personal dictionary suggestion time: \(time)")
    #expect(time < .milliseconds(25))
  }
  @Test func shortMissingVowelsCanHaveAnUnambiguousFamiliarTarget() {
    let context = LanguageContext.unknown
    #expect(suggester.suggestions(for: TypedWord(text: "hllo"), context: context, autocorrect: true).autocorrection == "hello")
    for literal in ["nah", "cuz", "bruh", "JSON", "API"] {
      #expect(suggester.suggestions(for: TypedWord(text: literal), context: context, autocorrect: true).autocorrection == nil)
    }
  }

  @Test func shortFinalBrushesKeepTypoRecallWithoutRemovingDistantSuffixes() {
    #expect(correction("thes", after: "and") == "the")
    #expect(correction("thed", after: "and") == "the")
    for literal in ["meh", "yous"] {
      #expect(correction(literal, after: "and") == nil)
    }
  }

  @Test func titleCaseSubstitutionsNeedDirectedTouchEvidence() {
    let context = model.context(previousWord: "wrote", sentenceStart: false, precedingWord: "I")
    var word = typed("Pleade")
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == nil)
    #expect(suggester.suggestions(for: TypedWord(text: word.text), context: context, autocorrect: true).autocorrection == nil)
    let d = LetterGeometry.qwerty.center(Character("d").asciiValue!)!
    let s = LetterGeometry.qwerty.center(Character("s").asciiValue!)!
    word.taps[4] = KeyPoint(x: d.x + (s.x - d.x) * 0.48, y: d.y + (s.y - d.y) * 0.48)
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == "Please")
    word.taps[4] = KeyPoint(x: d.x - (s.x - d.x) * 0.48, y: d.y - (s.y - d.y) * 0.48)
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == nil)
  }

  @Test func contextCanReverseUnigramPreferenceWithDirectedTouches() {
    let context = model.context(previousWord: "I", sentenceStart: false)
    var word = typed("has")
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == nil)
    let s = LetterGeometry.qwerty.center(Character("s").asciiValue!)!
    let d = LetterGeometry.qwerty.center(Character("d").asciiValue!)!
    word.taps[2] = KeyPoint(x: s.x + (d.x - s.x) * 0.48, y: s.y + (d.y - s.y) * 0.48)
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == "had")
  }

  @Test func validWordAutocorrectionDoesNotFallThroughToAWeakerExplanation() {
    let context = model.context(previousWord: "a", sentenceStart: false, precedingWord: "take")
    var word = typed("test")
    let s = LetterGeometry.qwerty.center(Character("s").asciiValue!)!
    let x = LetterGeometry.qwerty.center(Character("x").asciiValue!)!
    word.taps[2] = KeyPoint(x: s.x + (x.x - s.x) * 0.48, y: s.y + (x.y - s.y) * 0.48)
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == nil)
  }

  @Test func rareValidWordsKeepProtectionAgainstMoreFrequentNeighbors() {
    let context = model.context(previousWord: "to", sentenceStart: false)
    var word = typed("hone")
    let n = LetterGeometry.qwerty.center(Character("n").asciiValue!)!
    let m = LetterGeometry.qwerty.center(Character("m").asciiValue!)!
    word.taps[2] = KeyPoint(x: n.x + (m.x - n.x) * 0.48, y: n.y + (m.y - n.y) * 0.48)
    #expect(suggester.suggestions(for: word, context: context, autocorrect: true).autocorrection == nil)
  }

}
