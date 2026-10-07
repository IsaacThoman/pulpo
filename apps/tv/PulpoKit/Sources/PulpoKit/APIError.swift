import Foundation

/// An error response from a Pulpo server, or a transport failure translated
/// into language suitable for a television screen.
public struct APIError: LocalizedError, Equatable, Sendable {
    public let status: Int
    public let code: String
    public let message: String
    public let parameter: String?

    public init(status: Int, code: String, message: String, parameter: String? = nil) {
        self.status = status
        self.code = code
        self.message = message
        self.parameter = parameter
    }

    public var errorDescription: String? { message }

    public var isUnauthorized: Bool { status == 401 && code == "unauthorized" }
    public var isNotFound: Bool { status == 404 }
    public var isOffline: Bool { code == Self.offline.code }

    public static let offline = APIError(
        status: 0, code: "offline",
        message: "Can’t reach the server. Check your connection and try again."
    )
    public static let timedOut = APIError(
        status: 408, code: "request_timeout",
        message: "The server didn’t respond in time. Try again."
    )
    public static let invalidResponse = APIError(
        status: 0, code: "invalid_response",
        message: "The server sent a response this app doesn’t understand."
    )

    /// The `{ "error": { … } }` envelope used by every Pulpo error response.
    struct Envelope: Decodable {
        struct Body: Decodable {
            let message: String?
            let code: String?
            let param: String?
        }
        let error: Body
    }

    static func from(status: Int, data: Data) -> APIError {
        if let envelope = try? JSONDecoder().decode(Envelope.self, from: data) {
            return APIError(
                status: status,
                code: envelope.error.code ?? "request_failed",
                message: envelope.error.message.flatMap { $0.isEmpty ? nil : $0 } ?? fallbackMessage(status),
                parameter: envelope.error.param
            )
        }
        return APIError(status: status, code: "request_failed", message: fallbackMessage(status))
    }

    static func from(transport error: Error) -> Error {
        if error is CancellationError { return error }
        guard let urlError = error as? URLError else { return error }
        switch urlError.code {
        case .cancelled: return CancellationError()
        case .timedOut: return timedOut
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost,
             .cannotFindHost, .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed:
            return offline
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot, .clientCertificateRejected:
            return APIError(status: 0, code: "tls", message: "A secure connection to the server couldn’t be established.")
        default:
            return APIError(status: 0, code: "network", message: urlError.localizedDescription)
        }
    }

    private static func fallbackMessage(_ status: Int) -> String {
        switch status {
        case 401: "Your session has ended. Sign in again."
        case 403: "You don’t have access to that."
        case 404: "That couldn’t be found. It may have been deleted."
        case 413: "That’s too large to send."
        case 429: "You’re going a little fast. Wait a moment and try again."
        case 500...599: "The server ran into a problem. Try again in a moment."
        default: "Something went wrong (\(status))."
        }
    }
}
