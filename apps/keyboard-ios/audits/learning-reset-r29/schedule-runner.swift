import Foundation

struct Schedule: Decodable { let id: String; let description: String; let actions: [Action] }
struct Action: Decodable {
  let op: String
  let instance: String
  let memory: Bool?
  let word: String?
  let after: String?
  let pinned: Bool?
  let words: [String]?
  let field: String?
  let expected: Expected?
}
enum Expected: Decodable {
  case boolean(Bool), integer(Int), strings([String])
  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let v = try? container.decode(Bool.self) { self = .boolean(v) }
    else if let v = try? container.decode(Int.self) { self = .integer(v) }
    else { self = .strings(try container.decode([String].self)) }
  }
  var value: Any {
    switch self { case .boolean(let v): v; case .integer(let v): v; case .strings(let v): v }
  }
}

@main
struct ScheduleRunner {
  static func main() throws {
    let schedules = try JSONDecoder().decode([Schedule].self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
    var results: [[String: Any]] = []
    for schedule in schedules {
      let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pk-r29-schedule-\(UUID().uuidString)")
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: directory) }
      let url = directory.appendingPathComponent("PersonalDictionary.json")
      var instances: [String: PersonalDictionary] = [:]
      var checks: [[String: Any]] = []
      for (index, action) in schedule.actions.enumerated() {
        if action.op == "new" {
          instances[action.instance] = PersonalDictionary(url: action.memory == true ? nil : url)
          continue
        }
        let personal = instances[action.instance]!
        switch action.op {
        case "learn": personal.learn(action.word!, after: action.after, pinned: action.pinned ?? false)
        case "pin": personal.pin(action.word!)
        case "forget": personal.forget(action.word!)
        case "transient": personal.setTransientWords(action.words!)
        case "save": personal.save()
        case "background": personal.saveInBackground()
        case "clear": personal.clear()
        case "reload":
          let changed = personal.reloadIfChangedOnDisk()
          if let expected = action.expected { checks.append(check(index, "reload", changed, expected.value)) }
        case "check":
          let actual: Any
          switch action.field! {
          case "count": actual = personal.count(of: action.word!)
          case "known": actual = personal.isKnown(action.word!)
          case "blocked": actual = personal.isBlocked(action.word!)
          case "pair": actual = personal.pairCount(action.after!, action.word!)
          case "history": actual = personal.historyCount(action.after!)
          case "total": actual = personal.totalCount
          case "dirty": actual = personal.hasUnsavedChanges
          case "knownWords": actual = personal.knownWords.sorted()
          case "files": actual = try FileManager.default.contentsOfDirectory(atPath: directory.path).sorted()
          default: fatalError("schema validator must reject unknown field")
          }
          checks.append(check(index, action.field!, actual, action.expected!.value))
        default: fatalError("schema validator must reject unknown op")
        }
      }
      // Drain background writes before removing the test directory.
      for personal in instances.values { _ = personal.hasUnsavedChanges }
      results.append(["id": schedule.id, "available": true, "checks": checks, "pass": checks.allSatisfy { $0["pass"] as! Bool }])
    }
    let data = try JSONSerialization.data(withJSONObject: results, options: [.prettyPrinted, .sortedKeys])
    print(String(data: data, encoding: .utf8)!)
  }

  static func check(_ index: Int, _ field: String, _ actual: Any, _ expected: Any) -> [String: Any] {
    let matches = (actual as AnyObject).isEqual(expected)
    return ["action": index, "field": field, "actual": actual, "expected": expected, "pass": matches]
  }
}
