import Foundation
import KeyboardCore

struct Event: Codable { let op: String; var text: String?; var count: Int?; var location: Int?; var callback: Bool? }
struct Item: Codable { let id, language, category, before, after, expected: String; var cursor: Int?; let events: [Event]; var expectedCorrection: String? }
struct Snapshot: Codable { let event: Int; let phase, text: String; let correction: String?; let slots: [String] }
struct Result: Codable { let id, category, language, expected, output: String; let exact: Bool; let expectedCorrection: String?; let finalCommitCorrection: String?; let finalCommitSlots: [String]; let correctionAvailable: Bool?; let snapshots: [Snapshot] }
final class Document: TextDocument {
 var text: String; var cursor: Int; var selection = 0
 let documentIdentifier: UUID? = UUID()
 init(_ item: Item) { text = item.before + item.after; cursor = item.cursor ?? item.before.count }
 var documentContextBeforeInput: String? { String(text.prefix(cursor)) }
 var documentContextAfterInput: String? { String(text.dropFirst(cursor + selection)) }
 var selectedText: String? { selection > 0 ? String(text.dropFirst(cursor).prefix(selection)) : nil }
 var hasText: Bool { !text.isEmpty }
 func insertText(_ value: String) { text = String(text.prefix(cursor)) + value + String(text.dropFirst(cursor + selection)); cursor += value.count; selection = 0 }
 func deleteBackward() { if selection > 0 { text = String(text.prefix(cursor)) + String(text.dropFirst(cursor + selection)); selection = 0 } else if cursor > 0 { text = String(text.prefix(cursor - 1)) + String(text.dropFirst(cursor)); cursor -= 1 } }
}
let args = CommandLine.arguments
let items = try JSONDecoder().decode([Item].self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
var results: [Result] = []
for item in items {
 let stack = try LanguageStack(dictionaryURL: URL(fileURLWithPath: args[2]).appendingPathComponent(item.language + ".pkdict"), personalURL: nil)
 var settings = KeyboardSettings()
 settings.language = item.language == "es" ? .spanish : item.language == "en_es" ? .bilingual : .english
 let document = Document(item)
 let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
 engine.documentDidChange()
 var snapshots: [Snapshot] = []
 var finalCorrection: String?; var finalSlots: [String] = []
 func capture(_ event: Int, _ phase: String) {
  let suggestions = engine.suggestions
  snapshots.append(Snapshot(event: event, phase: phase, text: document.text, correction: suggestions.autocorrection, slots: suggestions.slots.map(\.text)))
 }
 for (index, event) in item.events.enumerated() {
  switch event.op {
  case "type":
   for character in event.text! {
    if character == " " || character == "\n" {
     finalCorrection = engine.suggestions.autocorrection; finalSlots = engine.suggestions.slots.map(\.text)
     capture(index,"before-separator")
     if character == " " { engine.insertSpace(tap: KeyPoint(x: 5, y: 3)) } else { engine.insertReturn() }
    } else {
     let key = String(character).lowercased()
     if character.isUppercase, !engine.shift.isActive { engine.shiftDown(); engine.shiftUp() }
     let point = character.isLetter && key.utf8.count == 1 ? key.utf8.first.flatMap(LetterGeometry.qwerty.center) : nil
     engine.insertCharacter(key, tap: point)
    }
    capture(index,"after-key")
   }
  case "delete": for _ in 0..<(event.count ?? 1) { engine.deleteBackward(); capture(index,"after-delete") }
  case "move", "select":
   document.cursor = event.location!; document.selection = event.op == "select" ? event.count! : 0
   if event.callback == true { engine.documentDidChange() }
   capture(index,"after-host-change")
  default: fatalError("Unknown operation")
  }
 }
 let available = item.expectedCorrection.map { wanted in finalCorrection == wanted || finalSlots.contains(wanted) }
 results.append(Result(id: item.id, category: item.category, language: item.language, expected: item.expected, output: document.text, exact: document.text == item.expected, expectedCorrection: item.expectedCorrection, finalCommitCorrection: finalCorrection, finalCommitSlots: finalSlots, correctionAvailable: available, snapshots: snapshots))
}
let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted,.sortedKeys,.withoutEscapingSlashes]
try encoder.encode(results).write(to: URL(fileURLWithPath: args[3]), options: .atomic)
print("\(results.filter(\.exact).count)/\(results.count) exact; \(args[3])")
