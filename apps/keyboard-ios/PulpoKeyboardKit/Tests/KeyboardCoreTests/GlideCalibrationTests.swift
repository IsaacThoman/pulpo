import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in experiments across spatial failure modes. Calibration and verification
/// use separate seeds; raw results belong outside the checkout.
struct GlideCalibrationTests {
  struct Result: Codable {
    var configuration: String
    var profile: String
    var total: Int
    var top1: Int
    var top3: Int
    var milliseconds: Double
  }

  static let profiles = ["moderate", "stress", "rounded", "sparse", "offset", "endpoints"]

  static let gestureWords: [String] = {
    let lexicon = Fixtures.lexicon
    let ids = (0..<lexicon.wordCount).filter { lexicon.flags($0).contains(.glide) && lexicon.keyLength($0) >= 3 }
      .sorted { lexicon.frequency($0) != lexicon.frequency($1) ? lexicon.frequency($0) > lexicon.frequency($1) : $0 < $1 }
    var seen = Set<String>()
    return ids.compactMap { id -> String? in
      let word = lexicon.display(id)
      return word == word.lowercased() && seen.insert(word).inserted ? word : nil
    }.enumerated().filter { $0.offset % 2 == 0 }.prefix(500).map { $0.element }
  }()

  @Test func acceptsRoundedTurnWithoutRequiringExactKeyPassage() {
    let (_, _, glide) = Fixtures.stack()
    let template = [KeyPoint(x: 0, y: 0), KeyPoint(x: 2, y: 2), KeyPoint(x: 4, y: 0)]
    let points = [KeyPoint(x: 0, y: 0), KeyPoint(x: 2, y: 0.8), KeyPoint(x: 4, y: 0)]
    let samples = GlideDecoder.resample(points, count: glide.sampleCount)
    #expect(glide.spatialScore(samples: samples, gestureLength: GlideDecoder.length(of: points), template: template) != nil)
  }

  @Test func stillRejectsAnUnvisitedInteriorKey() {
    let (_, _, glide) = Fixtures.stack()
    let template = [KeyPoint(x: 0, y: 0), KeyPoint(x: 2, y: 2), KeyPoint(x: 4, y: 0)]
    let points = [KeyPoint(x: 0, y: 0), KeyPoint(x: 2, y: 0.4), KeyPoint(x: 4, y: 0)]
    let samples = GlideDecoder.resample(points, count: glide.sampleCount)
    #expect(glide.spatialScore(samples: samples, gestureLength: GlideDecoder.length(of: points), template: template) == nil)
  }

  @Test(arguments: ["rounded", "sparse", "offset", "endpoints"])
  func toleratesDifferentGestureStyles(profile: String) {
    let (_, _, glide) = Fixtures.stack()
    let words = Self.gestureWords
    var top1 = 0, top3 = 0
    for (index, word) in words.enumerated() {
      let seed = UInt64(index + Self.profiles.firstIndex(of: profile)! * 17 + 15_731)
      let result = glide.decode(Self.path(word: word, profile: profile, seed: seed), context: .unknown, limit: 3).map(\.text)
      if result.first == word { top1 += 1 }
      if result.contains(word) { top3 += 1 }
    }
    print("Gesture style \(profile): \(top1)/\(words.count) top1, \(top3) top3")
    #expect(Double(top1) / Double(words.count) >= (profile == "rounded" ? 0.85 : 0.91))
    // Human holdout gains +34 top1/+33 top3; 3,000 extra rounded swipes lose
    // only two top3 results (2,874 to 2,872), an intentional small tradeoff.
    #expect(Double(top3) / Double(words.count) >= (profile == "rounded" ? 0.96 : 0.965))
  }

  @Test func toleratesRoundedGesturesAcrossIndependentSeeds() {
    let (_, _, glide) = Fixtures.stack()
    let words = Self.gestureWords
    let seeds: [UInt64] = [23_117, 42_179, 63_617, 86_783, 105_239, 130_363]
    var top1 = 0, top3 = 0
    for seed in seeds {
      for (index, word) in words.enumerated() {
        let points = Self.path(word: word, profile: "rounded", seed: seed + UInt64(index))
        let result = glide.decode(points, context: .unknown, limit: 3).map(\.text)
        if result.first == word { top1 += 1 }
        if result.contains(word) { top3 += 1 }
      }
    }
    let total = words.count * seeds.count
    print("Independent rounded swipes: \(top1)/\(total) top1, \(top3) top3")
    #expect(Double(top1) / Double(total) >= 0.8)
    #expect(Double(top3) / Double(total) >= 0.95)
  }

  static func path(word: String, profile: String, seed: UInt64) -> [KeyPoint] {
    var generator = SeededGenerator(state: seed)
    var points = SyntheticSwipe.points(for: word, noise: profile == "stress" ? 0.35 : 0.2,
      generator: &generator, smoothingRadius: profile == "rounded" ? 12 : 3)
    if profile == "sparse" {
      let last = points.last!
      points = stride(from: 0, to: points.count, by: 8).map { points[$0] }
      points.append(last)
    } else if profile == "offset" {
      points = points.map { KeyPoint(x: $0.x + 0.22, y: $0.y + 0.15) }
    } else if profile == "endpoints" {
      let reach = max(1, points.count / 10)
      points = points.enumerated().map { index, point in
        let start = max(0, 1 - Double(index) / Double(reach))
        let end = max(0, 1 - Double(points.count - 1 - index) / Double(reach))
        return KeyPoint(x: point.x + 0.45 * (start - end), y: point.y + 0.25 * (start + end))
      }
    }
    return points
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_GLIDE_CALIBRATE"] != nil))
  func calibrate() throws {
    let source = ProcessInfo.processInfo.environment["PK_GLIDE_CALIBRATE"]!
    let baseline = try JSONDecoder().decode(KeyboardQualityTests.Report.self, from: Data(contentsOf: URL(fileURLWithPath: source)))
    let words = baseline.swipes["standard"]!.enumerated().filter { $0.offset % 2 == 0 }.map { $0.element.input }
    let verify = ProcessInfo.processInfo.environment["PK_GLIDE_VERIFY"] != nil
    let configurations = verify ? ["selected"] : ["baseline", "length20", "length25", "alignment50", "alignment100", "corners60", "shape14", "search24000", "combined"]
    var results: [Result] = []
    for label in configurations {
      let (_, _, glide) = Fixtures.stack()
      // Compare spatial weights with the current bucket search; archive the
      // earlier decoder separately when comparing search algorithms.
      if label != "selected" { glide.extraLengthSigma = 0.15; glide.alignmentLengthExponent = 0 }
      if label == "length20" || label == "combined" { glide.extraLengthSigma = 0.2 }
      if label == "length25" { glide.extraLengthSigma = 0.25 }
      if label == "alignment50" || label == "combined" { glide.alignmentLengthExponent = 0.5 }
      if label == "alignment100" { glide.alignmentLengthExponent = 1 }
      if label == "corners60" { glide.cornerSigma = 0.6 }
      if label == "shape14" { glide.shapeWeight = 14 }
      if label == "search24000" { glide.maximumCandidates = 24_000 }
      for (profileIndex, profile) in Self.profiles.enumerated() {
        let cases = profileIndex < 2 ? words : Array(words.prefix(500))
        var top1 = 0, top3 = 0
        let start = ProcessInfo.processInfo.systemUptime
        for (index, word) in cases.enumerated() {
          let seed = UInt64(index + profileIndex * 17 + (verify ? 15_731 : 5_411))
          let result = glide.decode(Self.path(word: word, profile: profile, seed: seed), context: .unknown, limit: 3).map(\.text)
          if result.first == word { top1 += 1 }
          if result.contains(word) { top3 += 1 }
        }
        let result = Result(configuration: label, profile: profile, total: cases.count, top1: top1, top3: top3,
          milliseconds: (ProcessInfo.processInfo.systemUptime - start) * 1_000 / Double(cases.count))
        results.append(result)
        print("CALIBRATE \(label) \(profile): \(top1)/\(cases.count) top1, \(top3) top3, \(result.milliseconds)ms")
      }
    }
    let output = ProcessInfo.processInfo.environment["PK_GLIDE_RESULTS"].map { URL(fileURLWithPath: $0) }
      ?? URL(fileURLWithPath: source).deletingLastPathComponent().appendingPathComponent(verify ? "glide-verification.json" : "glide-calibration.json")
    try JSONEncoder().encode(results).write(to: output, options: .atomic)
  }
}
