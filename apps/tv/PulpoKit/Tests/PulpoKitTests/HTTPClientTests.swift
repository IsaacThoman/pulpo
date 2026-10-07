import Foundation
import Testing
@testable import PulpoKit

/// Serves canned responses per host so tests can run in parallel.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    typealias Handler = @Sendable (URLRequest, Data?) throws -> (Int, [String: String], Data)

    private static let lock = NSLock()
    nonisolated(unsafe) private static var handlers: [String: Handler] = [:]
    nonisolated(unsafe) private static var requests: [String: [URLRequest]] = [:]

    static func register(host: String, handler: @escaping Handler) {
        lock.withLock {
            handlers[host] = handler
            requests[host] = []
        }
    }

    static func recorded(host: String) -> [URLRequest] {
        lock.withLock { requests[host] ?? [] }
    }

    static func configuration() -> URLSessionConfiguration {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return configuration
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let host = request.url?.host ?? ""
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let handler = Self.lock.withLock { () -> Handler? in
            Self.requests[host, default: []].append(request)
            return Self.handlers[host]
        }
        guard let handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.cannotFindHost))
            return
        }
        do {
            let (status, headers, data) = try handler(request, body)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private func client(host: String, token: String? = "secret-token-0123456789abcdefghijklmnopq", handler: @escaping StubProtocol.Handler) throws -> PulpoAPI {
    StubProtocol.register(host: host, handler: handler)
    return PulpoAPI(HTTPClient(server: try ServerAddress("https://\(host)"), token: token, configuration: StubProtocol.configuration()))
}

private func json(_ text: String, status: Int = 200) -> (Int, [String: String], Data) {
    (status, ["Content-Type": "application/json"], Data(text.utf8))
}

@Suite("HTTP client")
struct HTTPClientTests {
    @Test func sendsTheBearerTokenAndClientHeader() async throws {
        let api = try client(host: "auth.test") { _, _ in json(#"{"data":[]}"#) }
        _ = try await api.chats()
        let request = try #require(StubProtocol.recorded(host: "auth.test").first)
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer secret-token-0123456789abcdefghijklmnopq")
        #expect(request.value(forHTTPHeaderField: "x-pulpo-client")?.hasPrefix("ios") == true)
        #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
        #expect(request.url?.path == "/api/chats")
    }

    @Test func omitsAuthorizationWhenSignedOut() async throws {
        let api = try client(host: "anon.test", token: nil) { _, _ in
            json(#"{"instance":{"name":"Pulpo"},"setupRequired":false}"#)
        }
        let config = try await api.instanceConfig()
        #expect(config.instance.name == "Pulpo")
        #expect(StubProtocol.recorded(host: "anon.test").first?.value(forHTTPHeaderField: "Authorization") == nil)
    }

    @Test func sendsLoginAsANativeDevice() async throws {
        let api = try client(host: "login.test", token: nil) { request, body in
            let payload = try JSONDecoder().decode([String: String].self, from: body ?? Data())
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            #expect(payload["email"] == "ada@example.com")
            #expect(payload["deviceLabel"] == "Living Room")
            #expect(payload["appType"] == "mobile")
            #expect(payload["twoFactorCode"] == nil)
            return json(#"{"error":{"message":"Two-factor authentication is required","type":"authentication_error","code":"two_factor_required","param":null}}"#, status: 401)
        }
        await #expect(throws: APIError(status: 401, code: "two_factor_required", message: "Two-factor authentication is required")) {
            _ = try await api.login(.init(email: "ada@example.com", password: "pw", twoFactorCode: nil, deviceLabel: "Living Room"))
        }
    }

    @Test func startsChatsIdempotently() async throws {
        let api = try client(host: "start.test") { request, body in
            let payload = try JSONDecoder.pulpo.decode(JSONValue.self, from: body ?? Data())
            #expect(request.value(forHTTPHeaderField: "Idempotency-Key") == "resp-1")
            #expect(payload["response"]?["clientId"] == "resp-1")
            #expect(payload["chat"]?["clientId"] == "chat-1")
            #expect(payload["chat"]?["title"] == "Plan a trip to Kyoto")
            #expect(payload["response"]?["input"] == "Plan a trip to Kyoto")
            #expect(payload["response"]?["attachmentIds"] == [])
            #expect(payload["response"]?["parentResponseId"] == nil)
            return json(#"""
            {"chat":{"id":"chat-1","title":"Plan a trip to Kyoto","modelId":"m","createdAt":"2026-10-06T21:00:43.646Z","updatedAt":"2026-10-06T21:00:43.646Z"},
             "response":{"responseId":"resp-1","status":"queued","sequence":0,"output":[],"usage":null,"error":null,"updatedAt":"2026-10-06T21:00:43.646Z"}}
            """#, status: 202)
        }
        let started = try await api.startChat(.init(
            chatId: "chat-1", title: "Plan a trip to Kyoto", response: .init(clientId: "resp-1", input: "Plan a trip to Kyoto", modelId: "m")
        ))
        #expect(started.chat.id == "chat-1")
        #expect(started.response.status == .queued)
    }

    @Test func encodesSearchQueriesAndPathSegments() async throws {
        let api = try client(host: "search.test") { _, _ in json(#"{"data":[]}"#) }
        _ = try await api.searchChats("  c++ 100%  ")
        _ = try await api.searchChats("   ")
        let requests = StubProtocol.recorded(host: "search.test")
        #expect(requests.count == 1)
        #expect(requests.first?.url?.absoluteString == "https://search.test/api/chats/search?q=c%2B%2B%20100%25")
        #expect(PulpoAPI.segment("a/b c") == "a%2Fb%20c")
    }

    @Test func mapsTransportFailures() async throws {
        let api = try client(host: "offline.test") { _, _ in throw URLError(.notConnectedToInternet) }
        await #expect(throws: APIError.offline) { _ = try await api.chats() }
        let slow = try client(host: "slow.test") { _, _ in throw URLError(.timedOut) }
        await #expect(throws: APIError.timedOut) { _ = try await slow.chats() }
    }

    @Test func rejectsUndecodableBodies() async throws {
        let api = try client(host: "garbage.test") { _, _ in json("not json") }
        await #expect(throws: APIError.invalidResponse) { _ = try await api.chats() }
    }

    @Test func treatsEmptySuccessBodiesAsSuccess() async throws {
        let api = try client(host: "delete.test") { request, _ in
            #expect(request.httpMethod == "DELETE")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == nil)
            return (204, [:], Data())
        }
        try await api.deleteChat("chat-1")
    }

    @Test func hidesDisabledSuggestions() async throws {
        let api = try client(host: "prompts.test") { _, _ in json(#"{"enabled":false,"count":0,"prompts":[{"id":"1","label":"x","message":"x"}]}"#) }
        #expect(try await api.suggestedPrompts().isEmpty)
    }

    @Test func downloadsPresignedFilesWithoutTheToken() async throws {
        StubProtocol.register(host: "storage.test") { _, _ in (200, [:], Data("image-bytes".utf8)) }
        let api = try client(host: "files.test") { request, _ in
            #expect(request.url?.path == "/api/attachments/file-1/download")
            return json(#"{"url":"https://storage.test/bucket/file-1?X-Amz-Signature=abc"}"#)
        }
        let data = try await api.attachmentData("file-1")
        #expect(String(decoding: data, as: UTF8.self) == "image-bytes")
        let storageRequest = try #require(StubProtocol.recorded(host: "storage.test").first)
        #expect(storageRequest.value(forHTTPHeaderField: "Authorization") == nil)
        #expect(storageRequest.url?.query == "X-Amz-Signature=abc")
    }

    @Test func keepsEncodedSlashesInLocalStorageDownloads() async throws {
        let key = "users%2Fu-1%2Fattachments%2Ffile%201.png"
        let api = try client(host: "local-files.test") { request, _ in
            if request.url?.path == "/api/attachments/file-3/download" {
                return json(#"{"url":"https://local-files.test/api/attachments/local-download/\#(key)?expires=1"}"#)
            }
            return (200, [:], Data("local-bytes".utf8))
        }
        let data = try await api.attachmentData("file-3")
        #expect(String(decoding: data, as: UTF8.self) == "local-bytes")
        let download = try #require(StubProtocol.recorded(host: "local-files.test").last)
        #expect(download.url?.absoluteString == "https://local-files.test/api/attachments/local-download/\(key)?expires=1")
        #expect(download.value(forHTTPHeaderField: "Authorization") != nil)
    }

    @Test func authenticatesSameOriginDownloads() async throws {
        let api = try client(host: "thumbs.test") { _, _ in (200, ["Content-Type": "image/webp"], Data([1, 2, 3])) }
        let data = try await api.thumbnailData("file-2")
        #expect(data == Data([1, 2, 3]))
        let request = try #require(StubProtocol.recorded(host: "thumbs.test").first)
        #expect(request.url?.path == "/api/attachments/file-2/thumbnail")
        #expect(request.value(forHTTPHeaderField: "Authorization") != nil)
    }
}
