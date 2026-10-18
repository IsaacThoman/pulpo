import Foundation
import Security

/// The signed-in account. The bearer token stays in the app's own Keychain, device-only;
/// the keyboard extension never sees it.
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

  public init(service: String = "com.isaacthoman.pulpo.keyboard.session") {
    self.service = service
  }

  private var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
  }

  public func load() -> StoredSession? {
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
    return try? JSONDecoder().decode(StoredSession.self, from: data)
  }

  @discardableResult
  public func save(_ session: StoredSession) -> Bool {
    guard let data = try? JSONEncoder().encode(session) else { return false }
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    let updated = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if updated == errSecSuccess { return true }
    guard updated == errSecItemNotFound else { return false }
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  public func clear() {
    SecItemDelete(query as CFDictionary)
  }
}
