import Foundation

private final class BenchDocument: TextDocument {
  var text = ""
  var documentContextBeforeInput: String? { String(text.suffix(256)) }
  var documentContextAfterInput: String? { "" }
  var selectedText: String? { nil }
  var hasText: Bool { !text.isEmpty }
  func insertText(_ value: String) { text += value }
  func deleteBackward() { if !text.isEmpty { text.removeLast() } }
}
@main struct InputLatency {
  static func main() throws {
    let data = URL(fileURLWithPath: CommandLine.arguments[1])
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("r33-input-latency-\(UUID())")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    var results: [[String: Any]] = []
    var previous: LanguageStack?
    let texts = [
      "the quiet morning brings a gentle breeze through the garden and across the river ",
      "la mañana tranquila trae una brisa suave por el jardín y junto al camino ",
      "the garden tiene flores nuevas and the afternoon está llena de luz para todos "
    ]
    func time(_ body: () -> Void) -> Double { let start=DispatchTime.now().uptimeNanoseconds; body(); return Double(DispatchTime.now().uptimeNanoseconds-start)/1e6 }
    func stats(_ values: [Double]) -> [String: Double] { let s=values.sorted();return ["p50":s[s.count/2],"p95":s[s.count*95/100],"max":s.last!] }
    for (index, language) in KeyboardLanguage.allCases.enumerated() {
      let stack: LanguageStack
      if let previous { stack = try LanguageStack(dictionaryURL: data.appendingPathComponent(language.rawValue+".pkdict"), sharing: previous) }
      else {
        stack = try LanguageStack(dictionaryURL: data.appendingPathComponent(language.rawValue+".pkdict"), personalURL: root.appendingPathComponent("PersonalDictionary.json"), touchURL: root.appendingPathComponent("TouchModel.json"))
        for i in 0..<5000 { for j in 0..<4 { stack.personal.learn("r33input\(i)", after: "r33inputHistory\(j)") }; if i % 50 == 49 { stack.personal.save() } }
      }
      previous = stack
      var settings=KeyboardSettings(); settings.language=language
      let document=BenchDocument()
      let engine=KeyboardEngine(document: document,suggester: stack.suggester,glide: stack.glide,settings: settings)
      engine.documentDidChange()
      var letters: [Double]=[], boundaries: [Double]=[], firstLetters: [Double]=[]
      var first=true
      for _ in 0..<4 {
        for character in texts[index] {
          if character == " " { boundaries.append(time { engine.insertSpace() }); first=true }
          else {
            let value=String(character), tap=value.utf8.count==1 ? LetterGeometry.qwerty.center(value.utf8.first!) : nil
            let elapsed=time { engine.insertCharacter(value,tap:tap) }
            if first { firstLetters.append(elapsed) } else { letters.append(elapsed) }
            first=false
          }
        }
      }
      let enqueue=time { engine.save(inBackground: true) }
      #if BASELINE
      stack.personal.save(); stack.touch.save()
      #else
      let deadline=ContinuousClock.now + .seconds(5)
      while !stack.personal.save() {
        precondition(stack.personal.persistenceResult == .busy && ContinuousClock.now < deadline)
        sched_yield()
      }
      #endif
      results.append(["mode":language.rawValue,"dictionaryFile":language.rawValue+".pkdict","steadyLetterMilliseconds":stats(letters),"firstLetterMayAcceptPriorWordMilliseconds":stats(firstLetters),"spaceMilliseconds":stats(boundaries),"backgroundEnqueueMilliseconds":enqueue,"letterSamples":letters.count,"wordBoundarySamples":boundaries.count])
    }
    print(String(data:try JSONSerialization.data(withJSONObject:["actualLanguageStacks":3,"sharedLearningAuthority":true,"results":results],options:[.prettyPrinted,.sortedKeys]),encoding:.utf8)!)
  }
}
