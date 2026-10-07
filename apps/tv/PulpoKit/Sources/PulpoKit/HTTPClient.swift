import Foundation
import OSLog

/// Sends authenticated JSON requests to one Pulpo server.
///
/// Requests never use cookies: the server prefers a `pulpo_session` cookie
/// over the bearer token, so a stray cookie could silently switch accounts.
/// Redirects that leave the server's origin are refused so the token is
/// never forwarded to another host.
public final class HTTPClient: Sendable {
    private static let logger = Logger(subsystem: "com.isaacthoman.pulpo", category: "api")

    public let server: ServerAddress
    public let token: String?
    private let session: URLSession
    private let clientHeader: String

    public init(server: ServerAddress, token: String?, configuration: URLSessionConfiguration? = nil) {
        self.server = server
        self.token = token
        let configuration = configuration ?? .ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.httpCookieStorage = nil
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.waitsForConnectivity = false
        self.session = URLSession(
            configuration: configuration,
            delegate: SameOriginRedirects(server: server),
            delegateQueue: nil
        )
        self.clientHeader = Self.makeClientHeader()
    }

    deinit {
        session.finishTasksAndInvalidate()
    }

    public enum Method: String, Sendable {
        case get = "GET", post = "POST", patch = "PATCH", put = "PUT", delete = "DELETE"
    }

    public func get<Response: Decodable>(
        _ path: String, query: [URLQueryItem] = [], as type: Response.Type = Response.self
    ) async throws -> Response {
        try decode(Response.self, from: try await request(.get, path, query: query))
    }

    /// Sends `body` as JSON and decodes the JSON response.
    public func send<Response: Decodable>(
        _ method: Method, _ path: String, body: some Encodable,
        idempotencyKey: String? = nil, as type: Response.Type = Response.self
    ) async throws -> Response {
        let data = try JSONEncoder.pulpo.encode(body)
        return try decode(Response.self, from: try await request(method, path, body: data, idempotencyKey: idempotencyKey))
    }

    /// Sends a request and returns the raw body of a 2xx response, or throws ``APIError``.
    @discardableResult
    public func request(
        _ method: Method, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
        idempotencyKey: String? = nil, timeout: TimeInterval? = nil
    ) async throws -> Data {
        try await perform(makeRequest(method, path, query: query, body: body, idempotencyKey: idempotencyKey, timeout: timeout))
    }

    private func perform(_ urlRequest: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: urlRequest)
        } catch {
            throw APIError.from(transport: error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw APIError.from(status: http.statusCode, data: data)
        }
        return data
    }

    /// Downloads a resource on this server, such as an attachment image.
    public func download(_ url: URL) async throws -> Data {
        guard server.isSameOrigin(url) else {
            // Presigned storage URLs must not receive the Pulpo token.
            do {
                let (data, response) = try await session.data(from: url)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw APIError.invalidResponse
                }
                return data
            } catch let error as APIError {
                throw error
            } catch {
                throw APIError.from(transport: error)
            }
        }
        // Same origin: request the URL exactly as given (local storage keys
        // contain encoded slashes), with this client's headers and token.
        var urlRequest = makeRequest(.get, "/", query: [], body: nil, idempotencyKey: nil, timeout: nil)
        urlRequest.url = url
        return try await perform(urlRequest)
    }

    func makeRequest(
        _ method: Method, _ path: String, query: [URLQueryItem], body: Data?,
        idempotencyKey: String?, timeout: TimeInterval?
    ) -> URLRequest {
        var request = URLRequest(url: server.endpoint(path, query: query))
        request.httpMethod = method.rawValue
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(clientHeader, forHTTPHeaderField: "x-pulpo-client")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        // Bodiless requests carry no content type: Fastify rejects an empty JSON body.
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let timeout { request.timeoutInterval = timeout }
        return request
    }

    private func decode<Response: Decodable>(_ type: Response.Type, from data: Data) throws -> Response {
        do {
            return try JSONDecoder.pulpo.decode(Response.self, from: data)
        } catch {
            Self.logger.error("Couldn’t decode \(String(describing: Response.self), privacy: .public): \(String(describing: error), privacy: .public)")
            throw APIError.invalidResponse
        }
    }

    /// The server only attributes known platforms; tvOS reports as `ios` so it
    /// is counted with Apple's other native clients.
    private static func makeClientHeader() -> String {
        let version = (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
            .trimmingCharacters(in: .whitespaces).lowercased()
        let valid = version.range(of: #"^[0-9a-z.+-]{1,32}$"#, options: .regularExpression) != nil
        return valid ? "ios/\(version)" : "ios"
    }
}

private final class SameOriginRedirects: NSObject, URLSessionTaskDelegate, Sendable {
    let server: ServerAddress

    init(server: ServerAddress) {
        self.server = server
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest
    ) async -> URLRequest? {
        guard let url = request.url, server.isSameOrigin(url) else { return nil }
        return request
    }
}
