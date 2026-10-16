import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in diagnostic: frozen synthetic prompts, never a person's messages.
/// COMPLETION_SWEEP_OUTPUT=/absolute/path swift test -c release --filter CompletionCandidatesBenchmarkTests
struct CompletionCandidatesBenchmarkTests {
  struct Prompt: Decodable {
    var id: String
    var group: String
    var mode: String
    var context: String
    var prefix: String
    var accepted: [String]
  }
  struct Split: Decodable { var cases: [Prompt] }
  struct Slot: Encodable {
    var text: String
    var kind: String
    var automatic: Bool
  }
  struct Row: Encodable {
    var id: String
    var group: String
    var mode: String
    var slots: [Slot]
    var autocorrection: String?
    var hit: Bool
    var leftSlotHit: Bool
    var useful: Bool
    var saved: Int
    var coldMicroseconds: Double
    var warmMicroseconds: [Double]
    var rankedDiagnostic: [String]?
  }

  @Test func captureVisibleSlots() throws {
    guard let destination = ProcessInfo.processInfo.environment["COMPLETION_SWEEP_OUTPUT"] else { return }
    let root = Fixtures.languageData.deletingLastPathComponent()
    let emoji = EmojiSuggester(catalog: try EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json")))
    let output = URL(fileURLWithPath: destination)
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    let splits = ProcessInfo.processInfo.environment["COMPLETION_SWEEP_SPLIT"].map { [$0] } ?? ["development", "verification"]
    for split in splits {
      let url = root.appendingPathComponent("benchmarks/completion-candidates/\(split).json")
      let prompts = try JSONDecoder().decode(Split.self, from: Data(contentsOf: url)).cases
      var rows: [Row] = []
      for prompt in prompts {
        // A fresh empty personal model per prompt; host context does not train it.
        let (engine, _) = Fixtures.engine(prompt.context + prompt.prefix)
        engine.emojiSuggester = emoji
        let start = DispatchTime.now().uptimeNanoseconds
        let visible = engine.suggestions
        let cold = Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000
        #expect(visible.slots.count <= 3)
        func accepted(_ text: String) -> Bool {
          prompt.accepted.contains { $0.precomposedStringWithCanonicalMapping.lowercased() == text.precomposedStringWithCanonicalMapping.lowercased() }
        }
        let matches = visible.slots.filter { accepted($0.text) }
        let saved = matches.map { max(0, $0.text.count - prompt.prefix.count - 1) }.max() ?? 0
        var warm: [Double] = []
        for _ in 0..<20 {
          let start = DispatchTime.now().uptimeNanoseconds
          engine.refreshSuggestions()
          warm.append(Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000)
        }
        // Development-only retrieval diagnostics; never part of slot scoring.
        let diagnostic = split == "development" && !prompt.prefix.isEmpty
          ? engine.suggester!.candidates(for: engine.composing, context: engine.languageContext()).prefix(16).map { "\($0.text)|\($0.isCompletion ? "completion" : "edit")|\($0.cost)|\($0.score)" }
          : nil
        rows.append(Row(id: prompt.id, group: prompt.group, mode: prompt.mode,
                        slots: visible.slots.map { Slot(text: $0.text, kind: String(describing: $0.kind), automatic: $0.isAutocorrection) },
                        autocorrection: visible.autocorrection, hit: !matches.isEmpty,
                        leftSlotHit: visible.slots.first.map { accepted($0.text) } ?? false,
                        useful: saved > 0, saved: saved, coldMicroseconds: cold,
                        warmMicroseconds: warm, rankedDiagnostic: diagnostic))
      }
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
      try encoder.encode(rows).write(to: output.appendingPathComponent("\(split).json"))
      // Verification outcomes stay opaque until final selection is frozen.
      if split == "development" {
        print("COMPLETION DEVELOPMENT: hit=\(rows.filter(\.hit).count)/\(rows.count) useful=\(rows.filter(\.useful).count) saved=\(rows.reduce(0) { $0 + $1.saved })")
      }
    }
  }
}
