import Foundation

/// A small on-device log in the App Group, for checking behavior on a real phone
/// (`xcrun devicectl device copy from … --domain-type appGroupDataContainer`).
/// Records counts, timings and app identifiers only, never typed text.
public enum Diagnostics {
  static let limit = 300

  public static func record(_ source: String, _ event: String, _ fields: [String: Any] = [:]) {
    guard let container = AppGroup.containerURL else { return }
    // Device tools only export Library, Documents and tmp from app containers.
    let directory = container.appendingPathComponent("Library/Diagnostics", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let url = directory.appendingPathComponent("events.jsonl")
    let legacy = container.appendingPathComponent("Diagnostics/events.jsonl")
    if !FileManager.default.fileExists(atPath: url.path), FileManager.default.fileExists(atPath: legacy.path) {
      try? FileManager.default.moveItem(at: legacy, to: url)
    }
    var entry = fields
    entry["at"] = ISO8601DateFormatter().string(from: Date())
    entry["source"] = source
    entry["event"] = event
    guard JSONSerialization.isValidJSONObject(entry), let line = try? JSONSerialization.data(withJSONObject: entry, options: [.sortedKeys]) else { return }
    var lines = (try? String(contentsOf: url, encoding: .utf8))?.split(separator: "\n").map(String.init) ?? []
    lines.append(String(decoding: line, as: UTF8.self))
    if lines.count > limit { lines.removeFirst(lines.count - limit) }
    try? (lines.joined(separator: "\n") + "\n").write(to: url, atomically: true, encoding: .utf8)
  }
}
