import Foundation

/// Lossless representation of the extensible response and settings contracts.
/// Unknown tool output remains readable instead of breaking an entire chat.
indirect enum JSON: Codable, Equatable, Sendable {
    case object([String: JSON]), array([JSON]), string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSON].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSON].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    subscript(_ key: String) -> JSON {
        get { object[key] ?? .null }
        set { var v = object; v[key] = newValue; self = .object(v) }
    }
    var object: [String: JSON] { if case .object(let v) = self { return v }; return [:] }
    var array: [JSON] { if case .array(let v) = self { return v }; return [] }
    var string: String { if case .string(let v) = self { return v }; return "" }
    var optionalString: String? { if case .string(let v) = self { return v }; return nil }
    var bool: Bool { self == .bool(true) }
    var int: Int { if case .number(let v) = self { return Int(v) }; return 0 }
    var id: String { self["id"].string }
    var pretty: String { (try? String(data: JSONEncoder.pretty.encode(self), encoding: .utf8)) ?? "" }
    static func parse(_ data: Data) throws -> JSON { try JSONDecoder().decode(JSON.self, from: data) }
}
extension JSON: ExpressibleByStringLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral, ExpressibleByNilLiteral {
    init(stringLiteral value: String) { self = .string(value) }
    init(booleanLiteral value: Bool) { self = .bool(value) }
    init(integerLiteral value: Int) { self = .number(Double(value)) }
    init(arrayLiteral elements: JSON...) { self = .array(elements) }
    init(dictionaryLiteral elements: (String, JSON)...) { self = .object(Dictionary(uniqueKeysWithValues: elements)) }
    init(nilLiteral: ()) { self = .null }
}
private extension JSONEncoder {
    static var pretty: JSONEncoder { let e = JSONEncoder(); e.outputFormatting = [.prettyPrinted, .sortedKeys]; return e }
}
