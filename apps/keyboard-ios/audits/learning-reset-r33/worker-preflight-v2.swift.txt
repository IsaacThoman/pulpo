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
    reply(true)
    while let line = readLine() {
      do {
        let action = try JSONSerialization.jsonObject(with: Data(line.utf8)) as! [String: Any]
        let op = action["op"] as! String
        let word = action["word"] as? String ?? ""
        let store = action["store"] as? String ?? "both"
        switch op {
        case "learn": reply(personal.learn(word, after: action["after"] as? String, pinned: action["pinned"] as? Bool ?? false))
        case "pin": reply(personal.pin(word))
        case "forget": reply(personal.forget(word))
        case "transient": personal.setTransientWords(action["words"] as! [String]); reply(true)
        case "touch":
          let dx = action["dx"] as! Double, dy = action["dy"] as! Double
          let geometry = LetterGeometry.qwerty
          let typed = TypedWord(text: word, taps: word.utf8.map { byte in
            geometry.center(byte).map { KeyPoint(x: $0.x + dx, y: $0.y + dy) }
          })
          var result = true
          for _ in 0..<(action["repeat"] as! Int) { result = touch.learn(typed, intended: word, geometry: geometry) && result }
          reply(result)
        case "save":
          let a = store == "touch" ? true : personal.save()
          let b = store == "dictionary" ? true : touch.save()
          reply(a && b)
        case "background":
          if store != "touch" { personal.saveInBackground() }
          if store != "dictionary" { touch.save(inBackground: true) }
          reply(true)
        case "reload":
          if store != "touch" { personal.reloadIfChangedOnDisk() }
          if store != "dictionary" { touch.reloadIfChangedOnDisk() }
          reply(true)
        case "clear":
          if store == "dictionary" { reply(personal.clear()) }
          else if store == "touch" { reply(touch.reset()) }
          else if memory { _ = personal.clear(); _ = touch.reset(); reply(true) }
          else { reply(LearnedDataPersistence.clear(dictionaryURL: dictionaryURL, touchURL: touchURL)) }
        case "arm": setenv("R33_GATE", action["gate"] as! String, 1); reply(true)
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
