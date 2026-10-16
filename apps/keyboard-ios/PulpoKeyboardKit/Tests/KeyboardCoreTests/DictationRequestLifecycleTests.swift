import Foundation
import Testing
@testable import KeyboardCore

struct DictationRequestLifecycleTests {
  @Test func cancelledPermissionCannotStartTheMicrophone() {
    var lifecycle = DictationRequestLifecycle()
    let permissionCallback = lifecycle.start(UUID())
    lifecycle.cancel()
    #expect(lifecycle.beginRecording(permissionCallback) == false)
    #expect(lifecycle.fail(permissionCallback) == false)
    #expect(lifecycle.requestID == nil)
  }

  @Test func oldPermissionCannotStartOrFailANewerRequest() {
    var lifecycle = DictationRequestLifecycle()
    let old = lifecycle.start(UUID())
    let current = lifecycle.start(UUID())
    #expect(lifecycle.beginRecording(old) == false)
    #expect(lifecycle.fail(old) == false)
    #expect(lifecycle.beginRecording(current) == true)
    #expect(lifecycle.isCurrent(current, at: .recording))
  }

  @Test func retryingTheSameDeepLinkStillInvalidatesOldCallbacks() {
    var lifecycle = DictationRequestLifecycle()
    let requestID = UUID()
    let old = lifecycle.start(requestID)
    #expect(lifecycle.beginRecording(old) == true)
    #expect(lifecycle.beginTranscribing() == old)
    lifecycle.cancel()
    let retry = lifecycle.start(requestID)
    #expect(retry != old)
    #expect(lifecycle.finish(old) == false)
    #expect(lifecycle.beginRecording(old) == false)
    #expect(lifecycle.beginRecording(retry) == true)
    #expect(lifecycle.beginTranscribing() == retry)
    #expect(lifecycle.finish(retry) == true)
  }

  @Test func duplicatePermissionAndStopCannotStartTwoRecordingsOrUploads() {
    var lifecycle = DictationRequestLifecycle()
    let attempt = lifecycle.start(UUID())
    #expect(lifecycle.beginRecording(attempt) == true)
    #expect(lifecycle.beginRecording(attempt) == false)
    #expect(lifecycle.beginTranscribing() == attempt)
    #expect(lifecycle.beginTranscribing() == nil)
    #expect(lifecycle.beginRecording(attempt) == false)
  }

  @Test func cancelledUploadCannotPublishOrFail() {
    var lifecycle = DictationRequestLifecycle()
    let attempt = lifecycle.start(UUID())
    #expect(lifecycle.beginRecording(attempt) == true)
    #expect(lifecycle.beginTranscribing() == attempt)
    lifecycle.cancel()
    #expect(lifecycle.finish(attempt) == false)
    #expect(lifecycle.fail(attempt) == false)
    #expect(!lifecycle.isCurrent(attempt, at: .recording))
  }

  @Test func transcriptIsTerminalAndOnlyAcceptedAfterTranscribing() {
    var lifecycle = DictationRequestLifecycle()
    let attempt = lifecycle.start(UUID())
    #expect(lifecycle.finish(attempt) == false)
    #expect(lifecycle.beginRecording(attempt) == true)
    #expect(lifecycle.finish(attempt) == false)
    #expect(lifecycle.beginTranscribing() == attempt)
    #expect(lifecycle.finish(attempt) == true)
    #expect(lifecycle.finish(attempt) == false)
    #expect(lifecycle.fail(attempt) == false)
  }

  @Test func failedAttemptCannotResumeAfterDelayedPermission() {
    var lifecycle = DictationRequestLifecycle()
    let attempt = lifecycle.start(UUID())
    #expect(lifecycle.fail(attempt) == true)
    #expect(lifecycle.beginRecording(attempt) == false)
    #expect(lifecycle.beginTranscribing() == nil)
    #expect(lifecycle.finish(attempt) == false)
  }

  @Test func staleHostReturnCannotTakeOverANewerRecording() {
    var lifecycle = DictationRequestLifecycle()
    let old = lifecycle.start(UUID())
    #expect(lifecycle.beginRecording(old) == true)
    lifecycle.cancel()
    let current = lifecycle.start(UUID())
    #expect(lifecycle.beginRecording(current) == true)
    #expect(!lifecycle.isCurrent(old, at: .recording))
    #expect(lifecycle.isCurrent(current, at: .recording))
  }

  @Test func cancellationReplyStillMatchesTheWaitingKeyboard() {
    var lifecycle = DictationRequestLifecycle()
    let pendingRequest = UUID()
    let attempt = lifecycle.start(pendingRequest)
    lifecycle.cancel()
    #expect(lifecycle.requestID == nil)
    #expect(lifecycle.responseRequestID == pendingRequest)
    #expect(lifecycle.beginRecording(attempt) == false)
    // Standby publications and repeated cancellation must retain the reply ID.
    lifecycle.cancel()
    #expect(lifecycle.responseRequestID == pendingRequest)
    let retry = lifecycle.start(UUID())
    #expect(lifecycle.responseRequestID == retry.requestID)
    #expect(lifecycle.responseRequestID != pendingRequest)
  }
}
