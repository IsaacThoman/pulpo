import Foundation

public struct PulpoUser: Codable, Equatable, Sendable {
  public let id: String
  public let name: String
  public let email: String?
  public let role: String?
  /// Account balance in millionths of a dollar; dictation is billed against it.
  public let balanceMicros: Int?

  public var balance: Decimal? { balanceMicros.map { Decimal($0) / 1_000_000 } }
}

public struct PulpoConfig: Decodable, Equatable, Sendable {
  public struct Instance: Decodable, Equatable, Sendable {
    public let name: String
  }

  public struct Capabilities: Decodable, Equatable, Sendable {
    public let dictation: Bool
  }

  public let instance: Instance
  public let capabilities: Capabilities
}

public struct PulpoSession: Codable, Equatable, Sendable {
  public let token: String
  public let expiresAt: String
}

public struct PulpoAuthResponse: Decodable, Sendable {
  public let user: PulpoUser
  public let session: PulpoSession
}

public struct PulpoError: Error, Equatable, LocalizedError, Sendable {
  public let status: Int
  public let code: String
  public let message: String

  public var errorDescription: String? { message }
  public var isUnauthorized: Bool { status == 401 && code != "two_factor_required" }
  public var needsTwoFactor: Bool { code == "two_factor_required" }

  public static func network(_ error: Error) -> PulpoError {
    PulpoError(status: 0, code: "network", message: "Couldn't reach Pulpo. Check your connection and try again.")
  }
}

/// The handful of Pulpo endpoints the keyboard app uses.
public struct PulpoClient: Sendable {
  public static let defaultInstance = URL(string: "https://pulpo.baby")!
  public let instance: URL
  public let token: String?
  let session: URLSession

  public init(instance: URL, token: String? = nil, session: URLSession = .shared) {
    self.instance = instance
    self.token = token
    self.session = session
  }

  /// Mirrors the web client's rules: HTTPS only, except plain-HTTP localhost in development.
  public static func normalizeInstance(_ value: String, allowLocalhost: Bool) throws -> URL {
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    let withScheme = trimmed.range(of: "^[a-zA-Z][a-zA-Z0-9+.-]*://", options: .regularExpression) != nil ? trimmed : "https://" + trimmed
    guard var components = URLComponents(string: withScheme), let host = components.host, !host.isEmpty else {
      throw PulpoError(status: 0, code: "invalid_instance", message: "Enter a valid Pulpo address.")
    }
    let local = ["localhost", "127.0.0.1", "::1"].contains(host)
    guard components.scheme == "https" || (allowLocalhost && local && components.scheme == "http") else {
      throw PulpoError(status: 0, code: "invalid_instance", message: "Pulpo addresses must use HTTPS.")
    }
    guard components.user == nil, components.password == nil, components.query == nil, components.fragment == nil else {
      throw PulpoError(status: 0, code: "invalid_instance", message: "Enter the Pulpo address only.")
    }
    while components.path.hasSuffix("/") { components.path.removeLast() }
    guard let url = components.url else { throw PulpoError(status: 0, code: "invalid_instance", message: "Enter a valid Pulpo address.") }
    return url
  }

  func request(_ path: String, method: String = "GET") -> URLRequest {
    var request = URLRequest(url: instance.appendingPathComponent(path))
    request.httpMethod = method
    request.setValue("application/json", forHTTPHeaderField: "accept")
    if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization") }
    return request
  }

  func send<Response: Decodable>(_ request: URLRequest, as type: Response.Type) async throws -> Response {
    let (data, response) = try await perform(request)
    do {
      return try JSONDecoder().decode(Response.self, from: data)
    } catch {
      throw PulpoError(status: (response as? HTTPURLResponse)?.statusCode ?? 0, code: "invalid_response", message: "Pulpo sent an unexpected response.")
    }
  }

  func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw PulpoError.network(error)
    }
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else { throw Self.error(status: status, data: data) }
    return (data, response)
  }

  static func error(status: Int, data: Data) -> PulpoError {
    struct Envelope: Decodable {
      struct Body: Decodable {
        let message: String?
        let code: String?
      }
      let error: Body
    }
    let body = try? JSONDecoder().decode(Envelope.self, from: data).error
    return PulpoError(status: status, code: body?.code ?? "http_\(status)", message: body?.message ?? "Pulpo returned an error (\(status)).")
  }

  public func config() async throws -> PulpoConfig {
    try await send(request("api/mobile/config"), as: PulpoConfig.self)
  }

  public func login(email: String, password: String, twoFactorCode: String?, deviceLabel: String) async throws -> PulpoAuthResponse {
    var request = request("api/mobile/auth/login", method: "POST")
    var body: [String: String] = ["email": email, "password": password, "deviceLabel": deviceLabel, "appType": "mobile", "platform": "ios"]
    if let twoFactorCode, !twoFactorCode.isEmpty { body["twoFactorCode"] = twoFactorCode }
    request.setValue("application/json", forHTTPHeaderField: "content-type")
    request.httpBody = try JSONEncoder().encode(body)
    return try await send(request, as: PulpoAuthResponse.self)
  }

  public func me() async throws -> PulpoUser {
    struct Response: Decodable { let user: PulpoUser }
    return try await send(request("api/mobile/me"), as: Response.self).user
  }

  public func logout() async throws {
    _ = try await perform(request("api/mobile/auth/logout", method: "POST"))
  }

  /// Uploads a finished recording to Pulpo dictation and returns the transcript.
  public func transcribe(audio: Data, filename: String = "dictation.m4a", mimeType: String = "audio/mp4") async throws -> String {
    struct Response: Decodable { let text: String }
    let boundary = "PulpoKeyboard-\(UUID().uuidString)"
    var request = request("api/dictation/transcriptions", method: "POST")
    request.timeoutInterval = 45
    request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")
    var body = Data()
    body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\nContent-Type: \(mimeType)\r\n\r\n".utf8))
    body.append(audio)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    request.httpBody = body
    return try await send(request, as: Response.self).text
  }
}
