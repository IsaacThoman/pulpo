import Foundation
import Testing
@testable import KeyboardCore

/// Decodes externally generated swipe paths, e.g. the ones replayed into Gboard for
/// comparison. Set `PK_BENCH_PATHS` to a JSON array of `{word, points: [[x, y]]}` in
/// key-pitch units; results are written next to it as `pulpo.json`.
struct SwipeBenchmarkTests {
  struct Item: Codable {
    let word: String
    let points: [[Double]]
  }

  struct Result: Codable {
    let word: String
    let pulpo: String
    let alternatives: [String]
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_BENCH_PATHS"] != nil))
  func decodeBenchmarkPaths() throws {
    let url = URL(fileURLWithPath: ProcessInfo.processInfo.environment["PK_BENCH_PATHS"]!)
    let items = try JSONDecoder().decode([Item].self, from: Data(contentsOf: url))
    let (model, _, glide) = Fixtures.stack()
    let context = model.context(previousWord: nil, sentenceStart: true)
    let results = items.map { item in
      let candidates = glide.decode(item.points.map { KeyPoint(x: $0[0], y: $0[1]) }, context: context).map(\.text)
      return Result(word: item.word, pulpo: candidates.first ?? "", alternatives: Array(candidates.dropFirst().prefix(2)))
    }
    try JSONEncoder().encode(results).write(to: url.deletingLastPathComponent().appendingPathComponent("pulpo.json"))
    let top1 = results.filter { $0.pulpo.lowercased() == $0.word }.count
    let top3 = results.filter { ([$0.pulpo] + $0.alternatives).map { $0.lowercased() }.contains($0.word) }.count
    print("Pulpo top-1 \(top1)/\(results.count), top-3 \(top3)/\(results.count)")
  }
}
