import Testing
@testable import KeyboardCore

/// Mirrors `packages/client-core/src/dictation.test.ts`, which the app's meter uses.
struct DictationLevelsTests {
  @Test func clampsSilenceAndOverload() {
    for decibels: Double in [.nan, -.infinity, -60, -120] { #expect(DictationLevels.normalized(decibels: decibels) == 0) }
    for decibels: Double in [0, 6, .infinity] { #expect(DictationLevels.normalized(decibels: decibels) == 1) }
    #expect(DictationLevels.normalized(rms: 0) == 0)
  }

  @Test func risesMonotonicallyAndKeepsSpeechVisible() {
    let levels = [-59.0, -50, -40, -30, -20, -10, -1].map(DictationLevels.normalized(decibels:))
    for index in 1..<levels.count { #expect(levels[index] > levels[index - 1]) }
    #expect(DictationLevels.normalized(decibels: -30) > 0.15)
    #expect(DictationLevels.normalized(decibels: -20) > 0.3)
    #expect(DictationLevels.normalized(decibels: -20) < 0.5)
  }

  @Test func barCountFillsTheTrackPlusTheOneLeaving() {
    #expect(DictationLevels.barCount(width: 0) == 2)
    #expect(DictationLevels.barCount(width: 100) == 21)
    #expect(DictationLevels.barCount(width: 10_000) == DictationLevels.samples)
  }
}
