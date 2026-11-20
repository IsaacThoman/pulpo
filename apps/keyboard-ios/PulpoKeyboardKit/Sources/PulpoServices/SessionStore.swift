import Foundation
import KeyboardCore
import Security

/// The signed-in account. The bearer token stays in the Keychain, device-only, in the
/// App Group's access group so the keyboard (with Full Access) can upload a dictation
/// it recorded itself.
public struct StoredSession: Codable, Equatable, Sendable {
  public var instance: URL
  public var token: String
  public var user: PulpoUser
  public var dictationAvailable: Bool

  public init(instance: URL, token: String, user: PulpoUser, dictationAvailable: Bool) {
    self.instance = instance
    self.token = token
    self.user = user
    self.dictationAvailable = dictationAvailable
  }
}

public final class SessionStore: @unchecked Sendable {
  let service: String
  let account = "session"
  /// The Keychain access group shared with the keyboard, or nil for the default group only.
  let accessGroup: String?

  public init(service: String = "com.isaacthoman.pulpo.keyboard.session", accessGroup: String? = AppGroup.identifier) {
    self.service = service
    self.accessGroup = accessGroup
  }

  /// Without a group, a query matches the item in every group this process can read.
  private func query(group: String?) -> [String: Any] {
    var query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    if let group { query[kSecAttrAccessGroup as String] = group }
    return query
  }

  /// The shared item, else one older versions saved in the app's own group.
  public func load() -> StoredSession? {
    if let accessGroup, let shared = read(query(group: accessGroup)) { return shared }
    return read(query(group: nil))
  }

  /// Moves a session saved before the keyboard could read it into the shared group.
  public func migrateIfNeeded() {
    guard let accessGroup, read(query(group: accessGroup)) == nil, let legacy = read(query(group: nil)) else { return }
    if write(legacy, group: accessGroup) { removeOutsideSharedGroup() }
  }

  @discardableResult
  public func save(_ session: StoredSession) -> Bool {
    // A build without the App Group entitlement keeps working, without in-keyboard dictation.
    guard let accessGroup, write(session, group: accessGroup) else { return write(session, group: nil) }
    removeOutsideSharedGroup()
    return true
  }

  public func clear() {
    SecItemDelete(query(group: nil) as CFDictionary)
  }

  private func read(_ base: [String: Any]) -> StoredSession? {
    var lookup = base
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return try? JSONDecoder().decode(StoredSession.self, from: data)
  }

  private func write(_ session: StoredSession, group: String?) -> Bool {
    guard let data = try? JSONEncoder().encode(session) else { return false }
    let base = query(group: group)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updated = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
    if updated == errSecSuccess { return true }
    guard updated == errSecItemNotFound else { return false }
    var item = base
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  /// Deletes copies in other groups by name, so the shared item survives.
  private func removeOutsideSharedGroup() {
    var lookup = query(group: nil)
    lookup[kSecReturnAttributes as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitAll
    var result: CFTypeRef?
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess, let items = result as? [[String: Any]] else { return }
    for group in items.compactMap({ $0[kSecAttrAccessGroup as String] as? String }) where group != accessGroup {
      SecItemDelete(query(group: group) as CFDictionary)
    }
  }
}
