import Foundation
import Testing
@testable import KeyboardCore

/// Frozen user tasks, driven through the controller's production engine entry points.
/// Run one explicitly named suite; never enumerate or load the held-out file implicitly.
@Suite(.serialized)
struct InsertedTextSpacingSweepTests {
  private struct Action: Decodable { let kind: String; let text: String }
  private struct Task: Decodable {
    let id: String
    let mode: String
    let initialLeft: String
    let initialRight: String
    let actions: [Action]
    let expected: String
    let control: String
  }
  private struct Result: Encodable {
    let id: String
    let expected: String
    let actual: String
    let passed: Bool
    let completed: Bool
    let notes: [String]
  }
  private func language(_ value: String) throws -> KeyboardLanguage {
    switch value {
    case "en": .english
    case "es": .spanish
    case "bilingual": .bilingual
    default: throw SweepError.unsupported(value)
    }
  }
  private enum SweepError: Error { case unsupported(String) }

  @Test func frozenTasks() throws {
    let environment = ProcessInfo.processInfo.environment
    let suite = environment["PULPO_SPACING_SUITE"] ?? "development"
    #expect(["development", "held-out"].contains(suite))
    let fixtures = Fixtures.languageData.deletingLastPathComponent()
      .appendingPathComponent("Tests/Fixtures/inserted-text-spacing")
    let tasks = try JSONDecoder().decode([Task].self, from: Data(contentsOf: fixtures.appendingPathComponent(suite + ".json")))
    var results: [Result] = []
    for task in tasks {
      let mode = try language(task.mode)
      var stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(mode.rawValue + ".pkdict"), personalURL: nil)
      var settings = KeyboardSettings()
      settings.language = mode
      let document = MockDocument(task.initialLeft + task.initialRight)
      document.moveCursor(to: task.initialLeft.count)
      let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
      engine.documentDidChange()
      var notes: [String] = []
      var completed = true
      for action in task.actions {
        switch action.kind {
        case "snippet": engine.insertTranscript(action.text)
        case "emoji": engine.insertText(action.text)
        case "type": engine.type(action.text)
        case "mode":
          let mode = try language(action.text)
          stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(mode.rawValue + ".pkdict"), sharing: stack)
          engine.settings.language = mode
          engine.useLanguageStack(stack)
        case "suggestion":
          let choices = engine.suggestions.slots
          guard let choice = choices.first(where: { $0.text == action.text }) else {
            notes.append("Requested visible suggestion unavailable; offered: " + choices.map(\.text).joined(separator: " | "))
            completed = false
            break
          }
          engine.select(choice)
        case "swipe":
          var generator = SeededGenerator(state: 782_106)
          let candidates = engine.insertGlide(SyntheticSwipe.points(for: action.text, noise: 0, generator: &generator))
          notes.append("Swipe decoded: " + (candidates.first?.text ?? "<none>"))
          if candidates.isEmpty { completed = false }
        default: throw SweepError.unsupported(action.kind)
        }
        if !completed { break }
      }
      results.append(Result(id: task.id, expected: task.expected, actual: document.text,
                            passed: completed && document.text == task.expected, completed: completed, notes: notes))
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    let data = try encoder.encode(results)
    if let path = environment["PULPO_SPACING_RESULTS"] {
      try data.write(to: URL(fileURLWithPath: path))
    }
    print("SPACING SWEEP \(suite): \(results.filter(\.passed).count)/\(results.count) exact; \(results.filter { !$0.completed }.count) unavailable")
    print(String(decoding: data, as: UTF8.self))
  }
}
