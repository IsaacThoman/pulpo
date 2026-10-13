import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in external recorded gestures; source data and per-case evidence stay
/// outside Git. Prepare with scripts/prepare_human_swipes.py, then set
/// PK_HUMAN_SWIPES and PK_HUMAN_REPORT to absolute JSON paths.
struct HumanSwipeAuditTests {
  struct Item: Decodable {
    let id: String
    let participant: String
    let word: String
    let points: [[Double]]
  }

  struct Result: Codable {
    let id: String
    let word: String
    let known: Bool
    let candidates: [String]
    let milliseconds: Double
  }

  struct Report: Codable {
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
    var results: [Result] = []
    for item in items {
      let points = item.points.map { KeyPoint(x: $0[0], y: $0[1]) }
      let start = ProcessInfo.processInfo.systemUptime
      let candidates = decoder.decode(points, context: .unknown, limit: 5).map(\.text)
      let milliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1000
      results.append(Result(id: item.id, word: item.word, known: Fixtures.lexicon.id(of: item.word) != nil, candidates: candidates, milliseconds: milliseconds))
    }
    func matches(_ result: Result, count: Int) -> Bool {
      result.candidates.prefix(count).contains { TextNormalizer.key($0) == result.word }
    }
    let known = results.filter(\.known)
    let times = results.map(\.milliseconds).sorted()
    let report = Report(
      total: results.count, known: known.count, participants: Set(items.map(\.participant)).count,
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
    print("HUMAN \(report.top1)/\(report.total) top1, \(report.top3) top3; known \(report.knownTop1)/\(report.known) top1, \(report.knownTop3) top3; median \(report.medianMilliseconds)ms p95 \(report.p95Milliseconds)ms")
    #expect(!results.isEmpty)
  }
}
