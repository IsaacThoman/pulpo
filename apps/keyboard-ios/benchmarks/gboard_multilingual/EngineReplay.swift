import Foundation
import KeyboardCore

final class Document: TextDocument {
  var text = ""
  var documentContextBeforeInput: String? { text }
  var documentContextAfterInput: String? { "" }
  var selectedText: String? { nil }
  var hasText: Bool { !text.isEmpty }
  func insertText(_ value: String) { text += value }
  func deleteBackward() { if !text.isEmpty { text.removeLast() } }
}
struct Corpus: Decodable { let cases: [Case] }
struct Case: Decodable { let id, mode, category, typed, expected, final_boundary: String }
struct Result: Encodable { let id, output: String; let exact: Bool; let elapsedSeconds: Double }
let args = CommandLine.arguments
let corpus = try JSONDecoder().decode(Corpus.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let modes: [String: KeyboardLanguage] = ["en": .english, "es": .spanish, "en-es": .bilingual]
var results: [Result] = []
for c in corpus.cases {
  let start = Date()
  let language = modes[c.mode]!
  let stack = try LanguageStack(dictionaryURL: URL(fileURLWithPath: args[2]).appendingPathComponent(language.rawValue + ".pkdict"), personalURL: nil)
  let document = Document()
  var settings = KeyboardSettings()
  settings.language = language
  settings.autoCapitalization = false
  settings.smartPunctuation = false
  settings.doubleSpacePeriod = false
  settings.learnWords = false
  let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
  engine.documentDidChange()
  for ch in c.typed + c.final_boundary {
    if ch == " " { engine.insertSpace() } else { engine.insertCharacter(String(ch)) }
  }
  // Compare Unicode scalars: Swift String equality otherwise folds canonical equivalents.
  results.append(Result(id: c.id, output: document.text, exact: Array(document.text.unicodeScalars) == Array(c.expected.unicodeScalars), elapsedSeconds: Date().timeIntervalSince(start)))
}
let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
try encoder.encode(results).write(to: URL(fileURLWithPath: args[3]))
