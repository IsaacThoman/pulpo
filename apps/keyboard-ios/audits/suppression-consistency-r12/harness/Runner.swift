import Foundation

struct AuditCase: Codable { let id: String; let language: String; let context: String; let target: String; let kind: String }
final class AuditDocument: TextDocument {
 var text: String
 init(_ text: String) { self.text = text }
 var documentContextBeforeInput: String? { text }
 var documentContextAfterInput: String? { "" }
 var selectedText: String? { nil }
 var hasText: Bool { !text.isEmpty }
 func insertText(_ value: String) { text += value }
 func deleteBackward() { if !text.isEmpty { text.removeLast() } }
}
func milliseconds(_ start: UInt64) -> Double { Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000 }
func path(_ word: String, _ profile: Int) -> [[Double]] {
 var centers: [KeyPoint] = []; var previous: UInt8 = 0
 for byte in TextNormalizer.key(word).utf8 where byte != previous {
  if let point = LetterGeometry.qwerty.center(byte) { centers.append(point) }; previous = byte
 }
 guard centers.count > 1 else { return centers.map { [$0.x,$0.y] } }
 var dense: [KeyPoint] = []
 for i in 1..<centers.count {
  let a = centers[i-1], b = centers[i]
  let steps = max(2, Int(ceil(a.distance(to:b) / 0.08)))
  for step in 0..<steps { let t = Double(step)/Double(steps); dense.append(KeyPoint(x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t)) }
 }
 dense.append(centers.last!)
 return dense.indices.map { i in
  if profile == 1 { return [dense[i].x + 0.12 * sin(Double(i)*1.7),dense[i].y + 0.10 * cos(Double(i)*1.3)] }
  if profile == 2 {
   let window = dense[max(0,i-2)...min(dense.count-1,i+2)]
   return [window.reduce(0){$0+$1.x}/Double(window.count)+0.18,window.reduce(0){$0+$1.y}/Double(window.count)-0.10]
  }
  return [dense[i].x,dense[i].y]
 }
}
@main struct Main {
 static func main() throws {
  let args = CommandLine.arguments
  let cases = try JSONDecoder().decode([AuditCase].self,from:Data(contentsOf:URL(fileURLWithPath:args[2])))
  if args[1] == "freeze" {
   var paths: [String:[[[Double]]]] = [:]
   for item in cases where item.kind != "literal" { paths[item.target] = (0..<3).map { path(item.target,$0) } }
   try JSONSerialization.data(withJSONObject:paths,options:[.sortedKeys]).write(to:URL(fileURLWithPath:args[3])); return
  }
  let dataDirectory = URL(fileURLWithPath:args[3])
  let frozen = try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[4]))) as! [String:[[[Double]]]]
  var lexicons: [String:Lexicon] = [:]; var results: [[String:Any]] = []
  let selected = args[1] == "cold" ? [cases.first { $0.language == args[6] && $0.kind == "conflict" }!] : cases
  for item in selected {
   for profile in item.kind == "literal" || args[1] == "cold" ? [0] : [0,1,2] {
    let start = DispatchTime.now().uptimeNanoseconds
    if lexicons[item.language] == nil { lexicons[item.language] = try Lexicon(url:dataDirectory.appendingPathComponent(item.language+".pkdict")) }
    let lexicon = lexicons[item.language]!
    let personal = PersonalDictionary(url:nil)
    if ["learnedConflict","personal","privacy","secure"].contains(item.kind) { personal.learn(item.target,after:nil,pinned:true) }
    let initialCount = personal.totalCount
    let model = LanguageModel(lexicon:lexicon,personal:personal)
    let glide = GlideDecoder(model:model)
    let suggester = Suggester(model:model,corrector:SpellCorrector(lexicon:lexicon))
    var settings = KeyboardSettings(); settings.autoCapitalization = false
    if item.kind == "privacy" { settings.learnWords = false }
    let document = AuditDocument(item.context)
    let engine = KeyboardEngine(document:document,suggester:suggester,glide:glide,settings:settings)
    var traits = InputTraits(); traits.capitalization = .none; traits.isSecure = item.kind == "secure"
    engine.traits = traits
    let constructionMs = milliseconds(start)
    var decoder: [GlideCandidate] = []; var engineCandidates: [GlideCandidate] = []
    let decodeMs: Double; let engineMs: Double
    if item.kind == "literal" {
     decodeMs = 0
     engine.documentDidChange()
     let time = DispatchTime.now().uptimeNanoseconds
     for ch in item.target { engine.insertCharacter(String(ch),tap:nil) }
     engineMs = milliseconds(time)
    } else {
     let points = frozen[item.target]![profile].map { KeyPoint(x:$0[0],y:$0[1]) }
     let words = item.context.split(separator:" ").map(String.init)
     let context = model.context(previousWord:words.last,sentenceStart:false,precedingWord:words.count > 1 ? words[words.count-2] : nil)
     let time = DispatchTime.now().uptimeNanoseconds
     decoder = glide.decode(points,context:context)
     decodeMs = milliseconds(time)
     engine.documentDidChange()
     let engineTime = DispatchTime.now().uptimeNanoseconds
     engineCandidates = engine.insertGlide(points)
     engineMs = milliseconds(engineTime)
    }
    let raw = document.text; let phantom = engine.phantomSpace
    let slots = engine.suggestions.slots.map { ["text":$0.text,"kind":String(describing:$0.kind)] }
    engine.insertSpace(); engine.save()
    let expectedRaw = item.context+item.target
    let expectedFinal = expectedRaw+" "
    results.append(["id":item.id,"language":item.language,"target":item.target,"kind":item.kind,"profile":profile,
     "decoder":decoder.map{["text":$0.text,"score":$0.score]},"engineCandidates":engineCandidates.map{["text":$0.text,"score":$0.score]},
     "rawDocument":raw,"phantomSpace":phantom,"finalDocument":document.text,"expectedRaw":expectedRaw,"expectedFinal":expectedFinal,
     "slots":slots,"candidateTarget":decoder.contains{$0.text == item.target},"slotTarget":slots.contains{$0["text"] == item.target},
     "exactDocument":raw == expectedRaw && document.text == expectedFinal && (item.kind == "literal" || phantom),
     "initialPersonalCount":initialCount,"finalPersonalCount":personal.totalCount,"constructionMs":constructionMs,"decodeMs":decodeMs,"engineMs":engineMs,
     "literalNormalized":TextNormalizer.key(item.target) == item.target,
     "targetEntries":lexicon.words(forKey:TextNormalizer.key(item.target)).map{["text":lexicon.display($0),"flags":Int(lexicon.flags($0).rawValue)]}])
   }
  }
  try JSONSerialization.data(withJSONObject:results,options:[.sortedKeys,.prettyPrinted]).write(to:URL(fileURLWithPath:args[5]))
 }
}
