import Foundation
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

  @Test func liftsUnprocessedSpeechToTheAppsRange() {
    let gain = DictationLevels.unprocessedInputGainDecibels
    let rms = { (decibels: Double) in Float(pow(10, decibels / 20)) }
    #expect(abs(DictationLevels.normalized(rms: rms(-30)) - DictationLevels.normalized(decibels: -30)) < 0.001)
    // Raw in-keyboard speech fills a good part of the track, as metered speech does in the app.
    #expect(DictationLevels.normalized(rms: rms(-40), gainDecibels: gain) > 0.3)
    #expect(DictationLevels.normalized(rms: rms(-30), gainDecibels: gain) > 0.6)
    #expect(DictationLevels.normalized(rms: rms(-30), gainDecibels: gain) < 1)
    // Room noise stays near the floor.
    #expect(DictationLevels.normalized(rms: rms(-70), gainDecibels: gain) < 0.1)
  }

  @Test func barCountFillsTheTrackPlusTheOneLeaving() {
    #expect(DictationLevels.barCount(width: 0) == 2)
    #expect(DictationLevels.barCount(width: 100) == 21)
    #expect(DictationLevels.barCount(width: 10_000) == DictationLevels.samples)
  }
}
