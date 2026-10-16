import KeyboardCore
import UIKit

/// Learns which app the person was typing in when the keyboard opened Pulpo Keyboard.
///
/// There is no public API for this (Apple DTS on FB22247647), and since iOS 26.4 the
/// keyboard extension can't see its host either. UIKit in the containing app still
/// receives the remote keyboard's source bundle in `_UIRemoteKeyboards.currentState`,
/// about a second after the keyboard opens the app. The value is transient, so it is
/// observed from launch rather than polled. Every hop is checked: if UIKit changes,
/// this stays inert and dictation falls back to asking the person to tap back.
final class HostAppObserver: NSObject {
  static let shared = HostAppObserver()

  private(set) var isAvailable = false
  private var remoteKeyboards: NSObject?
  private var latest: (bundle: String, at: Date)?
  private var waiters: [UUID: (since: Date, done: (String?) -> Void)] = [:]

  func start() {
    guard remoteKeyboards == nil, let type = NSClassFromString("_UIRemoteKeyboards") as? NSObject.Type else { return }
    let shared = NSSelectorFromString("sharedRemoteKeyboards")
    guard type.responds(to: shared), let instance = type.perform(shared)?.takeUnretainedValue() as? NSObject,
          instance.responds(to: NSSelectorFromString("currentState")) else { return }
    remoteKeyboards = instance
    instance.addObserver(self, forKeyPath: "currentState", options: [.new, .initial], context: nil)
    isAvailable = true
  }

  nonisolated override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?, context: UnsafeMutableRawPointer?) {
    // A cleared state is NSNull, which doesn't respond and reads as no host.
    let state = change?[.newKey] as? NSObject
    let selector = NSSelectorFromString("sourceBundleIdentifier")
    let bundle = state?.responds(to: selector) == true ? state?.perform(selector)?.takeUnretainedValue() as? String : nil
    DispatchQueue.main.async { MainActor.assumeIsolated { self.record(bundle) } }
  }

  private var loggedObservations = 0
  private let launchedAt = Date()

  private func record(_ raw: String?) {
    if loggedObservations < 12 {
      loggedObservations += 1
      Diagnostics.record("app", "host-observed", ["bundle": raw ?? "-", "sinceLaunchMs": Int(Date().timeIntervalSince(launchedAt) * 1000)])
    }
    guard let bundle = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !bundle.isEmpty,
          !HostReturn.isOwnApp(bundle) else { return }
    let now = Date()
    latest = (bundle, now)
    for (id, waiter) in waiters where now >= waiter.since {
      waiters.removeValue(forKey: id)
      waiter.done(bundle)
    }
  }

  /// Calls back with the host seen at or after `since`, or `nil` after `timeout`.
  func waitForHost(since: Date, timeout: TimeInterval, completion: @escaping (String?) -> Void) {
    if let latest, latest.at >= since {
      completion(latest.bundle)
      return
    }
    guard isAvailable else { return completion(nil) }
    let id = UUID()
    waiters[id] = (since, completion)
    DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in
      self?.waiters.removeValue(forKey: id)?.done(nil)
    }
  }
}

/// Sends the person back to the app they were dictating into.
enum HostReturn {
  struct App {
    let url: String
    let name: String
  }

  /// URL schemes that reopen an app where it was. Messages resumes the conversation
  /// with `ichat://`; `sms://` would open a new compose sheet.
  static let catalog: [String: App] = [
    "com.apple.MobileSMS": App(url: "ichat://", name: "Messages"),
    "com.apple.mobilenotes": App(url: "mobilenotes://", name: "Notes"),
    "com.apple.mobilemail": App(url: "message://", name: "Mail"),
    "com.apple.reminders": App(url: "x-apple-reminderkit://", name: "Reminders"),
    "com.whatsapp.WhatsApp": App(url: "whatsapp://send", name: "WhatsApp"),
    "net.whatsapp.WhatsApp": App(url: "whatsapp://send", name: "WhatsApp"),
    "ph.telegra.Telegraph": App(url: "tg://", name: "Telegram"),
    "org.whispersystems.signal": App(url: "sgnl://", name: "Signal"),
    "com.facebook.Messenger": App(url: "fb-messenger://", name: "Messenger"),
    "com.facebook.Facebook": App(url: "fb://", name: "Facebook"),
    "com.burbn.instagram": App(url: "instagram://", name: "Instagram"),
    "com.burbn.barcelona": App(url: "barcelona://", name: "Threads"),
    "com.atebits.Tweetie2": App(url: "twitter://", name: "X"),
    "com.tinyspeck.chatlyio": App(url: "slack://", name: "Slack"),
    "com.hammerandchisel.discord": App(url: "discord://", name: "Discord"),
    "com.microsoft.skype.teams": App(url: "msteams://", name: "Teams"),
    "com.google.Gmail": App(url: "googlegmail://", name: "Gmail"),
    "com.microsoft.Office.Outlook": App(url: "ms-outlook://", name: "Outlook"),
    "com.google.chrome.ios": App(url: "googlechrome://", name: "Chrome"),
    "com.openai.chat": App(url: "chatgpt://", name: "ChatGPT"),
    "notion.id": App(url: "notion://", name: "Notion"),
    "com.linkedin.LinkedIn": App(url: "linkedin://", name: "LinkedIn"),
    "com.reddit.Reddit": App(url: "reddit://", name: "Reddit"),
    "com.toyopagroup.picaboo": App(url: "snapchat://", name: "Snapchat"),
  ]

  static func isOwnApp(_ bundle: String) -> Bool {
    bundle.hasPrefix("com.isaacthoman.pulpo.keyboard")
  }

  enum Method: String {
    case workspace, urlScheme = "url-scheme", none
  }

  /// Reopens `bundle`. Tries LaunchServices first, which brings any app back exactly as
  /// it was, then a known URL scheme. Reports whether the app actually left the foreground.
  static func open(_ bundle: String, completion: @escaping (Method) -> Void) {
    if openWithWorkspace(bundle) {
      confirmLeft { left in
        if left { return completion(.workspace) }
        openScheme(bundle, completion: completion)
      }
      return
    }
    openScheme(bundle, completion: completion)
  }

  private static func openScheme(_ bundle: String, completion: @escaping (Method) -> Void) {
    guard let app = catalog[bundle], let url = URL(string: app.url) else { return completion(.none) }
    UIApplication.shared.open(url, options: [:]) { opened in completion(opened ? .urlScheme : .none) }
  }

  /// `LSApplicationWorkspace` is private; the call is skipped if it isn't there.
  private static func openWithWorkspace(_ bundle: String) -> Bool {
    guard let type = NSClassFromString("LSApplicationWorkspace") as? NSObject.Type else { return false }
    let defaultSelector = NSSelectorFromString("defaultWorkspace")
    guard type.responds(to: defaultSelector), let workspace = type.perform(defaultSelector)?.takeUnretainedValue() as? NSObject else { return false }
    let openSelector = NSSelectorFromString("openApplicationWithBundleID:")
    guard workspace.responds(to: openSelector) else { return false }
    typealias Open = @convention(c) (AnyObject, Selector, NSString) -> Bool
    return unsafeBitCast(workspace.method(for: openSelector), to: Open.self)(workspace, openSelector, bundle as NSString)
  }

  /// A successful switch sends this app to the background within a moment.
  private static func confirmLeft(_ completion: @escaping (Bool) -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
      completion(UIApplication.shared.applicationState != .active)
    }
  }

  static func name(for bundle: String) -> String? {
    catalog[bundle]?.name ?? (bundle == "com.apple.mobilesafari" ? "Safari" : bundle == "com.isaacthoman.pulpo" ? "Pulpo" : nil)
  }
}
