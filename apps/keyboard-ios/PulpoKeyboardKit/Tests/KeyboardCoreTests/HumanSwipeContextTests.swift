import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in in-context swipe audit. Each recorded gesture is decoded after the
/// preceding words of its sentence, as the keyboard sees them once earlier words
/// are committed, and is also replayed through `KeyboardEngine` to check the text
/// actually committed. Source data and reports stay outside Git.
///
/// - `PK_CONTEXT_SWIPES`: recorded gestures with a `prefix` (surface text before the
///   word, empty at sentence start) and `kind` (`natural` phrase or `random` words).
/// - `PK_CONTEXT_CLEAN`: words with an optional `prefix`, swiped along ideal
///   center-to-center paths (`null` prefix decodes without context). With
///   `PK_CONTEXT_TIMING=minjerk` they are traced with a minimum-jerk speed profile
///   at 60 Hz, a precise swipe that slows to a stop on its last key.
/// - `PK_CONTEXT_REPORT` writes per-case results; `PK_CONTEXT_BASELINE` asserts an
///   identically ordered earlier report does not lose in-context accuracy.
/// - Recorded touch times are replayed by default; `PK_CONTEXT_TIMING=none`
///   decodes the paths alone.
struct HumanSwipeContextTests {
  struct Item: Decodable {
    let id: String?
    let participant: String?
    let word: String
    let points: [[Double]]?
    let times: [Double]?
    let prefix: String?
    let kind: String?
  }

  struct Result: Codable {
    let id: String
    let word: String
    let kind: String
    let prefix: String?
    let known: Bool
    let unknownCandidates: [String]
    let contextCandidates: [String]
    let contextScores: [Double]
    let committed: String?
    let slots: [String]
    let milliseconds: Double
  }

  struct Tally: Codable {
    var total = 0, top1 = 0, top3 = 0, unknownTop1 = 0, unknownTop3 = 0
    var committed = 0, reachable = 0, startCapitalized = 0, starts = 0
  }

  struct Report: Codable {
    var timing: String?
    let tallies: [String: Tally]
    let medianMilliseconds: Double
    let p95Milliseconds: Double
    let results: [Result]
  }

  /// Shares one language stack across gestures, replacing it if anything was learned.
  final class Stack {
    var parts = Fixtures.stack()
    var decoder: GlideDecoder { parts.2 }

    func engine(_ prefix: String) -> (KeyboardEngine, MockDocument) {
      if parts.0.personal.totalCount != 0 { parts = Fixtures.stack() }
      let document = MockDocument(prefix)
      let engine = KeyboardEngine(document: document, suggester: parts.1, glide: parts.2, settings: KeyboardSettings())
      engine.documentDidChange()
      return (engine, document)
    }
  }

  static func matches(_ candidates: [String], _ word: String, count: Int) -> Bool {
    candidates.prefix(count).contains { TextNormalizer.key($0) == word }
  }

  /// Straight center-to-center path through the word's keys, repeated letters collapsed.
  static func idealPath(_ word: String, geometry: LetterGeometry = .qwerty) -> [KeyPoint] {
    var centers: [KeyPoint] = []
    var previous: UInt8 = 0
    for byte in TextNormalizer.key(word).utf8 where byte != previous {
      if let center = geometry.center(byte) { centers.append(center) }
      previous = byte
    }
    guard var last = centers.first else { return [] }
    var points = [last]
    for next in centers.dropFirst() {
      let steps = max(1, Int((last.distance(to: next) / 0.1).rounded(.up)))
      for step in 1...steps {
        let t = Double(step) / Double(steps)
        points.append(KeyPoint(x: last.x + (next.x - last.x) * t, y: last.y + (next.y - last.y) * t))
      }
      last = next
    }
    return points
  }

  /// The ideal path traced with a minimum-jerk speed profile (a deliberate stop on
  /// the last key), sampled at 60 Hz over a typical recorded human duration.
  static func minimumJerkPath(_ word: String) -> (points: [KeyPoint], times: [Double]) {
    let ideal = idealPath(word)
    guard ideal.count > 1 else { return (ideal, ideal.map { _ in 0 }) }
    var travelled = [0.0]
    for index in 1..<ideal.count { travelled.append(travelled[index - 1] + ideal[index - 1].distance(to: ideal[index])) }
    let total = travelled[travelled.count - 1]
    let duration = 0.15 + total / 12
    let steps = max(2, Int((duration * 60).rounded(.up)))
    var points: [KeyPoint] = []
    var times: [Double] = []
    var segment = 0
    for step in 0...steps {
      let tau = Double(step) / Double(steps)
      let target = total * (10 * pow(tau, 3) - 15 * pow(tau, 4) + 6 * pow(tau, 5))
      while segment < ideal.count - 2, travelled[segment + 1] < target { segment += 1 }
      let span = travelled[segment + 1] - travelled[segment]
      let t = span > 0 ? min(1, max(0, (target - travelled[segment]) / span)) : 0
      let a = ideal[segment], b = ideal[segment + 1]
      points.append(KeyPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
      times.append(tau * duration)
    }
    return (points, times)
  }

  func run(_ items: [Item], clean: Bool, timing: String) throws -> Report {
    let stack = Stack()
    var results: [Result] = []
    for (index, item) in items.enumerated() {
      let points: [KeyPoint]
      let times: [Double]?
      if clean, timing == "minjerk" {
        (points, times) = Self.minimumJerkPath(item.word)
      } else {
        points = clean ? Self.idealPath(item.word) : (item.points ?? []).map { KeyPoint(x: $0[0], y: $0[1]) }
        times = clean || timing == "none" ? nil : item.times.flatMap { $0.count == points.count ? $0 : nil }
      }
      let unknown = stack.decoder.decode(points, times: times, context: .unknown, limit: 5).map(\.text)
      var context: [GlideCandidate] = []
      var committed: String?
      var slots: [String] = []
      var milliseconds = 0.0
      if let prefix = item.prefix {
        let languageContext = stack.engine(prefix).0.languageContext()
        let start = ProcessInfo.processInfo.systemUptime
        context = stack.decoder.decode(points, times: times, context: languageContext, limit: 5)
        milliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1000
        let (engine, document) = stack.engine(prefix)
        engine.insertGlide(points, times: times)
        if document.text.hasPrefix(prefix) {
          committed = String(document.text.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
        }
        slots = engine.suggestions.slots.map(\.text)
      } else {
        let start = ProcessInfo.processInfo.systemUptime
        context = stack.decoder.decode(points, times: times, context: .unknown, limit: 5)
        milliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1000
      }
      results.append(Result(
        id: item.id ?? "\(index)", word: item.word, kind: item.kind ?? (item.prefix == nil ? "clean-unknown" : "clean-context"),
        prefix: item.prefix, known: Fixtures.lexicon.id(of: item.word) != nil,
        unknownCandidates: unknown, contextCandidates: context.map(\.text), contextScores: context.map(\.score),
        committed: committed, slots: slots, milliseconds: milliseconds))
    }
    var tallies: [String: Tally] = [:]
    for result in results {
      let isStart = result.prefix == ""
      for label in ["all", result.kind, result.known ? "known" : "oov", isStart ? "start" : "continuation"] {
        var tally = tallies[label, default: Tally()]
        tally.total += 1
        if Self.matches(result.contextCandidates, result.word, count: 1) { tally.top1 += 1 }
        if Self.matches(result.contextCandidates, result.word, count: 3) { tally.top3 += 1 }
        if Self.matches(result.unknownCandidates, result.word, count: 1) { tally.unknownTop1 += 1 }
        if Self.matches(result.unknownCandidates, result.word, count: 3) { tally.unknownTop3 += 1 }
        if let committed = result.committed {
          let correct = TextNormalizer.key(committed) == result.word
          if correct { tally.committed += 1 }
          if correct || Self.matches(result.slots, result.word, count: 3) { tally.reachable += 1 }
          if isStart, correct {
            tally.starts += 1
            if committed.first?.isUppercase == true { tally.startCapitalized += 1 }
          }
        }
        tallies[label] = tally
      }
    }
    let times = results.map(\.milliseconds).sorted()
    return Report(
      timing: clean && timing != "minjerk" ? "none" : timing, tallies: tallies,
      medianMilliseconds: times.isEmpty ? 0 : times[times.count / 2],
      p95Milliseconds: times.isEmpty ? 0 : times[min(times.count - 1, times.count * 95 / 100)],
      results: results)
  }

  func audit(path: String, clean: Bool) throws {
    let environment = ProcessInfo.processInfo.environment
    var items = try JSONDecoder().decode([Item].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    if let limit = environment["PK_CONTEXT_LIMIT"].flatMap(Int.init) { items = Array(items.prefix(limit)) }
    let report = try run(items, clean: clean, timing: environment["PK_CONTEXT_TIMING"] ?? "recorded")
    if let output = environment["PK_CONTEXT_REPORT"] {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      try encoder.encode(report).write(to: URL(fileURLWithPath: output))
    }
    if let baselinePath = environment["PK_CONTEXT_BASELINE"] {
      let baseline = try JSONDecoder().decode(Report.self, from: Data(contentsOf: URL(fileURLWithPath: baselinePath)))
      #expect(baseline.results.map(\.id) == report.results.map(\.id))
      #expect(report.tallies["all"]!.top1 >= baseline.tallies["all"]!.top1)
      #expect(report.tallies["all"]!.top3 >= baseline.tallies["all"]!.top3)
    }
    for (label, tally) in report.tallies.sorted(by: { $0.key < $1.key }) {
      print("CONTEXT[timing=\(report.timing ?? "none")] \(label): \(tally.top1)/\(tally.total) top1, \(tally.top3) top3; unknown \(tally.unknownTop1) top1, \(tally.unknownTop3) top3; committed \(tally.committed), reachable \(tally.reachable), start caps \(tally.startCapitalized)/\(tally.starts)")
    }
    print("CONTEXT latency median \(report.medianMilliseconds)ms p95 \(report.p95Milliseconds)ms")
    #expect(!report.results.isEmpty)
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_CONTEXT_SWIPES"] != nil))
  func decodeRecordedSwipesInContext() throws {
    try audit(path: ProcessInfo.processInfo.environment["PK_CONTEXT_SWIPES"]!, clean: false)
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_CONTEXT_CLEAN"] != nil))
  func decodeCleanControlPaths() throws {
    try audit(path: ProcessInfo.processInfo.environment["PK_CONTEXT_CLEAN"]!, clean: true)
  }
}
