import Foundation

/// Authorizes asynchronous recorder callbacks for one attempt, rather than just
/// a request ID. A cancelled attempt cannot revive when permission or an upload
/// replies, even if a deep link retries the same request ID.
public struct DictationRequestLifecycle: Sendable {
  public struct Attempt: Equatable, Sendable {
    public let requestID: UUID
    fileprivate let generation = UUID()
  }

  public enum Stage: Sendable {
    case preparing, recording, transcribing, finished, failed
  }

  public private(set) var attempt: Attempt?
  public private(set) var stage: Stage?
  public var requestID: UUID? { attempt?.requestID }
  private var cancelledRequestID: UUID?
  /// An idle cancellation reply must still name the request the keyboard is
  /// waiting for. This identity grants no permission to asynchronous callbacks.
  public var responseRequestID: UUID? { requestID ?? cancelledRequestID }

  public init() {}

  @discardableResult
  public mutating func start(_ requestID: UUID) -> Attempt {
    let attempt = Attempt(requestID: requestID)
    self.attempt = attempt
    cancelledRequestID = nil
    stage = .preparing
    return attempt
  }

  public func isCurrent(_ attempt: Attempt, at stage: Stage) -> Bool {
    self.attempt == attempt && self.stage == stage
  }

  public mutating func beginRecording(_ attempt: Attempt) -> Bool {
    guard isCurrent(attempt, at: .preparing) else { return false }
    stage = .recording
    return true
  }

  public mutating func beginTranscribing() -> Attempt? {
    guard stage == .recording, let attempt else { return nil }
    stage = .transcribing
    return attempt
  }

  public mutating func finish(_ attempt: Attempt) -> Bool {
    guard isCurrent(attempt, at: .transcribing) else { return false }
    stage = .finished
    return true
  }

  public mutating func fail(_ attempt: Attempt) -> Bool {
    guard self.attempt == attempt, stage != .finished, stage != .failed else { return false }
    stage = .failed
    return true
  }

  public mutating func cancel() {
    cancelledRequestID = requestID ?? cancelledRequestID
    attempt = nil
    stage = nil
  }
}
