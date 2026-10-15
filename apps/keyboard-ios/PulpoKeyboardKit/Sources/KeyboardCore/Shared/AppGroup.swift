import Foundation

public enum AppGroup {
  public static let identifier = "group.com.isaacthoman.pulpo.keyboard"
  public static let urlScheme = "pulpokeyboard"

  public static var containerURL: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: identifier)
  }

  public static var defaults: UserDefaults? {
    UserDefaults(suiteName: identifier)
  }

  /// Whether the group container is writable, which for the keyboard means Full Access.
  public static var isWritable: Bool {
    guard let url = containerURL else { return false }
    let probe = url.appendingPathComponent(".probe")
    do {
      try Data().write(to: probe)
      try? FileManager.default.removeItem(at: probe)
      return true
    } catch {
      return false
    }
  }

  /// Learned words live in the group when possible so the app can show and clear them.
  public static func personalDictionaryURL(fallback: URL?) -> URL? {
    personalDictionaryURL(fallback: fallback, writable: isWritable)
  }

  /// For callers that already probed `isWritable`, which writes a file.
  public static func personalDictionaryURL(fallback: URL?, writable: Bool) -> URL? {
    if writable, let url = containerURL { return url.appendingPathComponent("PersonalDictionary.json") }
    return fallback?.appendingPathComponent("PersonalDictionary.json")
  }

  /// Learned per-key tap offsets, cleared together with learned words.
  public static func touchModelURL(fallback: URL?) -> URL? {
    touchModelURL(fallback: fallback, writable: isWritable)
  }

  public static func touchModelURL(fallback: URL?, writable: Bool) -> URL? {
    if writable, let url = containerURL { return url.appendingPathComponent("TouchModel.json") }
    return fallback?.appendingPathComponent("TouchModel.json")
  }
}

/// What the keyboard last reported about itself, so the app's setup screen can show
/// whether Full Access is on. Only writable with Full Access, which is the point.
public struct KeyboardHeartbeat: Codable, Equatable, Sendable {
  public var hasFullAccess: Bool
  public var lastSeen: Date

  static let key = "keyboardHeartbeat"

  public static func record(hasFullAccess: Bool, defaults: UserDefaults? = AppGroup.defaults) {
    guard let data = try? JSONEncoder().encode(KeyboardHeartbeat(hasFullAccess: hasFullAccess, lastSeen: Date())) else { return }
    defaults?.set(data, forKey: key)
  }

  public static func load(defaults: UserDefaults? = AppGroup.defaults) -> KeyboardHeartbeat? {
    guard let data = defaults?.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(KeyboardHeartbeat.self, from: data)
  }

  public static func clear(defaults: UserDefaults? = AppGroup.defaults) {
    defaults?.removeObject(forKey: key)
  }

  /// Posted by the installed keyboard each time it appears, so the app can confirm
  /// setup live while it is on screen. Two names carry the Full Access state,
  /// because without Full Access the keyboard can't write to the App Group.
  public static func appearedNotification(fullAccess: Bool) -> String {
    "\(AppGroup.identifier).keyboardAppeared.\(fullAccess ? "full" : "limited")"
  }

  /// Full Access as last observed: the newer of the keyboard's own heartbeat (only
  /// written with Full Access) and the app's record of seeing it appear without.
  /// Nil when the keyboard has never been seen since setup started.
  public static func fullAccess(heartbeat: KeyboardHeartbeat?, limitedSeenAt: Date?) -> Bool? {
    switch (heartbeat, limitedSeenAt) {
    case (nil, nil): nil
    case (let heartbeat?, nil): heartbeat.hasFullAccess
    case (nil, .some): false
    case (let heartbeat?, let limited?): heartbeat.lastSeen > limited ? heartbeat.hasFullAccess : false
    }
  }
}

/// The signed-in Pulpo account as the keyboard sees it. The session token never
/// leaves the app's Keychain; the keyboard only needs to know dictation will work.
public struct AccountSnapshot: Codable, Equatable, Sendable {
  public var signedIn: Bool
  public var displayName: String?
  public var instanceHost: String?
  public var dictationAvailable: Bool

  public static let signedOut = AccountSnapshot(signedIn: false, displayName: nil, instanceHost: nil, dictationAvailable: false)
  static let key = "accountSnapshot"

  public init(signedIn: Bool, displayName: String?, instanceHost: String?, dictationAvailable: Bool) {
    self.signedIn = signedIn
    self.displayName = displayName
    self.instanceHost = instanceHost
    self.dictationAvailable = dictationAvailable
  }

  public static func load(defaults: UserDefaults? = AppGroup.defaults) -> AccountSnapshot {
    guard let data = defaults?.data(forKey: key), let snapshot = try? JSONDecoder().decode(AccountSnapshot.self, from: data) else {
      return .signedOut
    }
    return snapshot
  }

  public func save(defaults: UserDefaults? = AppGroup.defaults) {
    guard let data = try? JSONEncoder().encode(self) else { return }
    defaults?.set(data, forKey: Self.key)
  }
}
