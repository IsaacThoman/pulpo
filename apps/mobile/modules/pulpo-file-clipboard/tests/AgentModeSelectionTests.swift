@main
struct AgentModeSelectionTests {
  static func main() {
    var selection = AgentModeSelection()
    selection.reconcile(enabled: true, scope: "chat-a", revision: 0)
    assert(selection.select(false))
    assert(!selection.enabled && selection.revision == 1)

    // An unrelated chat render cannot undo a tap while JavaScript is busy.
    selection.reconcile(enabled: true, scope: "chat-a", revision: 0)
    assert(!selection.enabled && selection.revision == 1)

    // Two native taps are preserved even if only the first has been acknowledged.
    assert(selection.select(true))
    selection.reconcile(enabled: false, scope: "chat-a", revision: 1)
    assert(selection.enabled && selection.revision == 2)
    selection.reconcile(enabled: true, scope: "chat-a", revision: 2)
    assert(selection.enabled)
    assert(!selection.select(true))
    assert(selection.revision == 2)

    // Once acknowledged, restoring a draft may change the selection externally.
    selection.reconcile(enabled: false, scope: "chat-a", revision: 2)
    assert(!selection.enabled)

    // A different composer starts a fresh sequence and accepts its own draft.
    selection.reconcile(enabled: true, scope: "chat-b", revision: 0)
    assert(selection.enabled && selection.scope == "chat-b" && selection.revision == 0)
    print("Agent mode selection checks passed")
  }
}
