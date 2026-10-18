import Foundation
import Testing
@testable import KeyboardCore

/// Randomized editing sequences checked against the invariants in `EngineFuzz.swift`.
///
/// The default run is small enough for the normal suite. Set `PK_FUZZ_ITERATIONS`
/// (seed count) for a long run, with `PK_FUZZ_SEED_START` (default 1), `PK_FUZZ_OPS`
/// (default 200), `PK_FUZZ_REPORT` (JSON output path), `PK_FUZZ_SHRINK` (number of
/// failing seeds to shrink per class) and `PK_FUZZ_PROGRESS` (last started seed, so
/// a crashing seed can be identified by an outer driver).
struct EngineFuzzTests {
  struct Tally: Codable {
    var violations = 0
    var seeds = 0
  }

  struct Repro: Codable {
    var seed: UInt64
    var config: String
    var ops: [String]
    var violation: String
  }

  struct Report: Codable {
    var seedStart: UInt64
    var seedCount: Int
    var opsPerSeed: Int
    var executed = 0
    var skipped = 0
    var seconds = 0.0
    var classes: [String: Tally] = [:]
    var keys: [String: Tally] = [:]
    var examples: [String: [String]] = [:]
    var repros: [String: [Repro]] = [:]
    var nondeterministicSeeds: [UInt64] = []
  }

  static func run(seeds: ClosedRange<UInt64>, ops: Int, shrinkPerClass: Int = 0, progress: URL? = nil,
                  determinismEvery: UInt64 = 25) -> Report
  {
    var report = Report(seedStart: seeds.lowerBound, seedCount: seeds.count, opsPerSeed: ops)
    let started = Date()
    var shrunk: [String: Int] = [:]
    for seed in seeds {
      if let progress { try? "\(seed)\n".write(to: progress, atomically: false, encoding: .utf8) }
      let result = EngineFuzz.generate(seed: seed, count: ops)
      report.executed += result.executed
      report.skipped += result.skipped
      if determinismEvery > 0, seed % determinismEvery == 0 {
        let again = EngineFuzz.replay(seed: seed, config: result.config, ops: result.ops)
        if again.fingerprint != result.fingerprint || again.violations.map(\.key) != result.violations.map(\.key) {
          report.nondeterministicSeeds.append(seed)
          report.classes["nondeterministic", default: Tally()].violations += 1
          report.classes["nondeterministic", default: Tally()].seeds += 1
        }
      }
      var seenClasses = Set<String>(), seenKeys = Set<String>()
      for violation in result.violations {
        report.classes[violation.cls, default: Tally()].violations += 1
        report.keys[violation.key, default: Tally()].violations += 1
        if seenClasses.insert(violation.cls).inserted { report.classes[violation.cls, default: Tally()].seeds += 1 }
        if seenKeys.insert(violation.key).inserted {
          report.keys[violation.key, default: Tally()].seeds += 1
          if report.examples[violation.key, default: []].count < 4 {
            report.examples[violation.key, default: []].append(violation.description)
          }
          if shrinkPerClass > 0, shrunk[violation.key, default: 0] < shrinkPerClass {
            shrunk[violation.key, default: 0] += 1
            let prefix = Array(result.ops.prefix(violation.op + 1))
            let minimal = EngineFuzz.shrink(seed: seed, config: result.config, ops: prefix, key: violation.key)
            let final = EngineFuzz.replay(seed: seed, config: result.config, ops: minimal)
            let message = final.violations.first { $0.key == violation.key }?.description ?? violation.description
            report.repros[violation.key, default: []].append(
              Repro(seed: seed, config: result.config.description, ops: minimal.map(\.description), violation: message))
          }
        }
      }
    }
    report.seconds = Date().timeIntervalSince(started)
    return report
  }

  @Test func shortRandomizedEditingSequencesKeepInvariants() {
    let report = Self.run(seeds: 1...12, ops: 150, determinismEvery: 4)
    #expect(report.executed >= 1800)
    let lines = report.examples.sorted { $0.key < $1.key }.flatMap { $0.value }
    #expect(report.classes.isEmpty, "\(report.classes)\n\(lines.joined(separator: "\n"))")
  }

  @Test func sameSeedReplaysIdentically() {
    let first = EngineFuzz.generate(seed: 77, count: 200)
    let second = EngineFuzz.generate(seed: 77, count: 200)
    let replayed = EngineFuzz.replay(seed: 77, config: first.config, ops: first.ops)
    #expect(first.ops == second.ops)
    #expect(first.fingerprint == second.fingerprint)
    #expect(first.fingerprint == replayed.fingerprint)
    #expect(first.finalText == replayed.finalText)
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_FUZZ_ITERATIONS"] != nil))
  func longRandomizedEditingRun() throws {
    let environment = ProcessInfo.processInfo.environment
    let count = UInt64(environment["PK_FUZZ_ITERATIONS"].flatMap(Int.init) ?? 100)
    let start = UInt64(environment["PK_FUZZ_SEED_START"].flatMap(Int.init) ?? 1)
    let ops = environment["PK_FUZZ_OPS"].flatMap(Int.init) ?? 200
    let shrink = environment["PK_FUZZ_SHRINK"].flatMap(Int.init) ?? 0
    let progress = environment["PK_FUZZ_PROGRESS"].map { URL(fileURLWithPath: $0) }
    let report = Self.run(seeds: start...(start + count - 1), ops: ops, shrinkPerClass: shrink, progress: progress)
    if let path = environment["PK_FUZZ_REPORT"] {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(report).write(to: URL(fileURLWithPath: path))
    }
    let summary = report.keys.sorted { $0.key < $1.key }.map { "\($0.key): \($0.value.violations)/\($0.value.seeds)" }
    print("fuzz \(report.executed) ops, \(report.seconds)s\n" + summary.joined(separator: "\n"))
  }
}
