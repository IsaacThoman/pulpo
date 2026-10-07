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
}
