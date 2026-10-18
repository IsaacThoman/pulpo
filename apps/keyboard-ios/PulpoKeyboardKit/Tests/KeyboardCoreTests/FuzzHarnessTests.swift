import Testing

struct FuzzHarnessTests {
  @Test(arguments: [-0.01, 0.0, 1.0, 1.009])
  func cursorDragsStayInsideTheHostDocument(fraction: Double) {
    let text = String(repeating: "a", count: 200)
    let run = FuzzRun(seed: 782_182, config: FuzzConfig(prefill: text))
    run.execute(.moveCursor(fraction, .now))
    let expected = max(0, min(text.count, Int((Double(text.count) * fraction).rounded(.down))))
    #expect(run.host.cursor == expected)
    #expect(run.host.trueBefore + run.host.trueAfter == text)
    #expect(run.host.trueSelection.isEmpty)
  }

  @Test func largeDocumentSeedFinishesAndReplays() {
    let first = EngineFuzz.generate(seed: 782_182, count: 300)
    let replayed = EngineFuzz.replay(seed: 782_182, config: first.config, ops: first.ops)
    #expect(first.executed >= 300)
    #expect(first.finalText == replayed.finalText)
    #expect(first.fingerprint == replayed.fingerprint)
    #expect(first.violations.map(\.key) == replayed.violations.map(\.key))
  }
}
