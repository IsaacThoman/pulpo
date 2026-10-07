import Foundation
import Testing
@testable import PulpoKit

@Suite("Server addresses")
struct ServerAddressTests {
    @Test(arguments: [
        ("pulpo.baby", "https://pulpo.baby"),
        ("  https://Pulpo.Baby/  ", "https://pulpo.baby"),
        ("chat.example.com:8443", "https://chat.example.com:8443"),
        ("https://example.com/pulpo//", "https://example.com/pulpo"),
    ])
    func normalizes(input: String, expected: String) throws {
        #expect(try ServerAddress(input).url.absoluteString == expected)
    }

    @Test func requiresHTTPSExceptLoopbackInDevelopment() throws {
        #expect(throws: ServerAddress.ValidationError.insecure) { try ServerAddress("http://example.com") }
        #expect(throws: ServerAddress.ValidationError.insecure) { try ServerAddress("http://localhost:8080") }
        #expect(try ServerAddress("http://localhost:8080", allowLocalHTTP: true).url.absoluteString == "http://localhost:8080")
        #expect(try ServerAddress("http://127.0.0.1:3000", allowLocalHTTP: true).displayName == "127.0.0.1:3000")
        #expect(throws: ServerAddress.ValidationError.insecure) { try ServerAddress("http://192.168.1.4", allowLocalHTTP: true) }
    }

    @Test func rejectsAnythingButAnOrigin() {
        #expect(throws: ServerAddress.ValidationError.empty) { try ServerAddress("   ") }
        #expect(throws: ServerAddress.ValidationError.notAnOrigin) { try ServerAddress("https://user:pw@example.com") }
        #expect(throws: ServerAddress.ValidationError.notAnOrigin) { try ServerAddress("https://example.com/?a=1") }
        #expect(throws: ServerAddress.ValidationError.notAnOrigin) { try ServerAddress("https://example.com/#x") }
        #expect(throws: ServerAddress.ValidationError.invalid) { try ServerAddress("ftp://example.com") }
        #expect(throws: ServerAddress.ValidationError.invalid) { try ServerAddress("https://") }
    }

    @Test func buildsEndpointsUnderPathPrefixes() throws {
        let server = try ServerAddress("https://example.com/pulpo")
        #expect(server.endpoint("/api/chats").absoluteString == "https://example.com/pulpo/api/chats")
        #expect(ServerAddress.production.endpoint("/api/chats").absoluteString == "https://pulpo.baby/api/chats")
    }

    @Test func encodesPlusSignsInQueries() {
        let url = ServerAddress.production.endpoint("/api/chats/search", query: [URLQueryItem(name: "q", value: "c++ & rust")])
        #expect(url.absoluteString == "https://pulpo.baby/api/chats/search?q=c%2B%2B%20%26%20rust")
    }

    @Test func comparesOrigins() throws {
        let server = ServerAddress.production
        #expect(server.isSameOrigin(URL(string: "https://pulpo.baby/api/x")!))
        #expect(server.isSameOrigin(URL(string: "https://PULPO.baby:443/api/x")!))
        #expect(!server.isSameOrigin(URL(string: "http://pulpo.baby/api/x")!))
        #expect(!server.isSameOrigin(URL(string: "https://evil.example/api/x")!))
        #expect(!server.isSameOrigin(URL(string: "https://pulpo.baby:8443/api/x")!))
    }

    @Test func displaysWithoutTheScheme() throws {
        #expect(ServerAddress.production.displayName == "pulpo.baby")
        #expect(try ServerAddress("example.com:8443/team").displayName == "example.com:8443/team")
    }
}
