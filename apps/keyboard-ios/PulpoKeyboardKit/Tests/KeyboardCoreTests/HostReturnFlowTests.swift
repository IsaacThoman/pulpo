import Foundation
import Testing
@testable import KeyboardCore

@MainActor
struct HostReturnFlowTests {
  @Test func cancellationBeforeOpeningHasNoSideEffects() {
    let host = Host()
    host.lifecycle.cancel()
    host.open()
    #expect(host.events.isEmpty)
    #expect(host.confirmation == nil)
  }

  @Test func cancellationDuringWorkspaceConfirmationCannotOpenFallback() {
    let host = Host()
    host.open()
    #expect(host.events == ["workspace"])
    host.lifecycle.cancel()
    host.confirmation?(false)
    #expect(host.events == ["workspace"])
    #expect(host.results.isEmpty)
  }

  @Test func reusedRequestIDCannotAuthorizeAnOldFallback() {
    let host = Host()
    host.open()
    let replacement = host.lifecycle.start(host.attempt.requestID)
    #expect(host.lifecycle.beginRecording(replacement) == true)
    host.confirmation?(false)
    #expect(host.events == ["workspace"])
    #expect(host.results.isEmpty)
  }

  @Test func stoppingRecordingCannotAuthorizeAnOldFallback() {
    let host = Host()
    host.open()
    #expect(host.lifecycle.beginTranscribing() == host.attempt)
    host.confirmation?(false)
    #expect(host.events == ["workspace"])
    #expect(host.results.isEmpty)
  }

  @Test func cancellationSuppressesAnAlreadyIssuedSchemeCompletion() {
    let host = Host()
    host.open(workspaceAvailable: false)
    #expect(host.events == ["workspace", "scheme"])
    host.lifecycle.cancel()
    host.schemeCompletion?(true)
    #expect(host.results.isEmpty)
  }

  @Test func currentAttemptCanUseDeferredFallback() {
    let host = Host()
    host.open()
    host.confirmation?(false)
    #expect(host.events == ["workspace", "scheme"])
    host.schemeCompletion?(true)
    #expect(host.results == [.urlScheme])
  }

  @Test func confirmedWorkspaceDoesNotOpenScheme() {
    let host = Host()
    host.open()
    host.confirmation?(true)
    #expect(host.events == ["workspace"])
    #expect(host.results == [.workspace])
  }

  @Test func unavailableOpenReportsFailureForCurrentAttempt() {
    let host = Host()
    host.open(workspaceAvailable: false)
    host.schemeCompletion?(false)
    #expect(host.events == ["workspace", "scheme"])
    #expect(host.results == [.none])
  }

  @MainActor private final class Host {
    var lifecycle = DictationRequestLifecycle()
    let attempt: DictationRequestLifecycle.Attempt
    var events: [String] = []
    var results: [HostReturnFlow.Method] = []
    var confirmation: ((Bool) -> Void)?
    var schemeCompletion: ((Bool) -> Void)?

    init() {
      attempt = lifecycle.start(UUID())
      _ = lifecycle.beginRecording(attempt)
    }

    func open(workspaceAvailable: Bool = true) {
      HostReturnFlow.open(
        isAuthorized: { self.lifecycle.isCurrent(self.attempt, at: .recording) },
        openWorkspace: { self.events.append("workspace"); return workspaceAvailable },
        confirmLeft: { self.confirmation = $0 },
        openScheme: { self.events.append("scheme"); self.schemeCompletion = $0 },
        completion: { self.results.append($0) }
      )
    }
  }
}
