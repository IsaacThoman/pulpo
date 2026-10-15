import Foundation
import Testing
@testable import PulpoServices

struct PulpoClientTests {
  @Test func normalizesInstanceAddresses() throws {
    #expect(try PulpoClient.normalizeInstance("pulpo.baby", allowLocalhost: false).absoluteString == "https://pulpo.baby")
    #expect(try PulpoClient.normalizeInstance(" https://pulpo.example/team/ ", allowLocalhost: false).absoluteString == "https://pulpo.example/team")
    #expect(try PulpoClient.normalizeInstance("http://localhost:8090", allowLocalhost: true).absoluteString == "http://localhost:8090")
    #expect(throws: PulpoError.self) { try PulpoClient.normalizeInstance("http://pulpo.baby", allowLocalhost: true) }
    #expect(throws: PulpoError.self) { try PulpoClient.normalizeInstance("http://localhost:8090", allowLocalhost: false) }
    #expect(throws: PulpoError.self) { try PulpoClient.normalizeInstance("https://pulpo.baby/?x=1", allowLocalhost: false) }
  }

  @Test func readsPulpoErrorEnvelopes() {
    let data = Data(#"{"error":{"message":"Enter your authenticator or recovery code.","type":"authentication_error","code":"two_factor_required","param":null}}"#.utf8)
    let error = PulpoClient.error(status: 401, data: data)
    #expect(error.needsTwoFactor)
    #expect(!error.isUnauthorized)
    #expect(PulpoClient.error(status: 401, data: Data()).isUnauthorized)
  }

  @Test func explainsNetworkFailuresByCause() {
    let offline = PulpoError.network(URLError(.notConnectedToInternet))
    #expect(offline.isOffline)
    #expect(offline.message.contains("offline"))
    let missingHost = PulpoError.network(URLError(.cannotFindHost))
    #expect(!missingHost.isOffline)
    #expect(missingHost.message.contains("address"))
    #expect(PulpoError.network(URLError(.timedOut)).message.contains("too long"))
    #expect(PulpoError.network(CocoaError(.fileReadUnknown)).message == "Couldn't reach Pulpo. Check your connection and try again.")
  }
}
