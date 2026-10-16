import Foundation

@main
struct Worker {
  static func main() throws {
    let url = URL(fileURLWithPath: CommandLine.arguments[1])
    let dictionary = PersonalDictionary(url: url)
    while let line = readLine() {
      let parts = line.split(separator: " ", maxSplits: 1).map(String.init)
      switch parts.first {
      case "pin": dictionary.pin(parts[1])
      case "save": dictionary.save()
      case "background": dictionary.saveInBackground()
      case "clear": dictionary.clear()
      case "arm": setenv("R29_ARMED", "1", 1)
      case "reload":
        let changed = dictionary.reloadIfChangedOnDisk()
        print(String(data: try JSONSerialization.data(withJSONObject: ["changed": changed, "known": dictionary.knownWords.sorted(), "total": dictionary.totalCount], options: [.sortedKeys]), encoding: .utf8)!)
        fflush(stdout)
        continue
      case "state":
        // This public query drains this process's prior file work, then a fresh
        // public instance reads disk. It does not synchronize another process.
        _ = dictionary.hasUnsavedChanges
        let disk = PersonalDictionary(url: url)
        print(String(data: try JSONSerialization.data(withJSONObject: ["known": disk.knownWords.sorted(), "total": disk.totalCount], options: [.sortedKeys]), encoding: .utf8)!)
        fflush(stdout)
        continue
      case "quit": return
      default: fatalError("unknown command")
      }
      print("ok")
      fflush(stdout)
    }
  }
}
