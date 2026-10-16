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
  private let sessionStore: SessionStore
  private let accountDefaults: UserDefaults?
  private let accountURLSession: URLSession
  @ObservationIgnored private var accountGeneration = UUID()
  @ObservationIgnored private var signInAttempt: UUID?
  @ObservationIgnored private var latestRefresh: UUID?
  /// Optional diagnostic seam: event names only, never credentials or account contents.
  @ObservationIgnored var accountEvent: ((String) -> Void)?
  @ObservationIgnored private var appearanceObservers: [DarwinNotifications.Observation] = []

  static let setupGuideSeenKey = "setupGuideSeen"
  /// When the app last saw the installed keyboard appear without Full Access.
  static let limitedKeyboardSeenKey = "limitedKeyboardSeenAt"

  init(sessionStore: SessionStore = SessionStore(), accountDefaults: UserDefaults? = AppGroup.defaults,
       accountURLSession: URLSession = .shared, accountEvent: ((String) -> Void)? = nil) {
    self.accountEvent = accountEvent
    self.sessionStore = sessionStore
    self.accountDefaults = accountDefaults
    self.accountURLSession = accountURLSession
    Diagnostics.record("app", "launch")
    // Installed at launch: the host app's name arrives shortly after the keyboard opens us.
    HostAppObserver.shared.start()
    settings = SettingsStore().load()
    let stored = sessionStore.load()
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

  /// Authorize before launching a Task so a synchronous dismissal can revoke even unstarted work.
  func beginSignIn() -> UUID {
    let attempt = UUID()
    accountGeneration = UUID()
    signInAttempt = attempt
    return attempt
  }

  func cancelSignIn(_ attempt: UUID) {
    guard signInAttempt == attempt else { return }
    signInAttempt = nil
    accountGeneration = UUID()
  }

  func signIn(instance: String, email: String, password: String, twoFactorCode: String?, attempt: UUID? = nil) async throws {
    if Task.isCancelled {
      if let attempt { cancelSignIn(attempt) }
      throw CancellationError()
    }
    let attempt = attempt ?? beginSignIn()
    defer { if signInAttempt == attempt { signInAttempt = nil } }
    func checkAuthority() throws {
      try Task.checkCancellation()
      guard signInAttempt == attempt else { throw CancellationError() }
    }
    try checkAuthority()
    do {
      let url = try PulpoClient.normalizeInstance(instance, allowLocalhost: instanceAllowsLocalhost)
      let client = PulpoClient(instance: url, session: accountURLSession)
      let config = try await client.config()
      try checkAuthority()
      let label = "Pulpo Keyboard on \(UIDevice.current.name)"
      let response = try await client.login(email: email, password: password, twoFactorCode: twoFactorCode, deviceLabel: label)
      try checkAuthority()
      let stored = StoredSession(instance: url, token: response.session.token, user: response.user, dictationAvailable: config.capabilities.dictation)
      guard sessionStore.save(stored) else {
        throw PulpoError(status: 0, code: "session_storage", message: "Couldn't save your sign-in on this device. Try again.")
      }
      accountEvent?("save")
      // A recording/upload belongs to the session that started it, never its replacement.
      if dictation.phase != .idle || dictation.isEngineRunning { dictation.cancel() }
      accountGeneration = UUID()
      session = stored
      publishAccount()
    } catch {
      try checkAuthority()
      throw error
    }
  }

  /// Re-reads whether dictation is enabled on the instance and that the session still works.
  func refreshAccount() async {
    guard var current = session else { return }
    let generation = accountGeneration
    let beganDuringSignIn = signInAttempt != nil
    let refresh = UUID()
    latestRefresh = refresh
    func isAuthorized() -> Bool {
      !Task.isCancelled && !beganDuringSignIn && accountGeneration == generation && latestRefresh == refresh && signInAttempt == nil
        && session?.instance == current.instance && session?.token == current.token
    }
    let client = PulpoClient(instance: current.instance, token: current.token, session: accountURLSession)
    do {
      async let config = client.config()
      async let user = client.me()
      current.dictationAvailable = try await config.capabilities.dictation
      current.user = try await user
      guard isAuthorized(), sessionStore.save(current) else { return }
      accountEvent?("save")
      session = current
      publishAccount()
    } catch let error as PulpoError where error.isUnauthorized {
      guard isAuthorized() else { return }
      signOut(remote: false)
    } catch {
      // Offline: keep the cached account.
    }
  }

  func signOut(remote: Bool = true) {
    accountGeneration = UUID()
    signInAttempt = nil
    latestRefresh = nil
    if dictation.phase != .idle || dictation.isEngineRunning { dictation.cancel() }
    if remote, let current = session {
      let client = PulpoClient(instance: current.instance, token: current.token, session: accountURLSession)
      accountEvent?("logoutStarted")
      Task {
        defer { accountEvent?("logoutFinished") }
        try? await client.logout()
      }
    }
    sessionStore.clear()
    accountEvent?("clear")
    session = nil
    publishAccount()
  }

  private func publishAccount() {
    let snapshot = session.map {
      AccountSnapshot(signedIn: true, displayName: $0.user.name, instanceHost: $0.instance.host(), dictationAvailable: $0.dictationAvailable)
    } ?? .signedOut
    snapshot.save(defaults: accountDefaults)
    accountEvent?("publish")
  }

  // MARK: Learned words

  func clearLearnedWords() {
    PersonalDictionary(url: AppGroup.personalDictionaryURL(fallback: nil)).clear()
    let touch = TouchModel(url: AppGroup.touchModelURL(fallback: nil))
    touch.reset()
    touch.save()
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
