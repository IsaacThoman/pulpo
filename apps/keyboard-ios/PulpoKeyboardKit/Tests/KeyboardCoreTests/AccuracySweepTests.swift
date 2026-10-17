import Foundation
import Testing
@testable import KeyboardCore

/// Frozen independent corpus, opt-in so ordinary tests do not treat measured
/// recall as a brittle assertion. Run baseline/candidate with the same adapter.
struct AccuracySweepTests {
  private struct Prompt: Decodable {
    var kind: String
    var family: String?
    var input: String?
    var target: String?
    var context: String?
    var before: String?
    var after: String?
  }

  private struct Result: Encodable {
    var kind: String
    var family: String?
    var input: String
    var target: String?
    var choices: [String] = []
    var automatic: String?
    var top1: Bool? = nil
    var top3: Bool? = nil
    var safe: Bool? = nil
    var supported = true
    var detail = ""
    var milliseconds = 0.0
  }

  @Test func measureFrozenAccuracyCorpus() throws {
    let env = ProcessInfo.processInfo.environment
    guard let corpusPath = env["PK_ACCURACY_CORPUS"], let output = env["PK_ACCURACY_REPORT"] else { return }
    let prompts = try JSONDecoder().decode([Prompt].self, from: Data(contentsOf: URL(fileURLWithPath: corpusPath)))
    var results: [Result] = []
    for prompt in prompts {
      let start = ProcessInfo.processInfo.systemUptime
      var result = Result(kind: prompt.kind, family: prompt.family, input: prompt.input ?? prompt.before ?? prompt.context ?? prompt.target ?? "", target: prompt.target)
      let (model, suggester, glide) = Fixtures.stack()
      switch prompt.kind {
      case "correction":
        let set = suggester.suggestions(for: TypedWord(text: prompt.input!), context: .unknown, autocorrect: true)
        // The strongest choice is centered, per SuggestionSet's display contract.
        result.choices = ranked(set)
        result.automatic = set.autocorrection
        result.top1 = matches(result.choices.first, prompt.target)
        result.top3 = result.choices.contains { matches($0, prompt.target) }
        result.detail = suggester.candidates(for: TypedWord(text: prompt.input!), context: .unknown).prefix(6)
          .map { "\($0.text): cost=\($0.cost), score=\($0.score), completion=\($0.isCompletion)" }.joined(separator: "; ")
      case "swipe":
        let choices = glide.decode(path(for: prompt.target!, family: prompt.family!), context: .unknown, limit: 3)
        result.choices = choices.map(\.text)
        result.top1 = matches(result.choices.first, prompt.target)
        result.top3 = result.choices.contains { matches($0, prompt.target) }
      case "prediction":
        let words = prompt.context!.split(separator: " ").map(String.init)
        let context = model.context(previousWord: words.last, sentenceStart: false, precedingWord: words.count > 1 ? words[words.count - 2] : nil)
        result.choices = ranked(suggester.predictions(context: context))
        result.top1 = matches(result.choices.first, prompt.target)
        result.top3 = result.choices.contains { matches($0, prompt.target) }
      case "safety":
        result.safe = true
        for prefix in ["", "ask "] {
          let (engine, document) = literalEngine(prefix + prompt.input!)
          let auto = engine.suggestions.autocorrection
          engine.insertSpace()
          let expected = prefix + prompt.input! + " "
          result.safe = result.safe! && document.text == expected
          result.detail += "\(prefix.isEmpty ? "start" : "middle"): \(document.text) auto=\(auto ?? "nil"); "
        }
      case "editing":
        let word = prompt.before!
        switch prompt.family! {
        case "stale", "cursor":
          let (engine, document) = literalEngine("say " + word)
          guard let old = engine.suggestions.slots.first(where: { $0.kind != .literal }) else {
            result.supported = false
            result.detail = "No nonliteral choice available"
            results.append(result)
            continue
          }
          if prompt.family == "stale" {
            document.text = "say " + prompt.after!
            document.cursor = document.text.endIndex
          } else {
            document.moveCursor(to: 4 + word.count / 2)
          }
          let expected = document.text
          engine.select(old)  // The host has not sent its change callback yet.
          result.safe = document.text == expected
          result.detail = document.text
        case "boundary":
          let (engine, document) = literalEngine(word + " world")
          document.moveCursor(to: word.count)
          engine.documentDidChange()
          if let literal = engine.suggestions.slots.first(where: { $0.kind == .literal }) {
            engine.select(literal)
            result.safe = document.text == word + " world"
          } else { result.supported = false }
          result.detail = document.text
        case "literal":
          let (engine, document) = literalEngine("ask " + word)
          if let literal = engine.suggestions.slots.first(where: { $0.kind == .literal }) {
            engine.select(literal)
            engine.deleteBackward()
            result.safe = document.text == "ask " + word
          } else { result.supported = false }
          result.detail = document.text
        default: result.supported = false
        }
      default: result.supported = false
      }
      result.milliseconds = (ProcessInfo.processInfo.systemUptime - start) * 1_000
      results.append(result)
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(results).write(to: URL(fileURLWithPath: output))
    #expect(results.count == prompts.count)
    #expect(results.allSatisfy { $0.supported })
  }

  private func ranked(_ set: SuggestionSet) -> [String] {
    guard set.slots.count >= 2 else { return set.slots.map(\.text) }
    return [set.slots[1].text, set.slots[0].text] + set.slots.dropFirst(2).map(\.text)
  }

  private func matches(_ actual: String?, _ expected: String?) -> Bool {
    guard let actual, let expected else { return false }
    return actual.lowercased() == expected.lowercased()
  }

  private func literalEngine(_ text: String) -> (KeyboardEngine, MockDocument) {
    var traits = InputTraits()
    traits.capitalization = .none
    return Fixtures.engine(text, traits: traits)
  }

  private func path(for word: String, family: String) -> [KeyPoint] {
    let centers = word.utf8.compactMap { LetterGeometry.qwerty.center($0) }
    if family == "sparse" {
      return centers.enumerated().compactMap { index, point in
        index == 0 || index == centers.count - 1 || index % 2 == 0 ? point : nil
      }
    }
    if family == "jitter" {
      return centers.enumerated().map { index, point in
        let delta = index % 2 == 0 ? 0.12 : -0.12
        return KeyPoint(x: point.x + delta, y: point.y - delta)
      }
    }
    return centers
  }
}
