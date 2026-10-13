import Foundation
import Testing
@testable import KeyboardCore

struct GlideDecoderTests {
  let model: LanguageModel
  let glide: GlideDecoder

  init() {
    (model, _, glide) = Fixtures.stack()
  }

  func decode(_ word: String, noise: Double = 0, seed: UInt64 = 1, after previous: String? = nil) -> [String] {
    var generator = SeededGenerator(state: seed)
    let points = SyntheticSwipe.points(for: word, noise: noise, generator: &generator)
    let context = model.context(previousWord: previous, sentenceStart: previous == nil)
    return glide.decode(points, context: context).map(\.text)
  }

  @Test(arguments: ["hello", "world", "keyboard", "the", "and", "because", "people", "something", "thanks", "tomorrow", "pizza", "quick"])
  func decodesCleanSwipes(word: String) {
    #expect(decode(word, after: "the").first?.lowercased() == word || decode(word, after: "and").first?.lowercased() == word)
  }

  @Test func usesContextForAmbiguousPaths() {
    // "to" and "too" share a path; after "going" it is "to".
    #expect(decode("to", after: "going").first == "to")
  }

  @Test func offersApostropheForms() {
    #expect(decode("dont", after: "I").contains("don't"))
  }

  @Test func decodesUnsmoothedKeyCenterPaths() {
    for word in ["hello", "there", "keyboard", "minimum", "people", "tomorrow"] {
      let points = TextNormalizer.key(word).utf8.compactMap { glide.geometry.center($0) }
      let context = model.context(previousWord: nil, sentenceStart: true)
      #expect(glide.decode(points, context: context).first?.text.lowercased() == word)
    }
  }

  @Test func toleratesSmallLoopOnRepeatedLetter() {
    let start = glide.geometry.center(Character("s").asciiValue!)!
    let end = glide.geometry.center(Character("e").asciiValue!)!
    var points = [start, end]
    // A small loop at the doubled letter adds real travel without another key.
    for step in 1...16 {
      let angle = Double(step) * 2 * .pi / 16
      points.append(KeyPoint(x: end.x + 0.25 * sin(angle), y: end.y + 0.25 * (1 - cos(angle))))
    }
    let context = model.context(previousWord: "will", sentenceStart: false)
    #expect(glide.decode(points, context: context, limit: 4).first?.text == "see")
  }

  @Test(arguments: ["to", "type", "hello", "address", "happened", "keyboard", "tomorrow", "weekend"])
  func scorePruningPreservesRankingAndScores(word: String) {
    var generator = SeededGenerator(state: 87)
    let points = SyntheticSwipe.points(for: word, noise: 0.3, generator: &generator)
    for context in [LanguageContext.unknown, model.context(previousWord: "you", sentenceStart: false)] {
      // Asking for every candidate keeps the top-result bound inactive.
      let reference = glide.decode(points, context: context, limit: .max)
      for limit in [1, 4, 10] {
        #expect(glide.decode(points, context: context, limit: limit) == Array(reference.prefix(limit)))
      }
    }
  }

  @Test func scorePruningPreservesTies() {
    glide.languageWeight = 0
    let points = "to".utf8.compactMap { glide.geometry.center($0) }
    let reference = glide.decode(points, context: .unknown, limit: .max)
    for limit in [1, 3, 5] {
      #expect(glide.decode(points, context: .unknown, limit: limit) == Array(reference.prefix(limit)))
    }
  }

  @Test func scorePruningPreservesPersonalAndDictionaryDuplicates() {
    let personal = PersonalDictionary(url: nil)
    personal.pin("hello")
    personal.pin("hellooo")
    let (_, _, decoder) = Fixtures.stack(personal: personal)
    let points = "hello".utf8.compactMap { decoder.geometry.center($0) }
    let reference = decoder.decode(points, context: .unknown, limit: .max)
    #expect(reference.contains { $0.text == "hellooo" })
    for limit in [1, 4] {
      #expect(decoder.decode(points, context: .unknown, limit: limit) == Array(reference.prefix(limit)))
    }
  }

  @Test func accuracyOnNoisySwipes() throws {
    let lexicon = model.lexicon
    // The most frequent swipeable words, which is what people swipe most.
    var words: [String] = []
    var seen = Set<String>()
    var heap: [(Int, Int)] = []
    for id in 0..<lexicon.wordCount where lexicon.flags(id).contains(.glide) && lexicon.keyLength(id) >= 3 {
      heap.append((Int(lexicon.frequency(id)), id))
    }
    heap.sort { $0.0 > $1.0 }
    for (_, id) in heap where words.count < 600 {
      let display = lexicon.display(id)
      if display == display.lowercased(), seen.insert(display).inserted { words.append(display) }
    }
    var top1 = 0, top3 = 0
    var misses: [String] = []
    let clock = ContinuousClock()
    var worst = Duration.zero
    for (index, word) in words.enumerated() {
      var generator = SeededGenerator(state: UInt64(index + 7))
      let points = SyntheticSwipe.points(for: word, noise: 0.2, generator: &generator)
      var result: [GlideCandidate] = []
      let elapsed = clock.measure { result = glide.decode(points, context: .unknown) }
      worst = max(worst, elapsed)
      let texts = result.map { $0.text.lowercased() }
      if texts.first == word { top1 += 1 } else if misses.count < 40 { misses.append("\(word)->\(texts.first ?? "-")") }
      if texts.prefix(3).contains(word) { top3 += 1 }
    }
    let total = Double(words.count)
    print("Glide top-1 \(Double(top1) / total), top-3 \(Double(top3) / total), slowest \(worst)")
    print("Misses: \(misses.joined(separator: " "))")
    #expect(Double(top1) / total > 0.8)
    #expect(Double(top3) / total > 0.93)
    #expect(worst < .milliseconds(60))
  }

  @Test func accuracyOnIndependentStressGestures() {
    let lexicon = model.lexicon
    let ids = (0..<lexicon.wordCount).filter { lexicon.flags($0).contains(.glide) && lexicon.keyLength($0) >= 3 }
      .sorted { lexicon.frequency($0) != lexicon.frequency($1) ? lexicon.frequency($0) > lexicon.frequency($1) : $0 < $1 }
    var seen = Set<String>()
    let words = ids.compactMap { id -> String? in
      let word = lexicon.display(id)
      return word == word.lowercased() && seen.insert(word).inserted ? word : nil
    }.prefix(1200)
    var top1 = 0, top3 = 0
    for (index, word) in words.enumerated() {
      var generator = SeededGenerator(state: UInt64(index + 1897))
      let points = SyntheticSwipe.points(for: word, noise: 0.35, generator: &generator)
      let candidates = glide.decode(points, context: .unknown, limit: 3).map(\.text)
      if candidates.first == word { top1 += 1 }
      if candidates.contains(word) { top3 += 1 }
    }
    print("Independent stress swipes: \(top1)/\(words.count) top1, \(top3) top3")
    #expect(Double(top1) / Double(words.count) > 0.85)
    #expect(Double(top3) / Double(words.count) > 0.95)
  }
}
