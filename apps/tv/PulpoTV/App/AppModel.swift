import Observation
import PulpoKit
import SwiftUI

/// The app's root state: who is signed in, the services for that session, and
/// the realtime connection that keeps everything current.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable {
        case launching
        case signedOut
        /// Signed in, but an administrator has not approved the account yet.
        case pendingApproval
        case signedIn
    }

    private(set) var phase: Phase = .launching
    private(set) var session: StoredSession?
    private(set) var api: PulpoAPI?
    private(set) var library: LibraryModel?
    /// Shown on the sign-in screen after the server ended the session.
    var signedOutNotice: String?
    private(set) var isRealtimeConnected = false
    let readAloud = ReadAloud()
    let environment: AppEnvironment

    /// The conversation on screen; realtime events for its responses go to it.
    weak var activeConversation: ConversationModel?

    private var realtime: RealtimeChannel?
    private var realtimeTask: Task<Void, Never>?
    private var realtimeRetryTask: Task<Void, Never>?
    private var isVerifyingSession = false

    init(environment: AppEnvironment) {
        self.environment = environment
    }

    var user: User? { session?.user }

    func launch() async {
        guard phase == .launching else { return }
        guard let stored = environment.sessionStore.load() else {
            phase = .signedOut
            return
        }
        activate(stored)
        await refreshUser()
    }

    /// Makes `auth` the active session.
    func completeSignIn(server: ServerAddress, auth: NativeAuthResponse) {
        let stored = StoredSession(server: server, token: auth.session.token, user: auth.user)
        try? environment.sessionStore.save(stored)
        Preferences.lastServer = server
        Preferences.lastEmail = auth.user.email
        signedOutNotice = nil
        activate(stored)
    }

    func signOut() async {
        let api = self.api
        tearDown()
        environment.sessionStore.clear()
        phase = .signedOut
        // Best effort: revoke the token on the server so it can't be reused.
        try? await api?.logout()
    }

    /// Re-reads the account; used on launch and from the approval screen.
    func refreshUser() async {
        guard let api, var stored = session else { return }
        do {
            let user = try await api.currentUser()
            stored.user = user
            session = stored
            try? environment.sessionStore.save(stored)
            library?.user = user
            let next: Phase = user.role == .pending ? .pendingApproval : .signedIn
            if next != phase {
                phase = next
                if next == .signedIn { startRealtime() } else { stopRealtime() }
            }
        } catch let error as APIError where error.isUnauthorized {
            await endSession(notice: "Your session has ended. Sign in again to continue.")
        } catch {
            // Offline or a server hiccup: keep the cached account and let the
            // screens show their own retry states.
        }
    }

    /// Called when any request fails with 401. Confirms with the server before
    /// signing out, so a transient error never discards a valid session.
    func handleUnauthorized() async {
        guard !isVerifyingSession, let api else { return }
        isVerifyingSession = true
        defer { isVerifyingSession = false }
        do {
            _ = try await api.currentUser()
        } catch let error as APIError where error.isUnauthorized {
            await endSession(notice: "Your session has ended. Sign in again to continue.")
        } catch {}
    }

    private func endSession(notice: String) async {
        tearDown()
        environment.sessionStore.clear()
        signedOutNotice = notice
        phase = .signedOut
    }

    private func activate(_ stored: StoredSession) {
        tearDown()
        session = stored
        let api = PulpoAPI(environment.makeHTTPClient(stored.server, stored.token))
        self.api = api
        library = LibraryModel(api: api, user: stored.user, app: self)
        if stored.user.role == .pending {
            phase = .pendingApproval
        } else {
            phase = .signedIn
            startRealtime()
        }
    }

    private func tearDown() {
        readAloud.stop()
        stopRealtime()
        activeConversation = nil
        library = nil
        api = nil
        session = nil
    }

    // MARK: Realtime

    private func startRealtime() {
        guard realtime == nil, let session else { return }
        let channel = environment.makeRealtime(session.server, session.token)
        realtime = channel
        realtimeTask = Task { [weak self] in
            await channel.start()
            for await message in channel.messages {
                guard let self, !Task.isCancelled else { break }
                await self.handle(message)
            }
        }
    }

    private func handle(_ message: RealtimeMessage) async {
        switch message {
        case .connected:
            isRealtimeConnected = true
            activeConversation?.resubscribe()
            library?.scheduleRefresh(scopes: LibraryModel.allScopes)
        case .disconnected:
            isRealtimeConnected = false
        case .unauthorized:
            isRealtimeConnected = false
            // Checking the account cancels this loop, so run it on its own task.
            Task { await realtimeRejected() }
        case .responseEvent, .responseSnapshot:
            activeConversation?.receive(message)
        case .accountRevision(let scopes):
            library?.scheduleRefresh(scopes: scopes)
        case .chatChanged(let chatId):
            library?.scheduleRefresh(scopes: ["chats"])
            if activeConversation?.chatId == chatId { activeConversation?.chatDidChange() }
        }
    }

    /// The socket refused the session. Re-reading the account signs out an
    /// expired session or shows the approval screen; if the account is fine,
    /// the connection is retried after a pause.
    private func realtimeRejected() async {
        stopRealtime()
        await refreshUser()
        guard phase == .signedIn, realtime == nil else { return }
        realtimeRetryTask?.cancel()
        realtimeRetryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(15))
            guard let self, !Task.isCancelled, self.phase == .signedIn else { return }
            self.startRealtime()
        }
    }

    private func stopRealtime() {
        realtimeRetryTask?.cancel()
        realtimeRetryTask = nil
        realtimeTask?.cancel()
        realtimeTask = nil
        if let realtime { Task { await realtime.stop() } }
        realtime = nil
        isRealtimeConnected = false
    }

    func subscribe(responseId: String, afterSequence: Int) {
        guard let realtime else { return }
        Task { await realtime.subscribe(responseId: responseId, afterSequence: afterSequence) }
    }

    func unsubscribe(responseId: String) {
        guard let realtime else { return }
        Task { await realtime.unsubscribe(responseId: responseId) }
    }

    // MARK: Lifecycle

    /// Network work stops while the app is in the background.
    func scenePhaseChanged(to phase: ScenePhase) {
        guard self.phase == .signedIn else { return }
        switch phase {
        case .active:
            startRealtime()
            library?.scheduleRefresh(scopes: LibraryModel.allScopes)
            activeConversation?.reload()
        case .background:
            readAloud.stop()
            stopRealtime()
        default:
            break
        }
    }
}
