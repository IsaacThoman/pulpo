import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in, frozen literal/typo benchmark over the production engine and dictionaries.
/// PK_BILINGUAL_CASES=... PK_BILINGUAL_REPORT=... swift test -c release --filter BilingualTypingAccuracyBenchmark
struct BilingualTypingAccuracyBenchmarkTests {
  struct Case: Decodable {
    let id: String
    let category: String
    let modes: [String]
    let typed: String
    let desired: String
  }

  struct Outcome: Codable {
    let id: String
    let category: String
    let mode: String
    let typed: String
    let desired: String
    let output: String
    let rawOutput: String
    let correct: Bool
    let keyCount: Int
    let keyMilliseconds: [Double]
    let deletions: Int
  }

  struct Report: Codable {
    let schema: Int
    let elapsedSeconds: Double
    let outcomes: [Outcome]
  }

  /// Mirrors KeyboardController.activate: letter keys carry a touch; symbols and
  /// alternate accented characters have none. Uppercase intent uses real Shift.
  /// Safe space-bar center is below the bottom row, so no space-slip evidence.
  static func tap(_ character: Character, on engine: KeyboardEngine) {
    if character == " " { engine.insertSpace(tap: KeyPoint(x: 5, y: 3)); return }
    if character == "\n" { engine.insertReturn(); return }
    let key = String(character).lowercased()
    if character.isUppercase { engine.shiftDown(); engine.shiftUp() }
    let point = character.isLetter && key.utf8.count == 1
      ? key.utf8.first.flatMap(LetterGeometry.qwerty.center) : nil
    engine.insertCharacter(key, tap: point)
  }

  @Test func replayFrozenCases() throws {
    let environment = ProcessInfo.processInfo.environment
    guard let path = environment["PK_BILINGUAL_CASES"] else { return }
    let reportPath = try #require(environment["PK_BILINGUAL_REPORT"])
    let cases = try JSONDecoder().decode([Case].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    let start = ProcessInfo.processInfo.systemUptime
    var outcomes: [Outcome] = []
    for mode in ["en", "es", "bi"] {
      let language: KeyboardLanguage = mode == "en" ? .english : mode == "es" ? .spanish : .bilingual
      // Map immutable lexicon once per mode; every replay gets fresh personal/touch
      // state. No learning or language-switch/cache behavior is being benchmarked.
      let lexicon = try Lexicon(url: Fixtures.languageData.appendingPathComponent(language.rawValue + ".pkdict"))
      for item in cases where item.modes.contains(mode) {
        var texts: [String] = []
        var times: [Double] = []
        var deletions = 0
        for autocorrect in [true, false] {
          var settings = KeyboardSettings()
          settings.language = language
          settings.autoCapitalization = false
          settings.smartPunctuation = false
          settings.learnWords = false
          settings.autocorrect = autocorrect
          let model = LanguageModel(lexicon: lexicon, personal: PersonalDictionary(url: nil))
          let corrector = SpellCorrector(lexicon: lexicon)
          corrector.touch = TouchModel(url: nil)
          let engine = KeyboardEngine(document: MockDocument(), suggester: Suggester(model: model, corrector: corrector), glide: nil, settings: settings)
          engine.documentDidChange()
          for character in item.typed {
            let keyStart = ProcessInfo.processInfo.systemUptime
            Self.tap(character, on: engine)
            // UI renders the suggestion strip after each key. Include that work.
            _ = engine.suggestions
            if autocorrect { times.append((ProcessInfo.processInfo.systemUptime - keyStart) * 1_000) }
          }
          let document = try #require(engine.document as? MockDocument)
          texts.append(document.text)
          if autocorrect { deletions = document.deletions }
        }
        // Fails fast if our adapter cannot replay the exact frozen literal.
        #expect(texts[1] == item.typed, "raw adapter mismatch: \(item.id)/\(mode): \(texts[1])")
        outcomes.append(Outcome(id: item.id, category: item.category, mode: mode, typed: item.typed, desired: item.desired,
                                output: texts[0], rawOutput: texts[1], correct: texts[0] == item.desired,
                                keyCount: item.typed.count, keyMilliseconds: times, deletions: deletions))
      }
    }
    let report = Report(schema: 1, elapsedSeconds: ProcessInfo.processInfo.systemUptime - start, outcomes: outcomes)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    try encoder.encode(report).write(to: URL(fileURLWithPath: reportPath), options: .atomic)
    print("BILINGUAL_SWEEP: \(outcomes.filter(\.correct).count)/\(outcomes.count) exact; \(report.elapsedSeconds)s; \(reportPath)")
  }
}
