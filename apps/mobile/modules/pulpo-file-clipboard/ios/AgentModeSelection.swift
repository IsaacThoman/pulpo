// Native selection stays ahead of asynchronous JavaScript acknowledgements.
struct AgentModeSelection: Equatable {
  private(set) var scope = ""
  private(set) var enabled = false
  private(set) var revision = 0

  mutating func reconcile(enabled: Bool, scope: String, revision: Int) {
    if self.scope != scope {
      self.scope = scope
    } else if revision < self.revision {
      return
    }
    self.enabled = enabled
    self.revision = revision
  }

  mutating func select(_ enabled: Bool) -> Bool {
    guard self.enabled != enabled else { return false }
    self.enabled = enabled
    revision += 1
    return true
  }
}
