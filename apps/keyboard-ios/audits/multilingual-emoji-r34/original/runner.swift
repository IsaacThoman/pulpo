import Foundation

private struct ProtocolError: Error, CustomStringConvertible {
  let description: String
  init(_ message: String) { description = message }
}
private func check(_ test: Bool, _ message: String) throws {
  if !test { throw ProtocolError(message) }
}

// Parse JSON integers lexically: JSONDecoder alone also accepts 1.0 as Int.
// This parser also rejects duplicate object keys, invalid constants and trailing data.
private indirect enum JSONValue {
  case object([String: JSONValue]), array([JSONValue]), string(String), integer(Int), boolean(Bool), null
  func object() throws -> [String: JSONValue] {
    guard case .object(let x) = self else { throw ProtocolError("object required") }; return x
  }
  func array() throws -> [JSONValue] {
    guard case .array(let x) = self else { throw ProtocolError("array required") }; return x
  }
  func string(_ nonempty: Bool = true) throws -> String {
    guard case .string(let x) = self, !nonempty || !x.isEmpty else { throw ProtocolError("string required") }; return x
  }
  func integer(_ low: Int, _ high: Int) throws -> Int {
    guard case .integer(let x) = self, x >= low, x <= high else { throw ProtocolError("bounded integer required (not bool/float)") }; return x
  }
  func boolean() throws -> Bool {
    guard case .boolean(let x) = self else { throw ProtocolError("Boolean required") }; return x
  }
}
private struct Parser {
  var bytes: [UInt8]
  var offset = 0
  mutating func whitespace() { while offset < bytes.count && [9, 10, 13, 32].contains(bytes[offset]) { offset += 1 } }
  mutating func take(_ byte: UInt8) throws {
    whitespace(); try check(offset < bytes.count && bytes[offset] == byte, "invalid JSON delimiter"); offset += 1
  }
  mutating func text() throws -> String {
    whitespace(); let start = offset
    try check(offset < bytes.count && bytes[offset] == 34, "JSON string required"); offset += 1
    while offset < bytes.count {
      let c = bytes[offset]; offset += 1
      if c == 92 { try check(offset < bytes.count, "invalid escape"); offset += 1 }
      else if c == 34 {
        let data = Data(bytes[start..<offset])
        guard let text = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) as? String else { throw ProtocolError("invalid string") }
        return text
      }
    }
    throw ProtocolError("unterminated string")
  }
  mutating func value(_ depth: Int = 0) throws -> JSONValue {
    try check(depth < 256, "JSON nesting too deep")
    whitespace(); try check(offset < bytes.count, "missing JSON value")
    switch bytes[offset] {
    case 123:
      offset += 1; whitespace(); var object: [String: JSONValue] = [:]
      if offset < bytes.count && bytes[offset] == 125 { offset += 1; return .object(object) }
      while true {
        let key = try text(); try check(object[key] == nil, "duplicate JSON object key")
        try take(58); object[key] = try value(depth + 1); whitespace()
        try check(offset < bytes.count, "unterminated object")
        if bytes[offset] == 125 { offset += 1; return .object(object) }
        try take(44)
      }
    case 91:
      offset += 1; whitespace(); var array: [JSONValue] = []
      if offset < bytes.count && bytes[offset] == 93 { offset += 1; return .array(array) }
      while true {
        array.append(try value(depth + 1)); whitespace(); try check(offset < bytes.count, "unterminated array")
        if bytes[offset] == 93 { offset += 1; return .array(array) }
        try take(44)
      }
    case 34: return .string(try text())
    case 116, 102, 110:
      for (literal, result) in [("true", JSONValue.boolean(true)), ("false", .boolean(false)), ("null", .null)] {
        let token = Array(literal.utf8)
        if bytes.dropFirst(offset).starts(with: token) { offset += token.count; return result }
      }
      throw ProtocolError("invalid JSON literal")
    default:
      let start = offset
      while offset < bytes.count && ![9, 10, 13, 32, 44, 93, 125].contains(bytes[offset]) { offset += 1 }
      let token = String(decoding: bytes[start..<offset], as: UTF8.self)
      let digits = token.hasPrefix("-") ? String(token.dropFirst()) : token
      try check(!digits.isEmpty && digits.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }, "JSON integer required; floats/exponents rejected")
      try check(digits.count == 1 || !digits.hasPrefix("0"), "invalid leading zero")
      guard let number = Int(token) else { throw ProtocolError("integer overflow") }
      return .integer(number)
    }
  }
  mutating func parse() throws -> JSONValue {
    let root = try value(); whitespace(); try check(offset == bytes.count, "trailing JSON data"); return root
  }
}
private func fields(_ object: [String: JSONValue], _ required: [String], _ allowed: [String]) throws {
  try check(Set(required).isSubset(of: Set(object.keys)), "missing required field")
  try check(Set(object.keys).isSubset(of: Set(allowed)), "unknown field")
}
private func strings(_ value: JSONValue, _ nonempty: Bool = false) throws -> [String] {
  let result = try value.array().map { try $0.string() }; try check(!nonempty || !result.isEmpty, "nonempty array required"); return result
}
private func validate(_ root: JSONValue) throws {
  let suite = try root.object()
  try fields(suite, ["version", "families", "cases"], ["version", "families", "cases"])
  _ = try suite["version"]!.integer(2, 2)
  let families = try strings(suite["families"]!, true)
  try check(Set(families).count == families.count, "duplicate family")
  let cases = try suite["cases"]!.array()
  var ids: Set<String> = [], references: [String: String] = [:]
  let required = ["id", "family", "action", "query", "acceptable", "maxRank", "role"]
  let common = ["stratum", "forbidden", "equivalentTo", "expectEmpty"]
  let parameters = ["search": ["limit", "preferred"], "wrapper": ["limit", "recents", "tones"], "fixture": ["entries", "spanishAliases", "limit", "preferred"]]
  for raw in cases {
    let row = try raw.object()
    guard let actionRaw = row["action"] else { throw ProtocolError("missing action") }
    let action = try actionRaw.string()
    guard let extra = parameters[action] else { throw ProtocolError("unknown action") }
    try fields(row, required, required + common + extra)
    let id = try row["id"]!.string(); try check(ids.insert(id).inserted, "duplicate id")
    let family = try row["family"]!.string(); try check(families.contains(family), "unknown family")
    _ = try row["query"]!.string(false)
    let role = try row["role"]!.string(); try check(["useful", "control"].contains(role), "invalid role")
    let stratum = try row["stratum"]?.string()
    try check(stratum == nil || ["en", "es", "mixed", "control"].contains(stratum!), "invalid stratum")
    try check(role != "useful" || ["en", "es", "mixed"].contains(stratum ?? ""), "useful requires stratum")
    _ = try row["maxRank"]!.integer(1, 60)
    let empty = try row["expectEmpty"]?.boolean() ?? false
    let acceptable = try strings(row["acceptable"]!)
    try check(!acceptable.isEmpty || (empty && role == "control"), "empty acceptable requires expectEmpty control")
    for key in ["forbidden", "recents"] { if let value = row[key] { _ = try strings(value) } }
    if let rawRef = row["equivalentTo"] {
      let ref = try rawRef.string(); try check(ref != id, "self reference"); references[id] = ref
    }
    if let value = row["limit"] { _ = try value.integer(-1_000_000, 1_000_000) }
    for key in ["preferred", "tones"] {
      if let rawMap = row[key] {
        for (glyph, value) in try rawMap.object() {
          try check(!glyph.isEmpty, "empty map key")
          if key == "preferred" { _ = try value.integer(-1_000_000, 1_000_000) }
          else { _ = try value.string() }
        }
      }
    }
    if action == "fixture" {
      guard let rawEntries = row["entries"] else { throw ProtocolError("fixture entries required") }
      let entries = try rawEntries.array(); try check(!entries.isEmpty, "empty entries")
      var bases: Set<String> = []
      for rawEntry in entries {
        let entry = try rawEntry.object()
        try fields(entry, ["emoji", "name", "keywords"], ["emoji", "name", "keywords", "tones"])
        let emoji = try entry["emoji"]!.string(); try check(bases.insert(emoji).inserted, "duplicate fixture base")
        _ = try entry["name"]!.string(); _ = try strings(entry["keywords"]!)
        if let tones = entry["tones"] { _ = try strings(tones) }
      }
      if let rawAliases = row["spanishAliases"] {
        let aliases = try rawAliases.array(); try check(!aliases.isEmpty, "empty aliases")
        var seen: Set<String> = []
        for rawAlias in aliases {
          let alias = try rawAlias.object(); try fields(alias, ["emoji", "name"], ["emoji", "name"])
          let emoji = try alias["emoji"]!.string(); try check(seen.insert(emoji).inserted, "duplicate alias")
          _ = try alias["name"]!.string()
        }
      }
    }
  }
  try check(Set(references.values).isSubset(of: ids), "unknown equivalence reference")
  var complete: Set<String> = []
  for id in references.keys {
    var path: Set<String> = [], cursor = id
    while let next = references[cursor], !complete.contains(cursor) {
      try check(path.insert(cursor).inserted, "cyclic equivalence reference"); cursor = next
    }
    complete.formUnion(path)
  }
}
private struct Entry: Decodable {
  let emoji: String, name: String
  let keywords: [String]
  let tones: [String]?
}
private struct Alias: Decodable { let emoji: String, name: String }
private struct Case: Decodable {
  let id: String, action: String, query: String
  let limit: Int?, preferred: [String: Int]?, recents: [String]?, tones: [String: String]?
  let entries: [Entry]?, spanishAliases: [Alias]?
}
private struct Suite: Decodable { let cases: [Case] }
private struct Row: Encodable {
  let id: String, values: [String], baseValues: [String], query: String
}
@main struct Runner {
  static func run() throws {
    let args = CommandLine.arguments
    try check(args.count == 4, "usage: runner CATALOG INPUT OUTPUT")
    // Validate the entire suite BEFORE catalog loading/index construction or row execution.
    let data = try Data(contentsOf: URL(fileURLWithPath: args[2]))
    var parser = Parser(bytes: Array(data)); try validate(parser.parse())
    let suite = try JSONDecoder().decode(Suite.self, from: data)
    // A real resource is mandatory even for a fixture-only suite.
    let catalog = try EmojiCatalog.load(url: URL(fileURLWithPath: args[1]))
    let shipped = EmojiSuggester(catalog: catalog)
    var rows: [Row] = []
    for item in suite.cases {
      if item.action == "wrapper" {
        let domain = "pulpo.r34.protocol.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: domain) else { throw ProtocolError("isolated defaults unavailable") }
        defaults.removePersistentDomain(forName: domain)
        defer { defaults.removePersistentDomain(forName: domain) }
        defaults.set(item.recents ?? [], forKey: "emojiRecents")
        defaults.set(item.tones ?? [:], forKey: "emojiTones")
        let history = EmojiHistory(defaults: defaults), query = EmojiSearchQuery(item.query)
        let found = EmojiSearch.results(for: query, suggester: shipped, history: history, limit: item.limit ?? 48)
        rows.append(Row(id: item.id, values: found.map(\.value), baseValues: found.map { $0.base.value }, query: query.text))
      } else {
        let suggester: EmojiSuggester
        if item.action == "fixture" {
          let aliases = Dictionary(uniqueKeysWithValues: (item.spanishAliases ?? []).map { ($0.emoji, $0.name) })
          let entries: [[String: Any]] = item.entries!.map { entry in
            var object: [String: Any] = ["e": entry.emoji, "n": entry.name, "k": entry.keywords, "v": 1]
            if let tones = entry.tones { object["t"] = tones }
            if let spanish = aliases[entry.emoji] { object["s"] = spanish }
            return object
          }
          let fixture: [String: Any] = ["version": "fixture", "categories": [["id": "fixture", "name": "Fixture", "emoji": entries]]]
          let decoded = try JSONDecoder().decode(EmojiCatalog.self, from: JSONSerialization.data(withJSONObject: fixture))
          suggester = EmojiSuggester(catalog: decoded)
        } else { suggester = shipped }
        let values = suggester.search(item.query, limit: item.limit ?? 48, preferring: item.preferred ?? [:]).map(\.value)
        rows.append(Row(id: item.id, values: values, baseValues: values, query: item.query))
      }
    }
    let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
    try encoder.encode(rows).write(to: URL(fileURLWithPath: args[3]), options: .atomic)
  }
  static func main() {
    do { try run() }
    catch { FileHandle.standardError.write(Data("runner failed: \(error)\n".utf8)); exit(1) }
  }
}
