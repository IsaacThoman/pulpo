import Foundation

// The wire format of apps/desktop/src/computer/control/protocol.ts: one JSON object per line on
// standard input, one answer per line on standard output.

typealias JSON = [String: Any]

/// An answer that is not a result. The codes are exactly the ones protocol.ts names.
struct ControlError: Error {
  let code: String
  let message: String

  static func permissionDenied(_ message: String) -> ControlError { ControlError(code: "permission_denied", message: message) }
  static func notFound(_ message: String) -> ControlError { ControlError(code: "not_found", message: message) }
  static func staleElement(_ message: String) -> ControlError { ControlError(code: "stale_element", message: message) }
  static func invalidRequest(_ message: String) -> ControlError { ControlError(code: "invalid_request", message: message) }
  static func unsupported(_ message: String) -> ControlError { ControlError(code: "unsupported", message: message) }
  static func failed(_ message: String) -> ControlError { ControlError(code: "failed", message: message) }
}

/// Standard output carries answers and nothing else. Frameworks sometimes print to it (a stray
/// `print`, a library's warning), so at start the real output is moved to a descriptor of its own
/// and descriptor 1 is pointed at standard error, where such text belongs.
final class Output {
  private let fd: Int32
  private let lock = NSLock()

  init() {
    fd = dup(STDOUT_FILENO)
    dup2(STDERR_FILENO, STDOUT_FILENO)
  }

  func send(_ answer: JSON) {
    var data: Data
    do {
      data = try JSONSerialization.data(withJSONObject: answer, options: [.withoutEscapingSlashes])
    } catch {
      // Only a value JSON cannot hold gets here (a NaN coordinate, say); the request still gets its answer.
      let fallback: JSON = ["id": answer["id"] ?? 0, "ok": false, "code": "failed", "message": "The answer could not be encoded."]
      data = (try? JSONSerialization.data(withJSONObject: fallback)) ?? Data()
    }
    data.append(0x0A)
    lock.lock()
    defer { lock.unlock() }
    data.withUnsafeBytes { (buffer: UnsafeRawBufferPointer) in
      var offset = 0
      while offset < buffer.count {
        let written = write(fd, buffer.baseAddress! + offset, buffer.count - offset)
        if written < 0 {
          if errno == EINTR { continue }
          // The main process is gone; there is nobody left to answer.
          _exit(0)
        }
        offset += written
      }
    }
  }
}

/// Logs to standard error, which the main process keeps as diagnostics.
func log(_ message: String) {
  FileHandle.standardError.write(Data("pulpo-control: \(message)\n".utf8))
}

extension Dictionary where Key == String, Value == Any {
  func int(_ key: String) -> Int? {
    guard let number = self[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    let value = number.doubleValue
    guard value.isFinite, value.rounded() == value, abs(value) < 1e15 else { return nil }
    return Int(value)
  }

  func double(_ key: String) -> Double? {
    guard let number = self[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    return number.doubleValue.isFinite ? number.doubleValue : nil
  }

  func string(_ key: String) -> String? { self[key] as? String }

  func bool(_ key: String) -> Bool? {
    guard let number = self[key] as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
  }

  func object(_ key: String) -> JSON? { self[key] as? JSON }

  func requireInt(_ key: String) throws -> Int {
    guard let value = int(key) else { throw ControlError.invalidRequest("`\(key)` must be a whole number.") }
    return value
  }

  func requireDouble(_ key: String) throws -> Double {
    guard let value = double(key) else { throw ControlError.invalidRequest("`\(key)` must be a number.") }
    return value
  }

  func requireString(_ key: String) throws -> String {
    guard let value = string(key) else { throw ControlError.invalidRequest("`\(key)` must be a string.") }
    return value
  }
}

/// How long a request may still run. A request that takes too long is answered with `failed` by the
/// dispatcher; long loops check `expired` so the abandoned work stops soon after instead of running on.
final class RequestContext: @unchecked Sendable {
  let deadline: Date
  private let lock = NSLock()
  private var abandoned = false

  init(timeout: TimeInterval) { deadline = Date().addingTimeInterval(timeout) }

  var expired: Bool {
    lock.lock()
    defer { lock.unlock() }
    return abandoned || Date() >= deadline
  }

  func abandon() {
    lock.lock()
    abandoned = true
    lock.unlock()
  }

  func check() throws {
    if expired { throw ControlError.failed("The request took too long.") }
  }
}
