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

  /// Full Access as far as the app can tell. iOS doesn't tell the app, so it is
  /// learned from the installed keyboard, which has to have appeared once.
  enum FullAccessState: Equatable {
    case unknown, on, off
  }

  /// What the person came back to after setup sent them to Settings.
  enum SettingsReturn: Equatable {
    case pending, keyboardMissing, fullAccessUnconfirmed
  }

  var settings: KeyboardSettings { didSet { if settings != oldValue { settingsStore.save(settings) } } }
  private(set) var keyboardEnabled = false
  private(set) var fullAccessState = FullAccessState.unknown
  /// Whether the installed keyboard has appeared in a text field since setup started.
  private(set) var keyboardSeen = false
  private(set) var settingsReturn: SettingsReturn?
  private(set) var session: StoredSession?
  var route: Route?
  /// The step-by-step setup guide, shown on first launch until it's finished or skipped.
  var showSetupGuide = false {
    didSet { if oldValue, !showSetupGuide { UserDefaults.standard.set(true, forKey: Self.setupGuideSeenKey) } }
  }
  let dictation: DictationService
  private let settingsStore = SettingsStore()
  private let sessionStore = SessionStore()
  @ObservationIgnored private var appearanceObservers: [DarwinNotifications.Observation] = []

  static let setupGuideSeenKey = "setupGuideSeen"
  /// When the app last saw the installed keyboard appear without Full Access.
  static let limitedKeyboardSeenKey = "limitedKeyboardSeenAt"

  init() {
    Diagnostics.record("app", "launch")
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
    observeKeyboardAppearances()
    #if DEBUG
    applyTestArguments()
    #endif
    showSetupGuide = !UserDefaults.standard.bool(forKey: Self.setupGuideSeenKey) && !setupComplete && !Self.suppressesSetupGuide
  }

  /// UI tests launch straight into a screen; only `-PKOnboarding` asks for the guide.
  private static var suppressesSetupGuide: Bool {
    #if DEBUG
    let arguments = ProcessInfo.processInfo.arguments
    if arguments.contains("-PKOnboarding") { return false }
    return arguments.contains { $0.hasPrefix("-PK") }
    #else
    false
    #endif
  }

  #if DEBUG
  /// Deterministic starting state for UI tests.
  private func applyTestArguments() {
    let arguments = ProcessInfo.processInfo.arguments
    if arguments.contains("-PKResetLearning") { clearLearnedWords() }
    if arguments.contains("-PKResetSettings") {
      settings = KeyboardSettings()
      OneHandedStore(defaults: AppGroup.defaults).save(.off)
    }
    // -PKOneHanded left|right docks the keyboard for one-handed UI tests.
    if let flag = arguments.firstIndex(of: "-PKOneHanded"), arguments.indices.contains(flag + 1),
       let mode = OneHandedMode(rawValue: arguments[flag + 1]) {
      OneHandedStore(defaults: AppGroup.defaults).save(mode)
    }
    if arguments.contains("-PKSignOut") { signOut(remote: false) }
    // -PKOnboarding starts setup over: the guide unseen and the keyboard never observed.
    if arguments.contains("-PKOnboarding") {
      UserDefaults.standard.removeObject(forKey: Self.setupGuideSeenKey)
      UserDefaults.standard.removeObject(forKey: Self.limitedKeyboardSeenKey)
      KeyboardHeartbeat.clear()
      refreshStatus()
    }
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
    let heartbeat = KeyboardHeartbeat.load()
    let limitedSeenAt = UserDefaults.standard.object(forKey: Self.limitedKeyboardSeenKey) as? Date
    keyboardSeen = keyboardEnabled && (heartbeat != nil || limitedSeenAt != nil)
    if !keyboardEnabled {
      fullAccessState = .unknown
    } else {
      switch KeyboardHeartbeat.fullAccess(heartbeat: heartbeat, limitedSeenAt: limitedSeenAt) {
      case true?: fullAccessState = .on
      case false?: fullAccessState = .off
      case nil: fullAccessState = .unknown
      }
    }
    if settingsReturn != nil {
      settingsReturn = !keyboardEnabled ? .keyboardMissing : fullAccessState == .on ? nil : .fullAccessUnconfirmed
    }
    settings = settingsStore.load()
  }

  var fullAccess: Bool { fullAccessState == .on }
  var setupComplete: Bool { keyboardEnabled && fullAccess }

  /// Opens this app's page in Settings, which lists Keyboards once the extension is installed.
  func openSystemSettings() {
    guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
    settingsReturn = .pending
    UIApplication.shared.open(url)
  }

  /// The installed keyboard announces itself each time it appears, which confirms
  /// setup live while the guide or Try It is on screen.
  private func observeKeyboardAppearances() {
    appearanceObservers = [true, false].map { full in
      DarwinNotifications.observe(KeyboardHeartbeat.appearedNotification(fullAccess: full)) { [weak self] in
        MainActor.assumeIsolated { self?.keyboardAppeared(fullAccess: full) }
      }
    }
  }

  private func keyboardAppeared(fullAccess: Bool) {
    if fullAccess {
      // Recorded here too, so the result doesn't wait on the keyboard's own write.
      KeyboardHeartbeat.record(hasFullAccess: true)
      UserDefaults.standard.removeObject(forKey: Self.limitedKeyboardSeenKey)
    } else {
      UserDefaults.standard.set(Date(), forKey: Self.limitedKeyboardSeenKey)
    }
    refreshStatus()
  }

  // MARK: Settings

  func resetSettings() {
    settings = KeyboardSettings()
    OneHandedStore(defaults: AppGroup.defaults).save(.off)
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

  var learningResetError: String?

  @discardableResult
  func clearLearnedWords() -> Bool {
    let result = LearnedDataPersistence.clear(
      dictionaryURL: AppGroup.personalDictionaryURL(fallback: nil),
      touchURL: AppGroup.touchModelURL(fallback: nil)
    )
    learningResetError = result == .ok ? nil : "Couldn’t clear learned words. Please try again."
    return result == .ok
  }

  // MARK: Deep links

  func handle(_ url: URL) {
    guard url.scheme == AppGroup.urlScheme else { return }
    switch url.host() {
    case "dictate":
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
      let request = items.first { $0.name == "request" }?.value.flatMap(UUID.init(uuidString:))
      let host = items.first { $0.name == "host" }?.value
      // The recorder and sign-in are presented over the home screen, not the guide.
      showSetupGuide = false
      route = .dictation
      if let request { dictation.start(request: request, fromURL: true, host: host) }
    case "account":
      showSetupGuide = false
      route = .account
    case "settings":
      route = .settings
    default:
      // The keyboard sends people here when Full Access is missing.
      route = .setup
      showSetupGuide = true
    }
  }
}
