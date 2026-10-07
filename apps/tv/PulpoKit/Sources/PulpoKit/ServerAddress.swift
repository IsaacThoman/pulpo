import Foundation

/// A validated Pulpo instance address, normalized the same way as
/// `normalizeInstanceUrl` in `@pulpo/client-core`.
public struct ServerAddress: Hashable, Sendable, Codable, CustomStringConvertible {
    public static let production = ServerAddress(trusted: URL(string: "https://pulpo.baby")!)

    public enum ValidationError: LocalizedError, Equatable {
        case empty
        case invalid
        case insecure
        case notAnOrigin

        public var errorDescription: String? {
            switch self {
            case .empty: "Enter a server address."
            case .invalid: "That doesn’t look like a server address."
            case .insecure: "Pulpo servers must use HTTPS."
            case .notAnOrigin: "Enter only the server address, without a query or sign-in details."
            }
        }
    }

    public let url: URL

    private init(trusted url: URL) {
        self.url = url
    }

    /// - Parameter allowLocalHTTP: Accept `http://` for loopback hosts. Debug
    ///   builds enable it so the app can reach a server on the developer's Mac.
    public init(_ input: String, allowLocalHTTP: Bool = false) throws {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw ValidationError.empty }
        let hasScheme = trimmed.range(of: #"^[a-zA-Z][a-zA-Z\d+.-]*://"#, options: .regularExpression) != nil
        guard var components = URLComponents(string: hasScheme ? trimmed : "https://\(trimmed)"),
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(), !host.isEmpty,
              !host.contains(" ")
        else { throw ValidationError.invalid }

        let loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host)
        guard scheme == "https" || (allowLocalHTTP && loopback && scheme == "http") else {
            throw scheme == "http" ? ValidationError.insecure : ValidationError.invalid
        }
        guard components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil
        else { throw ValidationError.notAnOrigin }

        components.scheme = scheme
        components.host = host
        while components.path.hasSuffix("/") { components.path.removeLast() }
        guard let url = components.url else { throw ValidationError.invalid }
        self.url = url
    }

    /// The host (and non-default port) without the scheme, for display.
    public var displayName: String {
        var result = url.host ?? url.absoluteString
        if let port = url.port { result += ":\(port)" }
        if !url.path.isEmpty, url.path != "/" { result += url.path }
        return result
    }

    public var description: String { url.absoluteString }

    /// Resolves an absolute, already percent-encoded API path (for example
    /// `/api/chats`) on this server, preserving any path prefix the instance is
    /// hosted under.
    public func endpoint(_ path: String, query: [URLQueryItem] = []) -> URL {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)!
        let base = components.percentEncodedPath
        let prefix = base.hasSuffix("/") ? String(base.dropLast()) : base
        components.percentEncodedPath = prefix + (path.hasPrefix("/") ? path : "/\(path)")
        if !query.isEmpty {
            components.queryItems = query
            // `+` is literal in URLComponents but decoded as a space by most servers.
            components.percentEncodedQuery = components.percentEncodedQuery?
                .replacingOccurrences(of: "+", with: "%2B")
        }
        return components.url!
    }

    /// True when `other` is served by this instance (same scheme, host and port).
    public func isSameOrigin(_ other: URL) -> Bool {
        other.scheme?.lowercased() == url.scheme?.lowercased()
            && other.host?.lowercased() == url.host?.lowercased()
            && effectivePort(other) == effectivePort(url)
    }

    private func effectivePort(_ url: URL) -> Int? {
        url.port ?? (url.scheme?.lowercased() == "https" ? 443 : url.scheme?.lowercased() == "http" ? 80 : nil)
    }
}
