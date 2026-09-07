import ExpoModulesCore
import Foundation

public final class PulpoShortcutsModule: Module {
  private var navigationObserver: NSObjectProtocol?
  public func definition() -> ModuleDefinition {
    Name("PulpoShortcuts")
    Events("navigation")
    OnCreate { [weak self] in
      self?.navigationObserver = NotificationCenter.default.addObserver(forName: ShortcutNavigationInbox.changed, object: nil, queue: .main) { [weak self] _ in
        self?.sendEvent("navigation", [:])
      }
    }
    OnDestroy { [weak self] in
      if let observer = self?.navigationObserver { NotificationCenter.default.removeObserver(observer) }
    }
    Function("takePendingNavigation") { ShortcutNavigationInbox.takePending() }
    Function("setSession") { (origin: String?, userID: String?, token: String?) in
      do {
        if let origin, let userID, let token {
          try ShortcutSessionStore.save(ShortcutSession(origin: origin, userID: userID, token: token))
        } else {
          try ShortcutSessionStore.save(nil)
        }
      } catch {
        // Invalid replacement sessions must never leave the previous account usable.
        try? ShortcutSessionStore.save(nil)
        throw error
      }
    }
    Function("getScope") { try? ShortcutSessionStore.load().scope }
    Function("getEnabled") { ShortcutSessionStore.enabled }
    Function("setEnabled") { (enabled: Bool) in ShortcutSessionStore.setEnabled(enabled) }
  }
}
