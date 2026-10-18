import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in frozen blind input bench. Inputs, recorded gestures and per-case reports
/// stay outside Git. The manifest fixes selection, seeds and acceptance criteria
/// before the first baseline. This is a stress audit, not an absolute accuracy claim.
struct BlindInputStressTests {
  struct Manifest: Decodable {
    let version: String
    let clean: [[String]]
    let typos: [[String]]
    let synthetic: [[String]]
    let humanIDs: [String]
    let syntheticNoise: [Double]
    let tapNoise: [Double]
    let syntheticSeed: UInt64
    let tapSeed: UInt64
  }

  struct Human: Decodable {
    let id: String
    let word: String
    let points: [[Double]]
    let sentence: String
  }

  struct Result: Codable {
    let id: String
    let group: String
    let input: String
    let expected: String
    let prefix: String
    let candidates: [String]

    func correct(_ count: Int) -> Bool {
      candidates.prefix(count).contains { TextNormalizer.key($0) == TextNormalizer.key(expected) }
    }
  }

  struct Summary: Codable {
    let count: Int
    let top1: Int
    let top3: Int
  }

  struct Report: Codable {
    let version: String
    let summary: [String: Summary]
    let results: [Result]
  }

  func tokens(_ text: String) -> [String] {
    text.split { !($0.isLetter || $0 == "'" || $0 == "\u{2019}") }.map(String.init)
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_BLIND_STRESS_MANIFEST"] != nil))
  func frozenInputStressAudit() throws {
    let environment = ProcessInfo.processInfo.environment
    let manifestURL = URL(fileURLWithPath: environment["PK_BLIND_STRESS_MANIFEST"]!)
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: manifestURL))
    let humanURL = URL(fileURLWithPath: try #require(environment["PK_BLIND_STRESS_HUMAN"]))
    let human = try JSONDecoder().decode([Human].self, from: Data(contentsOf: humanURL))
    let humanByID = Dictionary(uniqueKeysWithValues: human.map { ($0.id, $0) })
    let (model, suggester, glide) = Fixtures.stack()
    var results: [Result] = []

    func context(_ prefix: String) -> LanguageContext {
      let words = tokens(prefix)
      return model.context(previousWord: words.last, sentenceStart: words.isEmpty,
                           precedingWord: words.count > 1 ? words[words.count - 2] : nil)
    }

    for (noiseIndex, noise) in manifest.tapNoise.enumerated() {
      var generator = SeededGenerator(state: manifest.tapSeed)
      for (group, cases) in [("clean", manifest.clean), ("typo", manifest.typos)] {
        for (position, item) in cases.enumerated() {
          let prefix = item[0], text = item[1], expected = item.count > 2 ? item[2] : text
          let taps = text.map { character -> KeyPoint? in
            guard let byte = TextNormalizer.key(String(character)).utf8.first,
                  let center = LetterGeometry.qwerty.center(byte) else { return nil }
            return KeyPoint(x: center.x + generator.gaussian(noise), y: center.y + generator.gaussian(noise * 0.8))
          }
          let set = suggester.suggestions(for: TypedWord(text: text, taps: taps), context: context(prefix), autocorrect: true)
          results.append(Result(id: "\(group)-\(noiseIndex)-\(position)", group: "\(group)-\(noiseIndex)", input: text,
                                expected: expected, prefix: prefix, candidates: [set.autocorrection ?? text]))
        }
      }
    }

    for (noiseIndex, noise) in manifest.syntheticNoise.enumerated() {
      var generator = SeededGenerator(state: manifest.syntheticSeed)
      for (position, item) in manifest.synthetic.enumerated() {
        let prefix = item[0], word = item[1]
        let points = SyntheticSwipe.points(for: word, noise: noise, generator: &generator)
        let candidates = glide.decode(points, context: context(prefix), limit: 5).map(\.text)
        results.append(Result(id: "synthetic-\(noiseIndex)-\(position)", group: "synthetic-\(noiseIndex)", input: word,
                              expected: word, prefix: prefix, candidates: candidates))
      }
    }

    for id in manifest.humanIDs {
      let item = try #require(humanByID[id])
      let words = tokens(item.sentence)
      let positions = words.indices.filter { words[$0].lowercased() == item.word.lowercased() }
      #expect(positions.count == 1, "Frozen human targets need unambiguous preceding context")
      let position = try #require(positions.first)
      let prefix = words[..<position].joined(separator: " ")
      let points = item.points.map { KeyPoint(x: $0[0], y: $0[1]) }
      for (group, languageContext) in [("human-context", context(prefix)), ("human-unknown", LanguageContext.unknown)] {
        let candidates = glide.decode(points, context: languageContext, limit: 5).map(\.text)
        results.append(Result(id: "\(group)-\(id)", group: group, input: item.word, expected: item.word,
                              prefix: prefix, candidates: candidates))
      }
    }

    let grouped = Dictionary(grouping: results, by: \.group)
    let summary = grouped.mapValues { group in
      Summary(count: group.count, top1: group.filter { $0.correct(1) }.count, top3: group.filter { $0.correct(3) }.count)
    }
    let report = Report(version: manifest.version, summary: summary, results: results)
    if let output = environment["PK_BLIND_STRESS_REPORT"] {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(report).write(to: URL(fileURLWithPath: output))
    }
    for group in summary.keys.sorted() {
      let item = summary[group]!
      print("BLIND STRESS \(group): \(item.top1)/\(item.count) top1, \(item.top3) top3")
    }

    if let baselinePath = environment["PK_BLIND_STRESS_BASELINE"] {
      let baseline = try JSONDecoder().decode(Report.self, from: Data(contentsOf: URL(fileURLWithPath: baselinePath)))
      #expect(baseline.version == report.version)
      #expect(baseline.results.map(\.id) == report.results.map(\.id))
      let baselineByID = Dictionary(uniqueKeysWithValues: baseline.results.map { ($0.id, $0) })
      for result in results where result.group.hasPrefix("clean-") && baselineByID[result.id]!.correct(1) {
        #expect(result.correct(1), "New clean literal harm: \(result.prefix) \(result.expected) -> \(result.candidates)")
      }
      let typoGain = summary.filter { $0.key.hasPrefix("typo-") }.values.reduce(0) { $0 + $1.top1 }
        - baseline.summary.filter { $0.key.hasPrefix("typo-") }.values.reduce(0) { $0 + $1.top1 }
      #expect(typoGain >= 0)
      let cleanGain = summary.filter { $0.key.hasPrefix("clean-") }.values.reduce(0) { $0 + $1.top1 }
        - baseline.summary.filter { $0.key.hasPrefix("clean-") }.values.reduce(0) { $0 + $1.top1 }
      let humanGain = summary["human-context"]!.top1 - baseline.summary["human-context"]!.top1
      for group in summary.keys where group.hasPrefix("human-") || group.hasPrefix("synthetic-") {
        #expect(summary[group]!.top3 >= baseline.summary[group]!.top3, "Top3 regression: \(group)")
      }
      #expect(humanGain >= 3 || cleanGain >= 3, "Frozen acceptance needs ≥3 human top1 gains or ≥3 fewer harmful tap corrections")
    }
  }
}
