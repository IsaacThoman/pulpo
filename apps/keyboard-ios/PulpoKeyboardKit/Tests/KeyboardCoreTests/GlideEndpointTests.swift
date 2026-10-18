import Foundation
import Testing
@testable import KeyboardCore

/// Recorded swipes often lift past the last letter while still moving, and with a
/// known previous word a likely continuation can be scored even when a noisy
/// endpoint kept its first or last key out of the candidate buckets.
struct GlideEndpointTests {
  let model: LanguageModel
  let glide: GlideDecoder

  init() {
    (model, _, glide) = Fixtures.stack()
  }

  /// Times for a finger moving at a constant speed until it lifts.
  static func constantSpeed(_ points: [KeyPoint], pitchesPerSecond: Double = 10) -> [Double] {
    var times = [0.0]
    for index in points.indices.dropFirst() {
      times.append(times[index - 1] + points[index - 1].distance(to: points[index]) / pitchesPerSecond)
    }
    return times
  }

  @Test func fastLiftPastTheLastLetterKeepsTheShorterWord() {
    // w → e, carried on to r by the lift: "we", not "were".
    let points = HumanSwipeContextTests.idealPath("wer")
    let start = model.context(previousWord: nil, sentenceStart: true)
    #expect(glide.decode(points, times: Self.constantSpeed(points), context: start).first?.text == "we")
    let path = HumanSwipeContextTests.idealPath("itr")
    #expect(glide.decode(path, times: Self.constantSpeed(path), context: .unknown).first?.text == "it")
  }

  @Test(arguments: ["top", "ends", "seconds", "colored", "bands"])
  func stoppingOnTheLastKeyKeepsTheLongerWord(word: String) {
    // A deliberate stop on the last key is not an overshoot of a shorter word.
    let (points, times) = HumanSwipeContextTests.minimumJerkPath(word)
    #expect(glide.decode(points, times: times, context: .unknown).first.map { TextNormalizer.key($0.text) } == word)
  }

  @Test(arguments: ["hello", "were", "keyboard", "top", "because", "quick"])
  func untimedSwipesGetNoOvershootCredit(word: String) {
    var generator = SeededGenerator(state: 29)
    let points = SyntheticSwipe.points(for: word, noise: 0.25, generator: &generator)
    let reference = GlideDecoder(model: model)
    reference.endOvershootLimit = 0
    for context in [LanguageContext.unknown, model.context(previousWord: "the", sentenceStart: false)] {
      #expect(glide.decode(points, context: context) == reference.decode(points, context: context))
    }
    // A finger that slows to a stop gets none either.
    let (stopping, times) = HumanSwipeContextTests.minimumJerkPath(word)
    if let lift = GlideDecoder.liftSpeed(points: stopping, times: times, window: glide.liftWindow), lift < glide.overshootSpeedFloor {
      #expect(glide.decode(stopping, times: times, context: .unknown) == reference.decode(stopping, times: times, context: .unknown))
    }
  }

  @Test func liftSpeedComesFromTheFinalTouches() throws {
    let points = HumanSwipeContextTests.idealPath("hello")
    let steady = try #require(GlideDecoder.liftSpeed(points: points, times: Self.constantSpeed(points), window: 0.05))
    #expect(abs(steady - 1) < 0.05)
    // Resting on the last key before lifting reads as a stop.
    var resting = points
    var times = Self.constantSpeed(points)
    for _ in 1...6 {
      resting.append(points[points.count - 1])
      times.append(times[times.count - 1] + 1.0 / 60)
    }
    #expect(try #require(GlideDecoder.liftSpeed(points: resting, times: times, window: 0.05)) < 0.1)
    #expect(GlideDecoder.liftSpeed(points: points, times: points.map { _ in 0 }, window: 0.05) == nil)
  }

  @Test func contextScoresAPredictedWordWhoseStartKeyWasNotAdmitted() {
    // Starts nearer t than y; with one endpoint key, only t's buckets are searched.
    let points = [KeyPoint(x: 4.9, y: 0)] + HumanSwipeContextTests.idealPath("you").dropFirst()
    let narrow = GlideDecoder(model: model)
    narrow.endpointLetterLimit = 1
    let thank = model.context(previousWord: "Thank", sentenceStart: false)
    #expect(narrow.decode(points, context: thank).first?.text == "you")
    #expect(!narrow.decode(points, context: .unknown).contains { $0.text == "you" })
    narrow.contextSeedLimit = 0
    #expect(!narrow.decode(points, context: thank).contains { $0.text == "you" })
  }

  @Test(arguments: ["we", "it", "to", "hello", "keyboard", "something", "thanks"])
  func scorePruningStaysExactWithOvershootAndSeeds(word: String) {
    var generator = SeededGenerator(state: 113)
    var points = SyntheticSwipe.points(for: word, noise: 0.3, generator: &generator)
    // Carry the lift on past the last letter.
    if let last = points.last, points.count > 1 {
      let previous = points[points.count - 2]
      points.append(KeyPoint(x: last.x + (last.x - previous.x) * 6, y: last.y + (last.y - previous.y) * 6))
    }
    let times = Self.constantSpeed(points)
    for context in [LanguageContext.unknown, model.context(previousWord: "you", sentenceStart: false), model.context(previousWord: nil, sentenceStart: true)] {
      let reference = glide.decode(points, times: times, context: context, limit: .max)
      for limit in [1, 4, 10] {
        #expect(glide.decode(points, times: times, context: context, limit: limit) == Array(reference.prefix(limit)))
      }
    }
  }
}
