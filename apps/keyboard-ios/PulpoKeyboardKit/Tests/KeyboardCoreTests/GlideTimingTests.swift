import Foundation
import Testing
@testable import KeyboardCore

/// Touch times let the decoder prefer words whose letters sit where the finger
/// slowed down. Missing or uninformative times must leave decoding spatial.
struct GlideTimingTests {
  let model: LanguageModel
  let glide: GlideDecoder

  init() {
    (model, _, glide) = Fixtures.stack()
  }

  /// Times for a path whose finger slows near `letters` and moves quickly between them.
  static func times(for points: [KeyPoint], slowingAt letters: String, geometry: LetterGeometry = .qwerty,
                    slow: Double = 2, fast: Double = 14) -> [Double] {
    let centers = letters.utf8.compactMap { geometry.center($0) }
    var times = [0.0]
    for index in points.indices.dropFirst() {
      let a = points[index - 1], b = points[index]
      let middle = KeyPoint(x: (a.x + b.x) / 2, y: (a.y + b.y) / 2)
      let nearest = centers.map { $0.distance(to: middle) }.min() ?? 1
      let speed = slow + (fast - slow) * min(1, nearest / 0.6)
      times.append(times[index - 1] + a.distance(to: b) / speed)
    }
    return times
  }

  /// A straight-segment path through key centers, sampled every 0.05 pitch.
  func path(_ letters: String) -> [KeyPoint] {
    let centers = letters.utf8.compactMap { glide.geometry.center($0) }
    var points: [KeyPoint] = []
    for (a, b) in zip(centers, centers.dropFirst()) {
      let steps = max(1, Int((a.distance(to: b) / 0.05).rounded(.up)))
      for step in 0..<steps {
        let t = Double(step) / Double(steps)
        points.append(KeyPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
      }
    }
    points.append(centers[centers.count - 1])
    return points
  }

  @Test(arguments: ["hello", "keyboard", "the", "because", "tomorrow", "quick"])
  func unusableTimesDecodeExactlyLikeNone(word: String) {
    var generator = SeededGenerator(state: 41)
    let points = SyntheticSwipe.points(for: word, noise: 0.25, generator: &generator)
    let reference = glide.decode(points, context: .unknown)
    let usable = Self.times(for: points, slowingAt: word)
    let unusable: [[Double]?] = [
      nil,
      [],
      Array(usable.dropLast()),
      points.map { _ in 0 },
      usable.map { $0 * 0.04 / usable[usable.count - 1] },
      usable.enumerated().map { $0.offset == 3 ? .nan : $0.element },
      usable.enumerated().map { $0.offset == 3 ? .infinity : $0.element },
    ]
    for times in unusable {
      #expect(glide.decode(points, times: times, context: .unknown) == reference)
    }
  }

  @Test(arguments: ["hello", "world", "keyboard", "people", "something", "thanks", "pizza"])
  func constantSpeedTimesKeepTheSpatialChoice(word: String) {
    var generator = SeededGenerator(state: 5)
    let points = SyntheticSwipe.points(for: word, noise: 0.2, generator: &generator)
    var times = [0.0]
    for index in points.indices.dropFirst() { times.append(times[index - 1] + points[index - 1].distance(to: points[index]) / 6) }
    let spatial = glide.decode(points, context: .unknown).map(\.text)
    let timed = glide.decode(points, times: times, context: .unknown).map(\.text)
    #expect(timed.prefix(3) == spatial.prefix(3))
  }

  @Test(arguments: ["to", "type", "hello", "address", "happened", "keyboard", "tomorrow", "weekend"])
  func scorePruningStaysExactWithTimes(word: String) {
    var generator = SeededGenerator(state: 87)
    let points = SyntheticSwipe.points(for: word, noise: 0.3, generator: &generator)
    var constant = [0.0]
    for index in points.indices.dropFirst() { constant.append(constant[index - 1] + points[index - 1].distance(to: points[index]) / 20) }
    // Letter slowdowns leave no credit; a constant speed credits every letter.
    for times in [Self.times(for: points, slowingAt: word), Self.times(for: points, slowingAt: word, slow: 6, fast: 40), constant] {
      for context in [LanguageContext.unknown, model.context(previousWord: "you", sentenceStart: false)] {
        let reference = glide.decode(points, times: times, context: context, limit: .max)
        for limit in [1, 4, 10] {
          #expect(glide.decode(points, times: times, context: context, limit: limit) == Array(reference.prefix(limit)))
        }
      }
    }
  }

  @Test func slowingOnAPassedLetterSelectsTheWordThatHasIt() {
    // r → o → t crosses i on the way out; only the timing says whether it was meant.
    let points = path("rot")
    func rank(_ times: [Double]) -> [String] {
      glide.decode(points, times: times, context: .unknown, limit: 20).map { TextNormalizer.key($0.text) }
    }
    let dwelling = rank(Self.times(for: points, slowingAt: "riot"))
    let passing = rank(Self.times(for: points, slowingAt: "rot"))
    #expect(dwelling.firstIndex(of: "riot")! < dwelling.firstIndex(of: "rot")!)
    #expect(passing.firstIndex(of: "rot")! < passing.firstIndex(of: "riot")!)
  }

  @Test func engineSwipesPassTouchTimesToTheDecoder() {
    let points = path("rot")
    // "root" shares the path, so compare the two words the timing decides between.
    let dwelling = Fixtures.engine("we saw a ").0.insertGlide(points, times: Self.times(for: points, slowingAt: "riot")).map(\.text)
    let passing = Fixtures.engine("we saw a ").0.insertGlide(points, times: Self.times(for: points, slowingAt: "rot")).map(\.text)
    #expect(dwelling.contains("riot"))
    #expect((dwelling.firstIndex(of: "riot") ?? .max) < (dwelling.firstIndex(of: "rot") ?? .max), "\(dwelling)")
    #expect(passing.contains("rot"))
    #expect((passing.firstIndex(of: "rot") ?? .max) < (passing.firstIndex(of: "riot") ?? .max), "\(passing)")
  }

  @Test(arguments: ["hello", "keyboard", "something", "people"])
  func degradedTimestampsStillDecode(word: String) {
    var generator = SeededGenerator(state: 9)
    let points = SyntheticSwipe.points(for: word, noise: 0.15, generator: &generator)
    let recorded = Self.times(for: points, slowingAt: word)
    let variants: [[Double]] = [
      recorded,
      // Coalesced batches can share one timestamp.
      recorded.indices.map { recorded[$0 - $0 % 4] },
      // Out-of-order delivery and clock jitter.
      recorded.indices.map { recorded[$0] + Double(($0 * 7_919) % 17 - 8) / 1000 },
      recorded.map { $0 * 4 },
    ]
    for times in variants {
      #expect(glide.decode(points, times: times, context: .unknown).first?.text == word)
    }
    // Implausibly fast (up to 56 key pitches a second) only loosens spatial
    // trust by the capped variance; the word stays among the first choices.
    let rushed = recorded.map { $0 / 4 }
    #expect(glide.decode(points, times: rushed, context: .unknown).prefix(3).contains { $0.text == word })
  }

  @Test func timedNoisySwipesStayAccurateAndFast() {
    let lexicon = model.lexicon
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
    var spatialTop1 = 0, timedTop1 = 0, timedTop3 = 0
    let clock = ContinuousClock()
    let budget = Duration.milliseconds(60)
    var worst = Duration.zero
    for (index, word) in words.enumerated() {
      var generator = SeededGenerator(state: UInt64(index + 7))
      let points = SyntheticSwipe.points(for: word, noise: 0.2, generator: &generator)
      let times = Self.times(for: points, slowingAt: word)
      var result: [GlideCandidate] = []
      var elapsed = clock.measure { result = glide.decode(points, times: times, context: .unknown) }
      // Re-time an over-budget decode, so a busy machine doesn't fail a deterministic workload.
      for _ in 0..<2 where elapsed >= budget { elapsed = min(elapsed, clock.measure { _ = glide.decode(points, times: times, context: .unknown) }) }
      worst = max(worst, elapsed)
      let texts = result.map { $0.text.lowercased() }
      if texts.first == word { timedTop1 += 1 }
      if texts.prefix(3).contains(word) { timedTop3 += 1 }
      if glide.decode(points, context: .unknown).first?.text.lowercased() == word { spatialTop1 += 1 }
    }
    let total = Double(words.count)
    print("Timed glide top-1 \(Double(timedTop1) / total) (spatial \(Double(spatialTop1) / total)), top-3 \(Double(timedTop3) / total), slowest \(worst)")
    #expect(timedTop1 >= spatialTop1)
    #expect(Double(timedTop1) / total > 0.8)
    #expect(Double(timedTop3) / total > 0.93)
    #expect(worst < budget)
  }
}
