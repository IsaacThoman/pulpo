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
    if isWritable, let url = containerURL { return url.appendingPathComponent("PersonalDictionary.json") }
    return fallback?.appendingPathComponent("PersonalDictionary.json")
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
