import ExpoModulesCore

public final class PulpoShortcutsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PulpoShortcuts")
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
