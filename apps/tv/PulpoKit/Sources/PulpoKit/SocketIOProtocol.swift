import Foundation

/// The Engine.IO v4 / Socket.IO v5 text framing used by the Pulpo server
/// (`socket.io@4`). Only what a websocket-only client needs is implemented:
/// no polling transport, binary attachments, or namespaces other than `/`.
public enum EnginePacket: Equatable, Sendable {
    public struct Handshake: Decodable, Equatable, Sendable {
        public let sid: String
        public let pingInterval: Int
        public let pingTimeout: Int
    }

    case open(Handshake)
    case close
    case ping
    case pong
    case message(SocketPacket)
    case upgrade
    case noop

    public init?(text: String) {
        guard let kind = text.first else { return nil }
        let body = String(text.dropFirst())
        switch kind {
        case "0":
            guard let handshake = try? JSONDecoder().decode(Handshake.self, from: Data(body.utf8)) else { return nil }
            self = .open(handshake)
        case "1": self = .close
        case "2": self = .ping
        case "3": self = .pong
        case "4":
            guard let packet = SocketPacket(text: body) else { return nil }
            self = .message(packet)
        case "5": self = .upgrade
        case "6": self = .noop
        default: return nil
        }
    }

    public var text: String {
        switch self {
        case .open: "0"
        case .close: "1"
        case .ping: "2"
        case .pong: "3"
        case .message(let packet): "4" + packet.text
        case .upgrade: "5"
        case .noop: "6"
        }
    }
}

public struct SocketPacket: Equatable, Sendable {
    public enum Kind: Int, Sendable {
        case connect = 0, disconnect, event, ack, connectError, binaryEvent, binaryAck
    }

    public let kind: Kind
    public let namespace: String
    public let ackId: Int?
    public let payload: JSONValue?

    public init(kind: Kind, namespace: String = "/", ackId: Int? = nil, payload: JSONValue? = nil) {
        self.kind = kind
        self.namespace = namespace
        self.ackId = ackId
        self.payload = payload
    }

    public init?(text: String) {
        var rest = Substring(text)
        guard let first = rest.first, let digit = first.wholeNumberValue, let kind = Kind(rawValue: digit) else { return nil }
        rest = rest.dropFirst()
        // Binary packets carry an attachment count before the namespace.
        if kind == .binaryEvent || kind == .binaryAck {
            guard let dash = rest.firstIndex(of: "-") else { return nil }
            rest = rest[rest.index(after: dash)...]
        }
        var namespace = "/"
        if rest.first == "/" {
            let comma = rest.firstIndex(of: ",") ?? rest.endIndex
            namespace = String(rest[..<comma])
            rest = comma < rest.endIndex ? rest[rest.index(after: comma)...] : ""
        }
        let digits = rest.prefix { $0.isASCII && $0.isNumber }
        let ackId = digits.isEmpty ? nil : Int(digits)
        rest = rest.dropFirst(digits.count)
        var payload: JSONValue?
        if !rest.isEmpty {
            guard let decoded = try? JSONDecoder().decode(JSONValue.self, from: Data(rest.utf8)) else { return nil }
            payload = decoded
        }
        self.init(kind: kind, namespace: namespace, ackId: ackId, payload: payload)
    }

    public var text: String {
        var result = String(kind.rawValue)
        if namespace != "/" { result += namespace + "," }
        if let ackId { result += String(ackId) }
        if let payload, let data = try? JSONEncoder().encode(payload), let json = String(data: data, encoding: .utf8) {
            result += json
        }
        return result
    }

    /// For an event packet, the event name and its first argument.
    public var event: (name: String, argument: JSONValue)? {
        guard kind == .event, case .array(let items) = payload, let name = items.first?.stringValue else { return nil }
        return (name, items.count > 1 ? items[1] : .null)
    }

    public static func connect(auth: JSONValue) -> SocketPacket {
        SocketPacket(kind: .connect, payload: auth)
    }

    public static func event(_ name: String, _ argument: JSONValue) -> SocketPacket {
        SocketPacket(kind: .event, payload: .array([.string(name), argument]))
    }
}
