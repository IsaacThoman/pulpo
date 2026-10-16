import Foundation
#if canImport(Darwin)
import Darwin
#endif

@main struct Worker {
  static func main() {
    let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
    let memory = CommandLine.arguments.contains("--memory")
    let dictionaryURL = memory ? nil : directory.appendingPathComponent("PersonalDictionary.json")
    let touchURL = memory ? nil : directory.appendingPathComponent("TouchModel.json")
    let personal = PersonalDictionary(url: dictionaryURL)
    let touch = TouchModel(url: touchURL)
    func reply(_ result: Any) {
      let data = try! JSONSerialization.data(withJSONObject: ["value": result], options: [.sortedKeys, .fragmentsAllowed])
      print(String(decoding: data, as: UTF8.self)); fflush(stdout)
    }
    func accepted(_ value: Bool, _ result: LearningPersistenceResult) -> [String: Any] {
      ["accepted": value, "result": result.rawValue]
    }
    reply(["dictionary": personal.persistenceResult.rawValue, "touch": touch.persistenceResult.rawValue])
    while let line = readLine() {
      do {
        let action = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
        let op = action["op"] as! String
        let word = action["word"] as? String ?? ""
        let store = action["store"] as? String ?? "both"
        switch op {
        case "learn":
          let value=personal.learn(word, after: action["after"] as? String, pinned: action["pinned"] as? Bool ?? false)
          reply(accepted(value, personal.persistenceResult))
        case "pin":
          let value=personal.pin(word); reply(accepted(value, personal.persistenceResult))
        case "forget":
          let value=personal.forget(word); reply(accepted(value, personal.persistenceResult))
        case "transient": personal.setTransientWords(action["words"] as! [String]); reply(["accepted": true])
        case "touch":
          let dx=action["dx"] as! Double, dy=action["dy"] as! Double
          let geometry=LetterGeometry.qwerty
          let typed=TypedWord(text: word, taps: word.utf8.map { byte in
            geometry.center(byte).map { KeyPoint(x: $0.x + dx, y: $0.y + dy) }
          })
          let value=touch.learn(typed, intended: word, geometry: geometry)
          reply(accepted(value, touch.persistenceResult))
        case "save":
          var result: [String: Any]=[:]; var complete=true
          if store != "touch" { complete=personal.save() && complete; result["dictionary"]=personal.persistenceResult.rawValue }
          if store != "dictionary" { complete=touch.save() && complete; result["touch"]=touch.persistenceResult.rawValue }
          result["completed"]=complete; reply(result)
        case "background":
          if store != "touch" { personal.saveInBackground() }
          if store != "dictionary" { _=touch.save(inBackground: true) }
          reply(["enqueued": true])
        case "reload":
          var result: [String: Any]=[:]
          if store != "touch" {
            let changed=personal.reloadIfChangedOnDisk()
            result["dictionary"]=["changed": changed, "result": personal.persistenceResult.rawValue]
          }
          if store != "dictionary" {
            let changed=touch.reloadIfChangedOnDisk()
            result["touch"]=["changed": changed, "result": touch.persistenceResult.rawValue]
          }
          reply(result)
        case "clear":
          var value=false; var result=LearningPersistenceResult.invalid
          if store == "dictionary" { value=personal.clear(); result=personal.persistenceResult }
          else if store == "touch" { value=touch.reset(); result=touch.persistenceResult }
          else if memory { value=personal.clear() && touch.reset(); result = .ok }
          else { result=LearnedDataPersistence.clear(dictionaryURL: dictionaryURL, touchURL: touchURL); value=result == .ok }
          reply(["completed": value, "result": result.rawValue])
        case "arm": setenv("R33_GATE", action["gate"] as! String, 1); reply(["armed": true])
        case "check":
          switch action["field"] as! String {
          case "count": reply(personal.count(of: word))
          case "known": reply(personal.isKnown(word))
          case "blocked": reply(personal.isBlocked(word))
          case "pair": reply(personal.pairCount(action["after"] as! String, word))
          case "history": reply(personal.historyCount(action["after"] as! String))
          case "total": reply(personal.totalCount)
          case "dirty": reply(personal.hasUnsavedChanges)
          case "touchWeight": reply(touch.weight)
          case "offsetX": reply(touch.offset(word.utf8.first!).x)
          case "offsetY": reply(touch.offset(word.utf8.first!).y)
          default: fatalError("unsupported field")
          }
        default: fatalError("unsupported operation")
        }
      } catch { reply(["error": String(describing: error)]) }
    }
  }
}
