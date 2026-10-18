import Foundation
import Testing
@testable import KeyboardCore

/// Minimal fuzzer sequences that violated an editing invariant before their fix.
/// Each replays through the oracle in `EngineFuzz.swift` and must stay clean.
struct FuzzRepro: Sendable, CustomTestStringConvertible {
  var name: String
  var config: FuzzConfig
  var ops: [FuzzOp]
  var testDescription: String { name }
}

struct EngineFuzzRegressionTests {
  static let repros: [FuzzRepro] = [
    FuzzRepro(
      name: "autospaceDoubleSpace (seed 23)",
      config: FuzzConfig(field: .standard, prefill: "ok  ", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .letter("t", KeyPoint(x: 4.679, y: -0.34), dt: 0.299),
        .typeAfter(" later", .now),
        .tapSlot(2),
      ]),
    FuzzRepro(
      name: "autospaceDoubleSpace@pending (seed 20)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .key("$", dt: 0.379),
        .replaceAll("Sent. ", .pending),
        .swipe("hello", seed: 11420, noise: 0.2),
      ]),
    FuzzRepro(
      name: "backspaceDeletedTooMuch@pending+afterContextChange (seed 175)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: true),
      ops: [
        .paste("x", .pending),
        .ack,
        .swipe("home", seed: 64327, noise: 0.2),
        .moveCursor(0.363, .pending),
        .backspace(dt: 0.151),
      ]),
    FuzzRepro(
      name: "backspaceDeletedTooMuch@pending+selection (seed 342)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .swipe("something", seed: 82653, noise: 0.2),
        .select(0.162, 3, .pending),
        .backspace(dt: 0.333),
      ]),
    FuzzRepro(
      name: "capsMissed (seed 60)",
      config: FuzzConfig(field: .words, prefill: "", settingsToggles: [], identities: true, emptyAsNil: true),
      ops: [
        .swipe("dr", seed: 62405, noise: 0.0),
        .letter("s", KeyPoint(x: 2.0, y: 1.0), dt: 0.241),
      ]),
    FuzzRepro(
      name: "composingDesync (seed 156)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .tapSlot(0),
        .paste("👍", .pending),
        .backspace(dt: 0.114),
        .ack,
      ]),
    FuzzRepro(
      name: "editOutsideCurrentWord@pending+selection (seed 193)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .letter("a", KeyPoint(x: 1.0, y: 1.0), dt: 0.292),
        .letter("t", KeyPoint(x: 4.5, y: 0.0), dt: 0.239),
        .letter("s", KeyPoint(x: 2.0, y: 1.0), dt: 0.266),
        .select(0.845, 7, .pending),
        .space(dt: 2.291),
      ]),
    FuzzRepro(
      name: "freshSuggestionIgnored (seed 148)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: false, emptyAsNil: true),
      ops: [
        .paste("hello", .pending),
        .reentrant(ops: 3),
        .letter("w", KeyPoint(x: 1.755, y: 0.316), dt: 0.171),
        .letter("r", KeyPoint(x: 3.344, y: 0.116), dt: 0.24),
        .returnKey,
        .tapSlot(0),
      ]),
    FuzzRepro(
      name: "literalFieldTransform (seed 17)",
      config: FuzzConfig(field: .straightQuotes, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .fieldSwitch(.email, prefill: "", cursor: nil, identity: 444866, .now),
        .swipe("zqcvj", seed: 88896, noise: 0.2),
        .letter("z", KeyPoint(x: 2.069, y: 1.926), dt: 0.26),
      ]),
    FuzzRepro(
      name: "partialWordReplacement (seed 8)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .transcript(" spaced "),
        .letter("l", KeyPoint(x: 9.333, y: 1.428), dt: 0.264),
        .letter("e", nil, dt: 0.233),
        .space(dt: 0.316),
      ]),
    FuzzRepro(
      name: "partialWordReplacement@pending (seed 104)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .letter("n", KeyPoint(x: 7.373, y: 2.112), dt: 0.149),
        .paste("https://example.com", .pending),
        .letter("w", KeyPoint(x: 1.167, y: 0.245), dt: 0.092),
        .letter("o", KeyPoint(x: 8.393, y: 0.111), dt: 0.275),
        .key("!", dt: 0.154),
      ]),
    FuzzRepro(
      name: "partialWordReplacement@pending+midWord (seed 52)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [.swipeTyping], identities: false, emptyAsNil: false),
      ops: [
        .letter("r", KeyPoint(x: 3.5, y: 0.0), dt: 0.161),
        .letter("i", KeyPoint(x: 7.5, y: 0.0), dt: 0.296),
        .letter("t", KeyPoint(x: 4.5, y: 0.0), dt: 0.202),
        .letter("o", KeyPoint(x: 8.5, y: 0.0), dt: 0.223),
        .space(dt: 0.12),
        .moveCursor(0.242, .pending),
        .space(dt: 0.123),
      ]),
    FuzzRepro(
      name: "swipeGlued@pending (seed 6)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .letter("r", KeyPoint(x: 3.5, y: 0.0), dt: 0.246),
        .letter("k", KeyPoint(x: 8.0, y: 1.0), dt: 0.078),
        .space(dt: 1.136),
        .select(0.334, 2, .pending),
        .swipe("this", seed: 4667, noise: 0.2),
      ]),
    FuzzRepro(
      name: "wordDeleteWrong@pending (seed 24)",
      config: FuzzConfig(field: .straightQuotes, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .tapSlot(0),
        .paste("Copied text. ", .now),
        .select(0.606, 8, .pending),
        .backspace(dt: 0.1),
        .backspace(dt: 0.1),
        .backspace(dt: 0.1),
        .backspace(dt: 0.1),
        .backspace(dt: 0.1),
        .backspace(dt: 0.1),
        .deleteWord,
      ]),
    FuzzRepro(
      name: "wordDeleteWrong@pending+partial (seed 24)",
      config: FuzzConfig(field: .straightQuotes, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .letter("l", KeyPoint(x: 9.132, y: 0.969), dt: 0.284),
        .letter("l", KeyPoint(x: 9.0, y: 0.917), dt: 0.227),
        .letter("y", KeyPoint(x: 5.463, y: 0.07), dt: 0.24),
        .paste("Copied text. ", .now),
        .select(0.606, 8, .pending),
        .backspace(dt: 0.1),
        .deleteWord,
      ]),
    FuzzRepro(
      name: "wordDeleteWrong@pending+selection (seed 9)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .key("5", dt: 0.38),
        .paste("don\'t", .now),
        .tapSlot(1),
        .space(dt: 0.25),
        .select(0.139, 6, .pending),
        .deleteWord,
      ]),
    FuzzRepro(
      name: "wordDeleteWrong@selection (seed 35)",
      config: FuzzConfig(field: .standard, prefill: "", settingsToggles: [], identities: true, emptyAsNil: false),
      ops: [
        .letter("t", KeyPoint(x: 4.655, y: -0.368), dt: 0.074),
        .letter("e", KeyPoint(x: 2.801, y: -0.054), dt: 0.245),
        .key("5", dt: 0.398),
        .select(0.914, 3, .now),
        .deleteWord,
      ]),
  ]

  @Test(arguments: repros)
  func minimalSequenceKeepsInvariants(_ repro: FuzzRepro) {
    let result = EngineFuzz.replay(config: repro.config, ops: repro.ops)
    #expect(result.violations.isEmpty, "\(result.violations)")
  }

  /// A host edit that recreates one of our own states from the last second (a
  /// rejected insert, a host-side undo or delete) is indistinguishable from a
  /// delayed snapshot of that state, so the engine keeps its newer expectation.
  static let ownStateReverts: [FuzzRepro] = [
    FuzzRepro(
      name: "wordDeleteWrong (seed 440)",
      config: FuzzConfig(field: .twitter, prefill: "", settingsToggles: [], identities: false, emptyAsNil: false),
      ops: [
        .space(dt: 0.307),
        .letter("a", KeyPoint(x: 1.0, y: 1.0), dt: 0.061),
        .space(dt: 0.173),
        .deleteRange(0.973, 3, .now),
        .deleteWord,
      ]),
    FuzzRepro(
      name: "composingDesync (seed 227)",
      config: FuzzConfig(field: .webSearch, prefill: "teh", settingsToggles: [.predictions], identities: true, emptyAsNil: false),
      ops: [
        .letter("i", KeyPoint(x: 7.525, y: -0.179), dt: 0.259),
        .deleteRange(0.989, 4, .now),
      ]),
  ]

  @Test(arguments: ownStateReverts)
  func hostRevertToARecentOwnStateIsAKnownAmbiguity(_ repro: FuzzRepro) {
    let result = EngineFuzz.replay(config: repro.config, ops: repro.ops)
    withKnownIssue("Taken for proxy lag within the one-second own-snapshot window") {
      #expect(result.violations.isEmpty, "\(result.violations)")
    }
  }
}
