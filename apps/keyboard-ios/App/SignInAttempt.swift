import Foundation
import Observation
import PulpoServices

/// Owns one sheet's work and UI feedback, including the interval before its Task starts.
@Observable
final class SignInAttempt {
  var instance = PulpoClient.defaultInstance.host() ?? "pulpo.baby" {
    didSet { if instance != oldValue { resetChallenge() } }
  }
  var email = "" { didSet { if email != oldValue { resetChallenge() } } }
  var password = "" { didSet { if password != oldValue { resetChallenge() } } }
  var code = ""
  private(set) var needsCode = false
  private(set) var working = false
  private(set) var error: String?
  @ObservationIgnored private var task: Task<Void, Never>?
  @ObservationIgnored private var authorization: UUID?
  @ObservationIgnored private weak var model: AppModel?

  func submit(using model: AppModel, onSuccess: @escaping () -> Void) {
    revoke()
    let authorization = model.beginSignIn()
    self.authorization = authorization
    self.model = model
    let instance = instance, email = email, password = password
    let code = needsCode ? code : nil
    working = true
    error = nil
    task = Task {
      defer {
        if self.authorization == authorization {
          self.working = false
          self.task = nil
        }
      }
      do {
        try await model.signIn(instance: instance, email: email, password: password, twoFactorCode: code, attempt: authorization)
        guard self.authorization == authorization, !Task.isCancelled else { return }
        onSuccess()
      } catch {
        guard self.authorization == authorization, !Task.isCancelled, !(error is CancellationError) else { return }
        if let failure = error as? PulpoError, failure.needsTwoFactor {
          // A challenge is usable only with the credentials/server that produced it.
          guard self.instance == instance, self.email == email, self.password == password else { return }
          self.needsCode = true
          self.error = code?.isEmpty == false ? failure.message : nil
        } else {
          self.error = error.localizedDescription
        }
      }
    }
  }

  func cancel() {
    revoke()
    working = false
    resetChallenge()
  }

  func backToCredentials() { cancel() }

  private func revoke() {
    if let authorization { model?.cancelSignIn(authorization) }
    authorization = nil
    task?.cancel()
    task = nil
  }

  private func resetChallenge() {
    needsCode = false
    code = ""
    error = nil
  }
}
