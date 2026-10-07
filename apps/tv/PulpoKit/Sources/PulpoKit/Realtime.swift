import Foundation

/// What the realtime connection reports to the app.
public enum RealtimeMessage: Sendable, Equatable {
    /// The socket (re)connected. Re-subscribe to responses still being followed:
    /// each subscription replays the events after its cursor.
    case connected
    case disconnected
    /// The server rejected the session; it was revoked or has expired.
    case unauthorized
    case responseEvent(ResponseEvent)
    case responseSnapshot(ResponseSnapshot)
    /// Account data changed elsewhere. An empty scope list is an
    /// account-level change, such as settings.
    case accountRevision(scopes: [String])
    case chatChanged(chatId: String)
}

/// The realtime transport, abstracted so previews and UI tests can drive the
/// app without a server.
public protocol RealtimeChannel: AnyObject, Sendable {
    var messages: AsyncStream<RealtimeMessage> { get }
    func start() async
    func stop() async
    func subscribe(responseId: String, afterSequence: Int) async
    func unsubscribe(responseId: String) async
}

/// A websocket-only Socket.IO client for Pulpo's realtime API.
///
/// It reconnects with jittered exponential backoff and stops only when told
/// to, or when the server rejects the session.
public actor SocketIOClient: RealtimeChannel {
    public nonisolated let messages: AsyncStream<RealtimeMessage>
    private let continuation: AsyncStream<RealtimeMessage>.Continuation
    private let url: URL
    private let token: String
    private let session: URLSession
    private var loop: Task<Void, Never>?
    private var socket: URLSessionWebSocketTask?
    private var connected = false
    private var lastActivity = ContinuousClock.now

    public init(server: ServerAddress, token: String, configuration: URLSessionConfiguration = .ephemeral) {
        (messages, continuation) = AsyncStream.makeStream(of: RealtimeMessage.self, bufferingPolicy: .unbounded)
        self.url = Self.socketURL(for: server)
        self.token = token
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        self.session = URLSession(configuration: configuration)
    }

    deinit {
        loop?.cancel()
        continuation.finish()
        session.invalidateAndCancel()
    }

    /// `wss://host/socket.io/?EIO=4&transport=websocket`. The server mounts
    /// Socket.IO at the origin even when the web app lives under a path.
    static func socketURL(for server: ServerAddress) -> URL {
        // Start from the server's URL so the host keeps its exact form
        // (IPv6 brackets, punycode), then replace everything after it.
        var components = URLComponents(url: server.url, resolvingAgainstBaseURL: false)!
        components.scheme = server.url.scheme == "http" ? "ws" : "wss"
        components.percentEncodedPath = "/socket.io/"
        components.percentEncodedQuery = "EIO=4&transport=websocket"
        return components.url!
    }

    public func start() {
        guard loop == nil else { return }
        loop = Task { await self.run() }
    }

    public func stop() {
        loop?.cancel()
        loop = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        setConnected(false)
    }

    public func subscribe(responseId: String, afterSequence: Int) async {
        await emit("response.subscribe", ["responseId": .string(responseId), "afterSequence": .number(Double(max(0, afterSequence)))])
    }

    public func unsubscribe(responseId: String) async {
        await emit("response.unsubscribe", ["responseId": .string(responseId)])
    }

    // MARK: Connection loop

    private enum Outcome {
        case unauthorized
        case failed
        case lost
    }

    private func run() async {
        var attempt = 0
        while !Task.isCancelled {
            let outcome = await connectOnce()
            if Task.isCancelled { break }
            switch outcome {
            case .unauthorized:
                continuation.yield(.unauthorized)
                loop = nil
                return
            case .lost:
                attempt = 0
            case .failed:
                attempt += 1
            }
            let base = attempt == 0 ? 0.5 : min(30, pow(2, Double(min(attempt, 5))))
            try? await Task.sleep(for: .seconds(base * Double.random(in: 0.8...1.2)))
        }
    }

    private func connectOnce() async -> Outcome {
        let task = session.webSocketTask(with: url)
        task.maximumMessageSize = 8 * 1024 * 1024
        socket = task
        task.resume()
        lastActivity = .now
        var established = false
        var watchdog: Task<Void, Never>?
        defer {
            watchdog?.cancel()
            task.cancel(with: .goingAway, reason: nil)
            if socket === task { socket = nil }
            setConnected(false)
        }
        do {
            guard case .open(let handshake) = try await receive(task) else { return .failed }
            // The server pings every `pingInterval`; silence beyond the grace
            // period means the connection is dead even if TCP hasn't noticed.
            let limit = Duration.milliseconds(handshake.pingInterval + handshake.pingTimeout)
            watchdog = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(2))
                    guard let self, await self.isStale(limit) else { continue }
                    task.cancel(with: .goingAway, reason: nil)
                    return
                }
            }
            let auth: JSONValue = ["sessionToken": .string(token), "composerSyncEnabled": false]
            try await task.send(.string(EnginePacket.message(.connect(auth: auth)).text))
            while !Task.isCancelled {
                switch try await receive(task) {
                case .ping:
                    try await task.send(.string(EnginePacket.pong.text))
                case .close:
                    return established ? .lost : .failed
                case .message(let packet):
                    switch packet.kind {
                    case .connect:
                        established = true
                        setConnected(true)
                    case .connectError:
                        let message = packet.payload?["message"]?.stringValue
                        return message == "unauthorized" ? .unauthorized : .failed
                    case .disconnect:
                        return .lost
                    case .event:
                        deliver(packet)
                    default:
                        break
                    }
                default:
                    break
                }
            }
            return .lost
        } catch {
            return established ? .lost : .failed
        }
    }

    private func receive(_ task: URLSessionWebSocketTask) async throws -> EnginePacket? {
        let message = try await task.receive()
        lastActivity = .now
        switch message {
        case .string(let text): return EnginePacket(text: text)
        case .data: return nil
        @unknown default: return nil
        }
    }

    private func isStale(_ limit: Duration) -> Bool {
        ContinuousClock.now - lastActivity > limit
    }

    private func setConnected(_ value: Bool) {
        guard connected != value else { return }
        connected = value
        continuation.yield(value ? .connected : .disconnected)
    }

    private func emit(_ name: String, _ argument: JSONValue) async {
        guard connected, let socket else { return }
        try? await socket.send(.string(EnginePacket.message(.event(name, argument)).text))
    }

    private func deliver(_ packet: SocketPacket) {
        guard let (name, argument) = packet.event else { return }
        switch name {
        case "response.event":
            if let event = Self.decode(ResponseEvent.self, argument) { continuation.yield(.responseEvent(event)) }
        case "response.snapshot":
            if let snapshot = Self.decode(ResponseSnapshot.self, argument) { continuation.yield(.responseSnapshot(snapshot)) }
        case "account.revision":
            let scopes = argument["scopes"]?.arrayValue?.compactMap(\.stringValue) ?? []
            continuation.yield(.accountRevision(scopes: scopes))
        case "chat.changed":
            if let chatId = argument["chatId"]?.stringValue { continuation.yield(.chatChanged(chatId: chatId)) }
        default:
            break
        }
    }

    static func decode<Value: Decodable>(_ type: Value.Type, _ value: JSONValue) -> Value? {
        guard let data = try? JSONEncoder().encode(value) else { return nil }
        return try? JSONDecoder.pulpo.decode(Value.self, from: data)
    }
}

/// Folds one response's realtime events and snapshots in sequence order,
/// buffering events that arrive ahead of a gap.
public struct ResponseTracker: Sendable, Equatable {
    public private(set) var snapshot: ResponseSnapshot
    private var pending: [Int: ResponseEvent] = [:]

    public init(_ snapshot: ResponseSnapshot) {
        self.snapshot = snapshot
    }

    public var responseId: String { snapshot.responseId }
    public var sequence: Int { snapshot.sequence }
    public var isTerminal: Bool { snapshot.status.isTerminal }

    /// Returns true when the visible snapshot changed.
    @discardableResult
    public mutating func receive(_ event: ResponseEvent) -> Bool {
        guard event.responseId == responseId, event.sequence > snapshot.sequence else { return false }
        pending[event.sequence] = event
        return flush()
    }

    @discardableResult
    public mutating func receive(_ incoming: ResponseSnapshot) -> Bool {
        guard incoming.responseId == responseId else { return false }
        let before = snapshot
        snapshot = ResponseReducer.merge(snapshot, incoming)
        pending = pending.filter { $0.key > snapshot.sequence }
        flush()
        return snapshot != before
    }

    /// Applies a cancellation acknowledgement. Its sequence can trail what was
    /// already applied, which the merge rules would ignore.
    public mutating func markCancelled() {
        finish(.cancelled)
    }

    /// Adopts a terminal status reported out of band (the stored chat, or a
    /// cancel acknowledgement) while keeping the output already streamed.
    public mutating func finish(_ status: ResponseStatus, error: JSONValue? = nil) {
        guard snapshot.status.isActive, status.isTerminal else { return }
        snapshot.status = status
        if let error { snapshot.error = error }
        pending.removeAll()
    }

    @discardableResult
    private mutating func flush() -> Bool {
        var changed = false
        while let event = pending.removeValue(forKey: snapshot.sequence + 1) {
            snapshot = ResponseReducer.apply(event, to: snapshot)
            changed = true
        }
        return changed
    }
}
