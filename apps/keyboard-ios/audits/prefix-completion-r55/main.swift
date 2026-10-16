import Foundation

struct Prompt: Codable {
  var id: String; var mode: String; var before: String; var prefix: String; var after: String
  var target: String; var action: String; var trait: String?; var learned: String?
}
final class Document: TextDocument {
  var text: String; var offset: Int
  init(_ text: String, _ offset: Int) { self.text = text; self.offset = offset }
  var cursor: String.Index { text.index(text.startIndex, offsetBy: offset) }
  var documentContextBeforeInput: String? { String(text[..<cursor]) }
  var documentContextAfterInput: String? { String(text[cursor...]) }
  var selectedText: String? { nil }
  var hasText: Bool { !text.isEmpty }
  func insertText(_ value: String) { text.insert(contentsOf: value, at: cursor); offset += value.count }
  func deleteBackward() { guard offset > 0 else { return }; text.remove(at: text.index(before: cursor)); offset -= 1 }
}
struct Slot: Codable { var text: String; var kind: String; var automatic: Bool }
struct Ranked: Codable { var text: String; var completion: Bool; var cost: Double; var score: Double }
struct Row: Codable {
  var id: String; var mode: String; var slots: [Slot]; var automatic: String?
  var candidates: [Ranked]; var exact: [String]; var shared: [String]; var prefixCount: Int
  var targetVisible: Bool; var targetTop8: Bool; var saved: Int; var fired: Bool
  var text: String; var caret: Int; var fullTextPass: Bool?; var personalCount: Int
}
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let prompts = try JSONDecoder().decode([Prompt].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[2])))
let lexicons = try Dictionary(uniqueKeysWithValues: ["en_US", "es", "en_es"].map { ($0, try Lexicon(url: root.appendingPathComponent("LanguageData/\($0).pkdict"))) })
var rows: [Row] = []
for p in prompts {
  let lexicon = lexicons[p.mode]!
  let personal = PersonalDictionary(url: nil)
  if let learned = p.learned { personal.learn(learned, after: nil); personal.learn(learned, after: nil) }
  let model = LanguageModel(lexicon: lexicon, personal: personal)
  let corrector = SpellCorrector(lexicon: lexicon)
  let suggester = Suggester(model: model, corrector: corrector)
  let document = Document(p.before + p.prefix + p.after, (p.before + p.prefix).count)
  var settings = KeyboardSettings(); settings.autoCapitalization = false; settings.learnWords = false
  let engine = KeyboardEngine(document: document, suggester: suggester, glide: nil, settings: settings)
  switch p.trait {
  case "secure": engine.traits.isSecure = true
  case "email": engine.traits.keyboard = .email
  case "url": engine.traits.keyboard = .url
  case "numeric": engine.traits.keyboard = .numberPad
  default: break
  }
  engine.documentDidChange()
  let set = engine.suggestions
  let ranked = suggester.candidates(for: TypedWord(text: p.prefix), context: engine.languageContext())
  let result = corrector.search(TypedWord(text: p.prefix))
  let key = TextNormalizer.key(p.prefix)
  let exact = lexicon.node(forKey: key.utf8).map { corrector.completions(of: [($0.index, 0)], limit: 8, excluding: key.utf8.count).map { lexicon.display($0.id) } } ?? []
  let shared = corrector.completions(of: result.prefixes, limit: 8, excluding: key.utf8.count).map { lexicon.display($0.id) }
  let visible = set.slots.contains { $0.text == p.target }
  var fired = false; var expected: String?; var expectedCaret: Int?
  if p.action == "space" {
    engine.insertSpace(); fired = true
  } else if let choice = set.slots.first(where: { $0.text == p.target && (p.action != "literal" || $0.kind == .literal) }) {
    engine.select(choice); fired = true
    let separator = p.after.first?.isWhitespace == true ? "" : " "
    expected = p.before + p.target + separator + p.after
    expectedCaret = (p.before + p.target + separator).count
  }
  rows.append(Row(id: p.id, mode: p.mode, slots: set.slots.map { Slot(text: $0.text, kind: String(describing: $0.kind), automatic: $0.isAutocorrection) }, automatic: set.autocorrection,
    candidates: ranked.prefix(32).map { Ranked(text: $0.text, completion: $0.isCompletion, cost: $0.cost, score: $0.score) }, exact: exact, shared: shared, prefixCount: result.prefixes.count,
    targetVisible: visible, targetTop8: ranked.prefix(8).contains { $0.text == p.target }, saved: visible && p.action == "select" ? max(0, p.target.count - p.prefix.count - 1) : 0,
    fired: fired, text: document.text, caret: document.offset, fullTextPass: expected.map { $0 == document.text && expectedCaret == document.offset }, personalCount: personal.totalCount))
}
let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
try encoder.encode(rows).write(to: URL(fileURLWithPath: CommandLine.arguments[3]))
