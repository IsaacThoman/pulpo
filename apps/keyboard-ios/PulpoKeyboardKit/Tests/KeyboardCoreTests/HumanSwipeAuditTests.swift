import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in external recorded gestures; source data and per-case evidence stay
/// outside Git. Prepare with scripts/prepare_human_swipes.py, then set
/// PK_HUMAN_SWIPES and PK_HUMAN_REPORT to absolute JSON paths.
///
/// Recorded touch times are decoded by default, as the keyboard does.
/// PK_HUMAN_TIMING=none decodes the paths alone (the earlier, spatial-only
/// metric). Degraded modes check that unusual timestamps can't hurt:
/// equal, uniform (60 Hz by index), burst4 (groups of four share a time),
/// slow4, fast4, jitter (±8 ms, out of order) and arclength (constant speed).
struct HumanSwipeAuditTests {
  struct Item: Decodable {
    let id: String
    let participant: String
    let word: String
    let points: [[Double]]
    let times: [Double]?
  }

  struct Result: Codable {
    let id: String
    let word: String
    let known: Bool
    let candidates: [String]
    let milliseconds: Double
  }

  struct Report: Codable {
    var timing: String?
    let total: Int
    let known: Int
    let participants: Int
    let top1: Int
    let top3: Int
    let knownTop1: Int
    let knownTop3: Int
    let medianMilliseconds: Double
    let p95Milliseconds: Double
    let results: [Result]
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_HUMAN_SWIPES"] != nil))
  func decodeRecordedHumanSwipes() throws {
    let environment = ProcessInfo.processInfo.environment
    let input = URL(fileURLWithPath: environment["PK_HUMAN_SWIPES"]!)
    var items = try JSONDecoder().decode([Item].self, from: Data(contentsOf: input))
    if let limit = environment["PK_HUMAN_LIMIT"].flatMap(Int.init) { items = Array(items.prefix(limit)) }
    let (_, _, decoder) = Fixtures.stack()
    let timing = environment["PK_HUMAN_TIMING"] ?? "recorded"
    var results: [Result] = []
    for item in items {
      let points = item.points.map { KeyPoint(x: $0[0], y: $0[1]) }
      let times = Self.times(for: item, mode: timing)
      let start = ProcessInfo.processInfo.systemUptime
      let candidates = decoder.decode(points, times: times, context: .unknown, limit: 5).map(\.text)
      let milliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1000
      results.append(Result(id: item.id, word: item.word, known: Fixtures.lexicon.id(of: item.word) != nil, candidates: candidates, milliseconds: milliseconds))
    }
    func matches(_ result: Result, count: Int) -> Bool {
      result.candidates.prefix(count).contains { TextNormalizer.key($0) == result.word }
    }
    let known = results.filter(\.known)
    let times = results.map(\.milliseconds).sorted()
    let report = Report(
      timing: timing, total: results.count, known: known.count, participants: Set(items.map(\.participant)).count,
      top1: results.filter { matches($0, count: 1) }.count,
      top3: results.filter { matches($0, count: 3) }.count,
      knownTop1: known.filter { matches($0, count: 1) }.count,
      knownTop3: known.filter { matches($0, count: 3) }.count,
      medianMilliseconds: times.isEmpty ? 0 : times[times.count / 2],
      p95Milliseconds: times.isEmpty ? 0 : times[min(times.count - 1, times.count * 95 / 100)], results: results)
    if let output = environment["PK_HUMAN_REPORT"] {
      try JSONEncoder().encode(report).write(to: URL(fileURLWithPath: output))
    }
    if let baselinePath = environment["PK_HUMAN_BASELINE"] {
      let baseline = try JSONDecoder().decode(Report.self, from: Data(contentsOf: URL(fileURLWithPath: baselinePath)))
      // Comparing different selected people/gestures can hide regressions.
      #expect(baseline.results.map(\.id) == report.results.map(\.id))
      #expect(report.top1 >= baseline.top1)
      #expect(report.top3 >= baseline.top3)
    }
    print("HUMAN[timing=\(timing)] \(report.top1)/\(report.total) top1, \(report.top3) top3; known \(report.knownTop1)/\(report.known) top1, \(report.knownTop3) top3; median \(report.medianMilliseconds)ms p95 \(report.p95Milliseconds)ms")
    #expect(!results.isEmpty)
  }

  /// Recorded times, none, or deliberately degraded times for robustness checks.
  static func times(for item: Item, mode: String) -> [Double]? {
    guard let recorded = item.times, recorded.count == item.points.count else { return nil }
    switch mode {
    case "none": return nil
    case "recorded": return recorded
    case "equal": return recorded.map { _ in 0 }
    case "uniform": return recorded.indices.map { Double($0) / 60 }
    case "burst4": return recorded.indices.map { recorded[$0 - $0 % 4] }
    case "slow4": return recorded.map { $0 * 4 }
    case "fast4": return recorded.map { $0 / 4 }
    case "arclength":
      // Constant speed: the same path, with no timing information.
      var elapsed = [0.0]
      for index in item.points.indices.dropFirst() {
        let a = item.points[index - 1], b = item.points[index]
        elapsed.append(elapsed[index - 1] + hypot(b[0] - a[0], b[1] - a[1]) / 5)
      }
      return elapsed
    case "jitter":
      // Deterministic ±8 ms noise; neighbors can arrive out of order.
      return recorded.indices.map { recorded[$0] + Double(($0 * 7_919) % 17 - 8) / 1000 }
    default: preconditionFailure("Unknown PK_HUMAN_TIMING mode \(mode)")
    }
  }
}
