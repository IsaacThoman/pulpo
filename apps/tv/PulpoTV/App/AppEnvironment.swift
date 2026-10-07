import Foundation
import PulpoKit
import UIKit

/// Everything that differs between a real launch and a UI-test or preview
/// launch: where requests go and where the session is kept.
struct AppEnvironment: Sendable {
    var defaultServer: ServerAddress
    var sessionStore: SessionStore
    var allowLocalHTTP: Bool
    var makeHTTPClient: @Sendable (ServerAddress, String?) -> HTTPClient
    var makeRealtime: @Sendable (ServerAddress, String) -> RealtimeChannel
    /// The label shown in the account's device list on the web.
    var deviceLabel: String

    @MainActor
    static func live() -> AppEnvironment {
        #if DEBUG
        let allowLocalHTTP = true
        #else
        let allowLocalHTTP = false
        #endif
        return AppEnvironment(
            defaultServer: .production,
            sessionStore: KeychainSessionStore(),
            allowLocalHTTP: allowLocalHTTP,
            makeHTTPClient: { HTTPClient(server: $0, token: $1) },
            makeRealtime: { SocketIOClient(server: $0, token: $1) },
            deviceLabel: Self.deviceName()
        )
    }

    /// Chooses the environment from launch arguments. UI tests pass
    /// `-PulpoMock` to run against an in-process fake server.
    @MainActor
    static func current() -> AppEnvironment {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-PulpoMock") {
            let environment = MockServer.environment(signedIn: arguments.contains("-PulpoSignedIn"))
            if arguments.contains("-PulpoMockLowBalance") {
                // The first new chat fails as it would on an account without credit.
                MockServer.shared.failNext("/api/chats/start", status: 402, code: "insufficient_balance", message: "Insufficient balance for the request")
            }
            return environment
        }
        if let server = UserDefaults.standard.string(forKey: "PulpoServer"),
           let address = try? ServerAddress(server, allowLocalHTTP: true) {
            var environment = live()
            environment.defaultServer = address
            return environment
        }
        #endif
        return live()
    }

    @MainActor
    private static func deviceName() -> String {
        let name = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return String((name.isEmpty ? "Apple TV" : name).prefix(120))
    }
}
