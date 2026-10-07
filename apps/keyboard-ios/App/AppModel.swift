import KeyboardCore
import Observation
import PulpoServices
import SwiftUI
import UIKit

/// App-wide state: setup progress, account, settings, and deep links from the keyboard.
@Observable
final class AppModel {
  static let extensionIdentifier = "com.isaacthoman.pulpo.keyboard.extension"

  enum Route: Equatable {
    case setup, account, settings, dictation
  }

  var settings: KeyboardSettings { didSet { if settings != oldValue { settingsStore.save(settings) } } }
  private(set) var keyboardEnabled = false
  private(set) var fullAccess = false
  private(set) var session: StoredSession?
  var route: Route?
  let dictation: DictationService
  private let settingsStore = SettingsStore()
  private let sessionStore = SessionStore()

  init() {
    // Installed at launch: the host app's name arrives shortly after the keyboard opens us.
    HostAppObserver.shared.start()
    settings = SettingsStore().load()
    let stored = SessionStore().load()
    session = stored
    dictation = DictationService()
    dictation.sessionProvider = { [weak self] in self?.session }
    dictation.onUnauthorized = { [weak self] in self?.signOut(remote: false) }
    publishAccount()
    refreshStatus()
    #if DEBUG
    applyTestArguments()
    #endif
  }

  #if DEBUG
  /// Deterministic starting state for UI tests.
  private func applyTestArguments() {
    let arguments = ProcessInfo.processInfo.arguments
    if arguments.contains("-PKResetLearning") { clearLearnedWords() }
    if arguments.contains("-PKResetSettings") { settings = KeyboardSettings() }
    if arguments.contains("-PKSignOut") { signOut(remote: false) }
    AppGroup.defaults?.set(ProcessInfo.processInfo.environment["PK_DEBUG_POPUP"], forKey: "debugPopupKey")
    // PK_TEST_LOGIN=instance|email|password signs in through the real login request.
    if let login = ProcessInfo.processInfo.environment["PK_TEST_LOGIN"]?.split(separator: "|").map(String.init), login.count == 3 {
      Task { try? await signIn(instance: login[0], email: login[1], password: login[2], twoFactorCode: nil) }
    }
  }
  #endif

  // MARK: Setup status

  func refreshStatus() {
    let keyboards = UserDefaults.standard.object(forKey: "AppleKeyboards") as? [String] ?? []
    keyboardEnabled = keyboards.contains(Self.extensionIdentifier)
    if let heartbeat = KeyboardHeartbeat.load() {
      fullAccess = heartbeat.hasFullAccess && keyboardEnabled
    } else {
      fullAccess = false
    }
    settings = settingsStore.load()
  }

  var setupComplete: Bool { keyboardEnabled && fullAccess }

  func openSystemSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    UIApplication.shared.open(url)
  }

  // MARK: Account

  var instanceAllowsLocalhost: Bool {
    #if DEBUG
    true
    #else
    false
    #endif
  }

  func signIn(instance: String, email: String, password: String, twoFactorCode: String?) async throws {
    let url = try PulpoClient.normalizeInstance(instance, allowLocalhost: instanceAllowsLocalhost)
    let client = PulpoClient(instance: url)
    let config = try await client.config()
    let label = "Pulpo Keyboard on \(UIDevice.current.name)"
    let response = try await client.login(email: email, password: password, twoFactorCode: twoFactorCode, deviceLabel: label)
    let stored = StoredSession(instance: url, token: response.session.token, user: response.user, dictationAvailable: config.capabilities.dictation)
    sessionStore.save(stored)
    session = stored
    publishAccount()
  }

  /// Re-reads whether dictation is enabled on the instance and that the session still works.
  func refreshAccount() async {
    guard var current = session else { return }
    let client = PulpoClient(instance: current.instance, token: current.token)
    do {
      async let config = client.config()
      async let user = client.me()
      current.dictationAvailable = try await config.capabilities.dictation
      current.user = try await user
      sessionStore.save(current)
      session = current
      publishAccount()
    } catch let error as PulpoError where error.isUnauthorized {
      signOut(remote: false)
    } catch {
      // Offline: keep the cached account.
    }
  }

  func signOut(remote: Bool = true) {
    if remote, let current = session {
      let client = PulpoClient(instance: current.instance, token: current.token)
      Task { try? await client.logout() }
    }
    sessionStore.clear()
    session = nil
    publishAccount()
  }

  private func publishAccount() {
    let snapshot = session.map {
      AccountSnapshot(signedIn: true, displayName: $0.user.name, instanceHost: $0.instance.host(), dictationAvailable: $0.dictationAvailable)
    } ?? .signedOut
    snapshot.save()
  }

  // MARK: Learned words

  func clearLearnedWords() {
    PersonalDictionary(url: AppGroup.personalDictionaryURL(fallback: nil)).clear()
  }

  // MARK: Deep links

  func handle(_ url: URL) {
    guard url.scheme == AppGroup.urlScheme else { return }
    switch url.host() {
    case "dictate":
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
      let request = items.first { $0.name == "request" }?.value.flatMap(UUID.init(uuidString:))
      let host = items.first { $0.name == "host" }?.value
      route = .dictation
      if let request { dictation.start(request: request, fromURL: true, host: host) }
    case "account":
      route = .account
    case "settings":
      route = .settings
    default:
      route = .setup
    }
  }
}
