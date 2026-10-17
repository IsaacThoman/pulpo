import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in paired probe with frozen cases, distinct typo/literal metrics, and
/// per-case artifacts kept outside Git. This is not a population accuracy estimate.
struct PairedTypingProbeTests {
  struct Item: Codable {
    var input: String
    var expected: String
    var kind: String
  }

  struct Corpus: Decodable {
    var develop: [Item]
    var verify: [Item]
  }

  struct Row: Codable {
    var input: String
    var expected: String
    var kind: String
    var output: String
    var suggestions: [String]
    var passed: Bool
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_PAIRED_TYPING_SPLIT"] != nil))
  func evaluateFrozenPairedTypingProbe() throws {
    let environment = ProcessInfo.processInfo.environment
    let split = try #require(environment["PK_PAIRED_TYPING_SPLIT"])
    try #require(split == "develop" || split == "verify")
    let url = Fixtures.languageData.deletingLastPathComponent()
      .appendingPathComponent("Tests/Fixtures/paired-typing-probe.json")
    let corpus = try JSONDecoder().decode(Corpus.self, from: Data(contentsOf: url))
    let cases = split == "develop" ? corpus.develop : corpus.verify
    var rows: [Row] = []
    for item in cases {
      let (engine, document) = Fixtures.engine()
      engine.type("and " + item.input)
      let suggestions = engine.suggestions.slots.map(\.text)
      engine.insertSpace()
      try #require(document.text.hasPrefix("And "))
      try #require(document.text.hasSuffix(" "))
      let output = String(document.text.dropFirst(4).dropLast())
      // Literal controls include exact casing. Typo recovery treats smart
      // apostrophes and capitalization as formatting rather than spelling errors.
      func normalized(_ text: String) -> String {
        text.lowercased().replacingOccurrences(of: "’", with: "'")
      }
      let passed = item.kind == "literal" ? output == item.expected : normalized(output) == normalized(item.expected)
      rows.append(Row(input: item.input, expected: item.expected, kind: item.kind,
                      output: output, suggestions: suggestions, passed: passed))
    }
    for kind in ["typo", "literal"] {
      let subset = rows.filter { $0.kind == kind }
      print("Paired typing \(split) \(kind): \(subset.filter(\.passed).count)/\(subset.count)")
    }
    if let report = environment["PK_PAIRED_TYPING_REPORT"] {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(rows).write(to: URL(fileURLWithPath: report), options: .atomic)
    }
  }
}
