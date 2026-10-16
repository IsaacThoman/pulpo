import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in parameter experiments on fixed words and independent gesture seeds.
/// The normal tests keep the selected defaults under regression coverage.
struct GlideTuningTests {
  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_GLIDE_TUNE"] != nil))
  func compareSpatialParameters() throws {
    let baseline = try JSONDecoder().decode(KeyboardQualityTests.Report.self, from: Data(contentsOf: URL(fileURLWithPath: ProcessInfo.processInfo.environment["PK_GLIDE_TUNE"]!)))
    let words = baseline.swipes["standard"]!.map(\.input)
    for (label, endpointLimit, radius, passage, shapeWeight, languageWeight) in [
      ("current", 3, 1.25, 0.95, 10.0, 0.9),
      ("endpoints", 4, 1.5, 0.95, 10.0, 0.9),
      ("passage", 3, 1.25, 1.1, 10.0, 0.9),
      ("both", 4, 1.5, 1.1, 10.0, 0.9),
      ("language", 4, 1.5, 1.1, 10.0, 0.7),
      ("shape", 4, 1.5, 1.1, 14.0, 0.9),
    ] {
      let (_, _, glide) = Fixtures.stack()
      glide.endpointLetterLimit = endpointLimit
      glide.endpointRadius = radius
      glide.passageRadius = passage
      glide.shapeWeight = shapeWeight
      glide.languageWeight = languageWeight
      for (profile, noise, seed) in [("moderate", 0.2, UInt64(719)), ("stress", 0.35, UInt64(447))] {
        var top1 = 0, top3 = 0
        let start = ProcessInfo.processInfo.systemUptime
        for (index, word) in words.enumerated() {
          var generator = SeededGenerator(state: UInt64(index) + seed)
          let points = SyntheticSwipe.points(for: word, noise: noise, generator: &generator)
          let result = glide.decode(points, context: .unknown, limit: 3).map(\.text)
          if result.first == word { top1 += 1 }
          if result.contains(word) { top3 += 1 }
        }
        print("TUNE \(label) \(profile): \(top1)/\(words.count) top1, \(top3) top3, \(ProcessInfo.processInfo.systemUptime - start)s")
      }
    }
  }
}
