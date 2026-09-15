import Foundation
import Security
import CryptoKit

struct APIError: LocalizedError {
    let status: Int
    let code: String
    let message: String
    var errorDescription: String? { message }
}

struct Session: Codable, Equatable {
    let origin: URL
    let token: String
    let userID: String
    var scope: String {
        SHA256.hash(data: Data("\(origin.absoluteString)|\(userID)".utf8)).map { String(format: "%02x", $0) }.joined()
    }
}

final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

final class API {
    let origin: URL
    let token: String?
    private let transport: URLSession
    init(origin: URL, token: String? = nil, transport: URLSession? = nil) {
        self.origin = origin; self.token = token
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 60
        config.httpShouldSetCookies = false
        self.transport = transport ?? URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    }
    deinit { transport.invalidateAndCancel() }

    static func origin(_ input: String) throws -> URL {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: value.contains("://") ? value : "https://\(value)"),
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil,
              url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else {
            throw APIError(status: 0, code: "invalid_server", message: "Enter a server address.")
        }
        var allowed = url.scheme == "https"
        #if DEBUG
        allowed = allowed || (url.scheme == "http" && ["localhost", "127.0.0.1", "[::1]"].contains(host))
        #endif
        guard allowed else { throw APIError(status: 0, code: "invalid_server", message: "Use an HTTPS address.") }
        return URL(string: url.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")))!
    }

    func request(_ path: String, method: String = "GET", body: JSON? = nil, key: String? = nil) async throws -> JSON {
        let (data, response) = try await data(path, method: method, body: body, key: key)
        if response.statusCode == 204 || data.isEmpty { return .null }
        do { return try JSON.parse(data) }
        catch { throw APIError(status: response.statusCode, code: "invalid_response", message: "The server returned an invalid response.") }
    }

    func data(_ path: String, method: String = "GET", body: JSON? = nil, key: String? = nil) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: origin)?.absoluteURL,
              url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port else {
            throw APIError(status: 0, code: "invalid_url", message: "The file address is invalid.")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let key { request.setValue(key, forHTTPHeaderField: "Idempotency-Key") }
        if let body {
            request.httpBody = try JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, raw) = try await transport.data(for: request)
        guard let response = raw as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(response.statusCode) else {
            let error = (try? JSON.parse(data))?["error"] ?? .null
            throw APIError(status: response.statusCode, code: error["code"].string,
                           message: error["message"].optionalString ?? "Request failed (\(response.statusCode)).")
        }
        return (data, response)
    }

    static func searchPath(_ query: String) -> String {
        var components = URLComponents()
        components.path = "/api/chats/search"
        components.queryItems = [URLQueryItem(name: "q", value: String(query.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200)))]
        return components.string!.replacingOccurrences(of: "+", with: "%2B")
    }
    static func resource(_ id: String) -> String {
        id.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? ""
    }
}

enum SessionVault {
    private static var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.isaacthoman.pulpo.tv", kSecAttrAccount as String: "session"] }
    static func load() throws -> Session? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &value)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = value as? Data else { throw vaultError }
        return try JSONDecoder().decode(Session.self, from: data)
    }
    static func save(_ session: Session?) throws {
        guard let session else {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw vaultError }
            return
        }
        let attributes: [String: Any] = [kSecValueData as String: try JSONEncoder().encode(session),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound { status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) }
        guard status == errSecSuccess else { throw vaultError }
    }
    private static let vaultError = APIError(status: 0, code: "keychain", message: "Could not save the session. Try again.")
}
