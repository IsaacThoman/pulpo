import Foundation

/// The app's dictation status, written for the keyboard to read.
public struct DictationState: Codable, Equatable, Sendable {
  public enum Phase: String, Codable, Sendable {
    case idle, recording, transcribing, finished, failed
  }

  public var phase: Phase
  public var requestID: UUID?
  /// The app keeps the microphone running until then, so a new dictation can start
  /// without leaving the current app.
  public var standbyUntil: Date?
  public var startedAt: Date?
  public var transcript: String?
  public var errorMessage: String?
  public var updatedAt: Date

  public init(phase: Phase, requestID: UUID? = nil, standbyUntil: Date? = nil, startedAt: Date? = nil, transcript: String? = nil, errorMessage: String? = nil, updatedAt: Date = Date()) {
    self.phase = phase
    self.requestID = requestID
    self.standbyUntil = standbyUntil
    self.startedAt = startedAt
    self.transcript = transcript
    self.errorMessage = errorMessage
    self.updatedAt = updatedAt
  }

  public static let idle = DictationState(phase: .idle)

  public func isStandingBy(at date: Date = Date()) -> Bool {
    guard let standbyUntil else { return false }
    return standbyUntil > date.addingTimeInterval(1)
  }
}

public struct DictationCommand: Codable, Equatable, Sendable {
  public enum Kind: String, Codable, Sendable {
    case start, stop, cancel
  }

  public var kind: Kind
  public var requestID: UUID
  public var issuedAt: Date

  public init(kind: Kind, requestID: UUID, issuedAt: Date = Date()) {
    self.kind = kind
    self.requestID = requestID
    self.issuedAt = issuedAt
  }
}

/// File and notification channel between the keyboard and the app.
public final class DictationBridge: @unchecked Sendable {
  public static let commandNotification = "com.isaacthoman.pulpo.keyboard.dictation.command"
  public static let stateNotification = "com.isaacthoman.pulpo.keyboard.dictation.state"
  public static let levelCount = 48

  private let directory: URL
  private let defaults: UserDefaults?

  public init?(containerURL: URL? = AppGroup.containerURL, defaults: UserDefaults? = AppGroup.defaults) {
    guard let containerURL else { return nil }
    directory = containerURL.appendingPathComponent("Dictation", isDirectory: true)
    self.defaults = defaults
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  private var stateURL: URL { directory.appendingPathComponent("state.json") }
  private var commandURL: URL { directory.appendingPathComponent("command.json") }
  private var levelsURL: URL { directory.appendingPathComponent("levels.bin") }
  public var recordingURL: URL { directory.appendingPathComponent("recording.m4a") }

  private static let encoder: JSONEncoder = {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .millisecondsSince1970
    return encoder
  }()

  private static let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .millisecondsSince1970
    return decoder
  }()

  // MARK: State (app -> keyboard)

  public func writeState(_ state: DictationState) {
    guard let data = try? Self.encoder.encode(state) else { return }
    try? data.write(to: stateURL, options: .atomic)
    DarwinNotifications.post(Self.stateNotification)
  }

  public func readState() -> DictationState {
    guard let data = try? Data(contentsOf: stateURL), let state = try? Self.decoder.decode(DictationState.self, from: data) else { return .idle }
    return state
  }

  // MARK: Commands (keyboard -> app)

  public func send(_ command: DictationCommand) {
    guard let data = try? Self.encoder.encode(command) else { return }
    try? data.write(to: commandURL, options: .atomic)
    DarwinNotifications.post(Self.commandNotification)
  }

  public func readCommand() -> DictationCommand? {
    guard let data = try? Data(contentsOf: commandURL) else { return nil }
    return try? Self.decoder.decode(DictationCommand.self, from: data)
  }

  // MARK: Levels

  /// Recent input levels in 0...1, oldest first.
  public func writeLevels(_ levels: [Float]) {
    let data = levels.withUnsafeBufferPointer { Data(buffer: $0) }
    try? data.write(to: levelsURL, options: .atomic)
  }

  public func readLevels() -> [Float] {
    guard let data = try? Data(contentsOf: levelsURL), data.count % MemoryLayout<Float>.size == 0 else { return [] }
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
  }

  // MARK: Delivery

  /// Each transcript is inserted once, even if the keyboard was relaunched meanwhile.
  public func markDelivered(_ requestID: UUID) {
    defaults?.set(requestID.uuidString, forKey: "dictationDelivered")
  }

  public func wasDelivered(_ requestID: UUID) -> Bool {
    defaults?.string(forKey: "dictationDelivered") == requestID.uuidString
  }

  /// The request the keyboard is waiting on, so a relaunched keyboard can pick it up.
  public var pendingRequest: UUID? {
    get { defaults?.string(forKey: "dictationPending").flatMap(UUID.init(uuidString:)) }
    set { defaults?.set(newValue?.uuidString, forKey: "dictationPending") }
  }
}

/// Cross-process pings. Darwin notifications carry no payload; readers re-read the files.
public enum DarwinNotifications {
  public static func post(_ name: String) {
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true)
  }

  /// Calls `handler` on the main queue for each post. Keep the token alive to keep observing.
  public static func observe(_ name: String, handler: @escaping @Sendable () -> Void) -> Observation {
    Observation(name: name, handler: handler)
  }

  public final class Observation: @unchecked Sendable {
    let name: String
    let handler: @Sendable () -> Void

    init(name: String, handler: @escaping @Sendable () -> Void) {
      self.name = name
      self.handler = handler
      let center = CFNotificationCenterGetDarwinNotifyCenter()
      CFNotificationCenterAddObserver(center, Unmanaged.passUnretained(self).toOpaque(), { _, observer, _, _, _ in
        guard let observer else { return }
        let observation = Unmanaged<Observation>.fromOpaque(observer).takeUnretainedValue()
        let handler = observation.handler
        DispatchQueue.main.async { handler() }
      }, name as CFString, nil, .deliverImmediately)
    }

    deinit {
      CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(), Unmanaged.passUnretained(self).toOpaque(), CFNotificationName(name as CFString), nil)
    }
  }
}
