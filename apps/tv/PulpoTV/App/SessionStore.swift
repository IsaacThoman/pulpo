import Foundation
import PulpoKit
import Security

/// The signed-in account, persisted between launches.
struct StoredSession: Codable, Equatable, Sendable {
    var server: ServerAddress
    var token: String
    var user: User
}

protocol SessionStore: Sendable {
    func load() -> StoredSession?
    func save(_ session: StoredSession) throws
    func clear()
}

/// Keeps the session token in this device's keychain only; it is never synced.
struct KeychainSessionStore: SessionStore {
    var service = "com.isaacthoman.pulpo.tv.session"

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "session",
        ]
    }

    func load() -> StoredSession? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder.pulpo.decode(StoredSession.self, from: data)
    }

    func save(_ session: StoredSession) throws {
        let data = try JSONEncoder.pulpo.encode(session)
        let attributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw APIError(status: 0, code: "keychain", message: "Pulpo couldn’t save your sign-in on this Apple TV.")
        }
    }

    func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

/// An in-memory store for tests and UI-test launches.
final class MemorySessionStore: SessionStore, @unchecked Sendable {
    private let lock = NSLock()
    private var session: StoredSession?

    init(_ session: StoredSession? = nil) {
        self.session = session
    }

    func load() -> StoredSession? { lock.withLock { session } }
    func save(_ session: StoredSession) throws { lock.withLock { self.session = session } }
    func clear() { lock.withLock { session = nil } }
}

/// Small non-secret preferences.
enum Preferences {
    /// Replaced in tests so they don't share state.
    nonisolated(unsafe) static var store: UserDefaults = .standard
    private static var defaults: UserDefaults { store }

    /// The server last signed in to, so the sign-in form remembers it.
    static var lastServer: ServerAddress? {
        get { defaults.data(forKey: "lastServer").flatMap { try? JSONDecoder().decode(ServerAddress.self, from: $0) } }
        set { defaults.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "lastServer") }
    }

    static var lastEmail: String? {
        get { defaults.string(forKey: "lastEmail") }
        set { defaults.set(newValue, forKey: "lastEmail") }
    }

    /// Words per minute multiplier for reading replies aloud (0.8–1.4).
    static var speechRate: Double {
        get { defaults.object(forKey: "speechRate") as? Double ?? 1 }
        set { defaults.set(newValue, forKey: "speechRate") }
    }
}
