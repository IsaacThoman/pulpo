import Foundation
import PulpoKit
import Testing
@testable import Pulpo

/// Polls `condition` on the main actor until it holds or `timeout` passes.
@MainActor
func eventually(timeout: Duration = .seconds(5), _ condition: @MainActor () -> Bool) async -> Bool {
    let deadline = ContinuousClock.now + timeout
    while ContinuousClock.now < deadline {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(20))
    }
    return condition()
}

@MainActor
func signedInApp(_ server: MockServer = MockServer()) async throws -> (AppModel, LibraryModel, MockServer) {
    Preferences.store = UserDefaults(suiteName: "PulpoTVTests-\(UUID().uuidString)")!
    server.wordDelay = .milliseconds(2)
    let app = AppModel(environment: server.environment(signedIn: true))
    await app.launch()
    let library = try #require(app.library)
    await library.refreshAll()
    return (app, library, server)
}

@Suite("App model", .serialized)
@MainActor
struct AppModelTests {
    @Test func startsSignedOutWithoutAStoredSession() async {
        let app = AppModel(environment: MockServer().environment(signedIn: false))
        await app.launch()
        #expect(app.phase == .signedOut)
        #expect(app.library == nil)
    }

    @Test func restoresAStoredSession() async throws {
        let (app, library, _) = try await signedInApp()
        #expect(app.phase == .signedIn)
        #expect(app.user?.email == "ada@pulpo.test")
        #expect(library.chats.count == 7)
        #expect(library.models.map(\.id) == ["gpt-5.6-luna", "claude-opus", "gemini-pro"])
        #expect(library.defaultModel?.id == "gpt-5.6-luna")
        #expect(library.suggestions.count == 4)
        #expect(await eventually { app.isRealtimeConnected })
    }

    @Test func signsOutWhenTheServerEndsTheSession() async throws {
        let (app, _, server) = try await signedInApp()
        server.revokeSessions()
        await app.refreshUser()
        #expect(app.phase == .signedOut)
        #expect(app.signedOutNotice?.contains("session has ended") == true)
        #expect(app.environment.sessionStore.load() == nil)
    }

    @Test func confirmsAnUnauthorizedResponseBeforeSigningOut() async throws {
        let (app, _, server) = try await signedInApp()
        // A stray 401 from one request while the session is still valid.
        server.failNext("/api/chats", status: 401, code: "unauthorized", message: "Authentication required")
        await app.library?.refreshChats()
        #expect(app.phase == .signedIn)
        server.revokeSessions()
        await app.library?.refreshChats()
        #expect(await eventually { app.phase == .signedOut })
    }

    @Test func checksTheSessionWhenTheSocketRejectsIt() async throws {
        let (app, _, server) = try await signedInApp()
        #expect(await eventually { app.isRealtimeConnected })
        // Let the refresh that follows the connection settle, so only the
        // socket can notice the revoked session.
        try await Task.sleep(for: .milliseconds(600))
        let before = server.requests.count
        server.revokeSessions()
        server.realtime.emit(.unauthorized)
        #expect(await eventually { app.phase == .signedOut })
        #expect(server.requests.dropFirst(before).allSatisfy { $0 == "GET /api/mobile/me" })
        #expect(app.signedOutNotice?.contains("session has ended") == true)
    }

    @Test func picksUpSettingsChangedOnAnotherDevice() async throws {
        let (app, library, server) = try await signedInApp()
        #expect(await eventually { app.isRealtimeConnected })
        #expect(library.defaultModel?.id == "gpt-5.6-luna")
        server.changeSettingsElsewhere(defaultModelId: "claude-opus")
        #expect(await eventually { library.defaultModel?.id == "claude-opus" })
    }

    @Test func signOutRevokesTheTokenAndForgetsIt() async throws {
        let (app, _, server) = try await signedInApp()
        await app.signOut()
        #expect(app.phase == .signedOut)
        #expect(app.session == nil)
        #expect(app.environment.sessionStore.load() == nil)
        #expect(server.requests.contains("POST /api/mobile/auth/logout"))
    }
}

@Suite("Sign in", .serialized)
@MainActor
struct SignInModelTests {
    init() {
        // Each test remembers servers and emails in its own defaults.
        Preferences.store = UserDefaults(suiteName: "PulpoTVTests-\(UUID().uuidString)")!
    }

    @Test func rejectsAWrongPassword() async {
        let server = MockServer()
        let environment = server.environment(signedIn: false)
        let app = AppModel(environment: environment)
        let model = SignInModel(environment: environment)
        model.email = "ada@pulpo.test"
        model.password = "nope"
        await model.submitCredentials(app: app)
        #expect(model.error == "That email and password don’t match an account on \(server.address.displayName).")
        #expect(app.phase != .signedIn)
    }

    @Test func completesTwoFactorSignIn() async {
        let environment = MockServer().environment(signedIn: false)
        let app = AppModel(environment: environment)
        await app.launch()
        let model = SignInModel(environment: environment)
        #expect(!model.canSubmitCredentials)
        model.email = "grace@pulpo.test"
        model.password = "pulpo-tv"
        await model.submitCredentials(app: app)
        #expect(model.step == .twoFactor)
        #expect(model.error == nil)

        model.code = "000000"
        await model.submitCode(app: app)
        #expect(model.error?.hasPrefix("That code didn’t work") == true)
        #expect(model.code.isEmpty)

        model.code = "123456"
        await model.submitCode(app: app)
        #expect(app.phase == .signedIn)
        #expect(model.password.isEmpty)
        #expect(environment.sessionStore.load()?.token == MockServer.token)
    }

    @Test func validatesCustomServers() async {
        let environment = MockServer().environment(signedIn: false)
        let model = SignInModel(environment: environment)
        model.showServerStep()
        #expect(model.step == .server)

        model.serverInput = "ftp://nope"
        await model.submitServer()
        #expect(model.error == ServerAddress.ValidationError.invalid.errorDescription)
        #expect(model.step == .server)

        let other = MockServer()
        model.serverInput = other.address.url.absoluteString
        await model.submitServer()
        #expect(model.error == nil)
        #expect(model.step == .credentials)
        #expect(model.server == other.address)
        #expect(model.instanceName == "Pulpo")
    }

    @Test func reportsServersThatDoNotAnswer() async {
        let environment = MockServer().environment(signedIn: false)
        let model = SignInModel(environment: environment)
        model.serverInput = "https://unregistered-host.pulpo.test"
        await model.submitServer()
        #expect(model.error == "Couldn’t connect to unregistered-host.pulpo.test. Check the address and try again.")
    }
}

@Suite("Library", .serialized)
@MainActor
struct LibraryModelTests {
    @Test func groupsPinnedChatsFirst() async throws {
        let (_, library, _) = try await signedInApp()
        let sections = library.sections()
        #expect(sections.map(\.title) == ["Pinned", "Recent"])
        #expect(sections[0].chats.map(\.title) == ["🚀 Launch Checklist for Pulpo TV"])
    }

    @Test func filtersByFolder() async throws {
        let (_, library, _) = try await signedInApp()
        #expect(library.folders.map(\.name) == ["Kitchen", "Money"])
        let kitchen = library.sections(folderId: "folder-kitchen")
        #expect(kitchen.flatMap(\.chats).map(\.title) == ["🍜 Weeknight Ramen"])
    }

    @Test func pinsRenamesAndDeletesChats() async throws {
        let (_, library, server) = try await signedInApp()
        let chat = try #require(library.chats.first { $0.title.contains("Ramen") })

        await library.setPinned(true, chatId: chat.id)
        #expect(library.chat(id: chat.id)?.pinned == true)
        await library.rename(chatId: chat.id, to: "🍜 Tonight’s Ramen")
        #expect(library.chat(id: chat.id)?.title == "🍜 Tonight’s Ramen")
        await library.refreshChats()
        #expect(library.chat(id: chat.id)?.title == "🍜 Tonight’s Ramen")
        #expect(library.chat(id: chat.id)?.pinned == true)

        #expect(await library.delete(chatId: chat.id))
        #expect(library.chat(id: chat.id) == nil)
        #expect(server.requests.contains("DELETE /api/chats/\(chat.id)"))
    }

    @Test func rollsBackAFailedChange() async throws {
        let (_, library, server) = try await signedInApp()
        let chat = try #require(library.chats.first)
        server.failNext("/api/chats/\(chat.id)", status: 500, code: "internal_error", message: "Boom")
        await library.rename(chatId: chat.id, to: "Renamed")
        #expect(library.chat(id: chat.id)?.title == chat.title)
        #expect(library.actionError?.contains("Boom") == true)
    }

    @Test func changesTheDefaultModel() async throws {
        let (_, library, server) = try await signedInApp()
        await library.setDefaultModel("gemini-pro")
        #expect(library.defaultModel?.id == "gemini-pro")
        await library.refreshAll()
        #expect(library.defaultModel?.id == "gemini-pro")
        #expect(server.requests.contains("PATCH /api/settings"))
    }

    @Test func coalescesRealtimeRefreshes() async throws {
        let (_, library, server) = try await signedInApp()
        // Let the refresh that follows the realtime connection settle first.
        try await Task.sleep(for: .milliseconds(600))
        let before = server.requests.filter { $0 == "GET /api/chats" }.count
        for _ in 0..<5 { library.scheduleRefresh(scopes: ["chats"]) }
        #expect(await eventually { server.requests.filter { $0 == "GET /api/chats" }.count == before + 1 })
        try await Task.sleep(for: .milliseconds(500))
        #expect(server.requests.filter { $0 == "GET /api/chats" }.count == before + 1)
    }
}
