import Foundation
import PulpoShortcutsCore

// Run only against the repository's explicitly disposable queue fixture.
@main struct ShortcutsAcceptance {
  static func main() async throws {
    guard ProcessInfo.processInfo.environment["PULPO_SHORTCUTS_ACCEPTANCE"] == "1" else {
      throw ShortcutFailure("Start the disposable queue fixture, then set PULPO_SHORTCUTS_ACCEPTANCE=1.")
    }
    var request = URLRequest(url: URL(string: "http://localhost:8091/api/mobile/auth/login")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["email": "queue@example.test", "password": "Queue-test-only-2026", "deviceLabel": "Shortcuts acceptance", "appType": "mobile", "platform": "ios"])
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw ShortcutFailure("Fixture login failed.") }
    struct Login: Decodable {
      let user: User
      let session: Session
      struct User: Decodable { let id: String }
      struct Session: Decodable { let token: String }
    }
    let login = try JSONDecoder().decode(Login.self, from: data)
    let session = try ShortcutSession(origin: "http://localhost:8091", userID: login.user.id, token: login.session.token)
    let api = ShortcutsAPI(session: session, assertCurrent: { _ in })
    let models = try await api.models()
    guard let model = models.first(where: { $0.id == "queue-test" }) else { throw ShortcutFailure("Seed the queue fixture first.") }
    let prompt = "Shortcuts acceptance \(UUID().uuidString)"
    let (chat, snapshot) = try await api.start(prompt: prompt, modelEntityID: session.entityID(model.id))
    let reply = try await api.waitForReply(snapshot)
    guard reply == "Completed: \(prompt)" else { throw ShortcutFailure("Unexpected fixture reply.") }
    let selectedID = session.entityID(chat.id)
    guard try await api.latestReply(selectedID) == reply else { throw ShortcutFailure("Get Reply failed.") }
    let continuation = try await api.continueChat(selectedID, prompt: "Shortcuts follow-up")
    guard try await api.waitForReply(continuation) == "Completed: Shortcuts follow-up" else { throw ShortcutFailure("Continue Chat failed.") }
    guard try await api.chats(query: prompt, limit: 50).contains(where: { $0.id == chat.id }) else { throw ShortcutFailure("Search did not find the new chat.") }
    let (temporary, temporarySnapshot) = try await api.start(prompt: "Shortcuts private acceptance", modelEntityID: session.entityID(model.id), temporary: true)
    _ = try await api.waitForReply(temporarySnapshot)
    guard try await !api.chats().contains(where: { $0.id == temporary.id }) else { throw ShortcutFailure("Temporary chat appeared in history.") }
    do { _ = try await api.chat(session.entityID(temporary.id)); throw ShortcutFailure("Temporary chat entity was accepted.") }
    catch let error as ShortcutFailure where error.message.contains("Temporary chats") {}
    print("PASS: model catalog, atomic start, reply polling, active-branch continuation, latest reply, full-text search, and temporary-chat exclusion.")
    print("Fixture chat: \(chat.id)")
    request.url = URL(string: "http://localhost:8091/api/mobile/auth/logout")!
    request.httpBody = nil
    request.setValue("Bearer \(session.token)", forHTTPHeaderField: "Authorization")
    _ = try await URLSession.shared.data(for: request)
    do { _ = try await api.models(); throw ShortcutFailure("Revoked session was accepted.") }
    catch let error as ShortcutFailure where error.message.contains("expired") {}
    print("PASS: revoked session rejected. No credentials were written to disk.")
  }
}
