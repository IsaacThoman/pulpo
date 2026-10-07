import Foundation
import Observation
import PulpoKit

/// One open conversation: its transcript, the replies streaming into it, and
/// the actions on it. A model with no `chatId` is a new chat that is created
/// by its first message.
@MainActor
@Observable
final class ConversationModel {
    enum State: Equatable {
        case loading
        case ready
        case failed(String)
    }

    private(set) var chatId: String?
    private(set) var detail: ChatDetail?
    private(set) var turns: [TranscriptTurn] = []
    private(set) var state: State
    private(set) var selectedModelId: String?
    private(set) var isSending = false
    /// The last failure to send, stop, or regenerate, shown above the composer.
    var actionError: String?
    /// Text from a send that failed, so the composer can offer it again.
    private(set) var failedDraft: String?

    @ObservationIgnored let library: LibraryModel
    @ObservationIgnored private weak var app: AppModel?
    @ObservationIgnored private var trackers: [String: ResponseTracker] = [:]
    @ObservationIgnored private var projectionTask: Task<Void, Never>?
    @ObservationIgnored private var reloadTask: Task<Void, Never>?
    @ObservationIgnored private var watchdogTask: Task<Void, Never>?
    @ObservationIgnored private var lastRealtimeActivity = ContinuousClock.now
    @ObservationIgnored private var lastPoll = ContinuousClock.now
    /// Fetches are numbered so one that finishes after a newer one is dropped.
    @ObservationIgnored private var loadGeneration = 0
    @ObservationIgnored private var appliedGeneration = 0
    /// Stop was pressed before the server acknowledged the send.
    @ObservationIgnored private var stopRequested = false
    /// Replies started here, with the fetch generation current when the
    /// server acknowledged them: fetches up to then may not include them yet.
    @ObservationIgnored private var acknowledged: [String: Int] = [:]

    /// How long a live reply may go without realtime events before the stored
    /// copy is fetched instead, and how often. Without a socket (for example
    /// behind a proxy that blocks websockets) polling is the only source of
    /// progress; with one, silence usually means the model is thinking.
    static let pollingWithoutRealtime = (silence: Duration.seconds(6), interval: Duration.seconds(3))
    static let pollingWithRealtime = (silence: Duration.seconds(15), interval: Duration.seconds(15))
    /// Identifiers reused when a failed send is retried with the same text,
    /// so the server deduplicates it if the first attempt actually arrived.
    @ObservationIgnored private var failedSubmission: (text: String, chatId: String?, responseId: String)?

    init(chatId: String?, library: LibraryModel, app: AppModel?) {
        self.chatId = chatId
        self.library = library
        self.app = app
        self.state = chatId == nil ? .ready : .loading
        if chatId == nil { selectedModelId = library.defaultModel?.id }
    }

    // MARK: Derived state

    var title: String {
        guard let chatId else { return "New Chat" }
        return library.chat(id: chatId)?.title ?? detail?.title ?? "Chat"
    }

    var isPinned: Bool {
        chatId.flatMap { library.chat(id: $0)?.pinned } ?? detail?.pinned ?? false
    }

    var model: AIModel? { library.model(id: selectedModelId) ?? library.defaultModel }

    var isGenerating: Bool { isSending || turns.contains(where: \.isActive) }

    var activeResponseId: String? { turns.last(where: \.isActive)?.id }

    var isEmpty: Bool { turns.isEmpty }

    /// A chat's history must load before a message can be added to it.
    var canSend: Bool { chatId == nil || detail != nil }

    // MARK: Loading

    func load() async {
        guard let chatId else {
            if selectedModelId == nil { selectedModelId = library.defaultModel?.id }
            state = .ready
            return
        }
        if detail == nil { state = .loading }
        loadGeneration += 1
        let generation = loadGeneration
        do {
            let fetched = try await library.api.chat(chatId)
            // A newer fetch already landed; this one would rewind the transcript.
            guard generation > appliedGeneration, chatId == self.chatId else { return }
            appliedGeneration = generation
            apply(fetched, generation: generation)
            state = .ready
        } catch let error as APIError where error.isNotFound {
            guard generation > appliedGeneration else { return }
            appliedGeneration = generation
            // Deleted on another device.
            detail = nil
            trackers.removeAll()
            project()
            state = .failed(Self.message(for: error))
        } catch {
            await report(error)
            if detail == nil { state = .failed(Self.message(for: error)) }
        }
    }

    /// Refetches the chat, coalescing bursts of requests.
    func reload(after delay: Duration = .zero) {
        guard chatId != nil else { return }
        reloadTask?.cancel()
        reloadTask = Task { [weak self] in
            if delay > .zero { try? await Task.sleep(for: delay) }
            guard let self, !Task.isCancelled, !self.isSending else { return }
            await self.load()
        }
    }

    func chatDidChange() {
        reload(after: .milliseconds(250))
    }

    private func apply(_ fetched: ChatDetail, generation: Int) {
        var detail = fetched
        // A fetch can begin before the server stores a reply this device just
        // started; keep showing it rather than letting the message flicker away.
        let fetchedIds = Set(fetched.responses.map(\.id))
        if let previous = self.detail {
            let pending = previous.responses.filter { response in
                guard !fetchedIds.contains(response.id) else { return false }
                if let acknowledgedAt = acknowledged[response.id] { return generation <= acknowledgedAt }
                return trackers[response.id].map { !$0.isTerminal } == true
            }
            if let leaf = pending.last {
                detail.responses += pending
                detail.activeBranchLeafId = leaf.id
            }
        }
        for id in fetchedIds { acknowledged.removeValue(forKey: id) }
        self.detail = detail
        if selectedModelId == nil || library.model(id: selectedModelId) == nil {
            selectedModelId = library.model(id: detail.modelId)?.id ?? library.defaultModel?.id ?? detail.modelId
        }
        let lineage = Set(Transcript.lineage(detail.responses, leafId: Transcript.leafId(of: detail)).map(\.id))
        for response in detail.responses where lineage.contains(response.id) {
            let stored = response.liveSnapshot
            if response.status.isActive {
                if trackers[response.id] == nil {
                    // Opened while generating (perhaps started on another device): follow it.
                    let tracker = ResponseTracker(stored)
                    trackers[response.id] = tracker
                    app?.subscribe(responseId: response.id, afterSequence: tracker.sequence)
                } else {
                    trackers[response.id]?.receive(stored)
                }
            } else if var tracker = trackers[response.id] {
                // The stored copy of a finished reply can trail what streamed
                // here (a cancellation is recorded before the last events are
                // saved). Keep the local copy until the server catches up.
                if stored.sequence >= tracker.sequence {
                    trackers.removeValue(forKey: response.id)
                    app?.unsubscribe(responseId: response.id)
                } else {
                    tracker.finish(stored.status, error: stored.error)
                    trackers[response.id] = tracker
                }
            }
        }
        project()
    }

    private func project() {
        projectionTask?.cancel()
        projectionTask = nil
        guard let detail else {
            turns = []
            return
        }
        turns = Transcript.turns(for: detail, live: trackers.mapValues(\.snapshot))
        updateWatchdog()
    }

    /// Polls the stored chat while a reply is live but realtime has gone quiet.
    private func updateWatchdog() {
        let live = trackers.values.contains { !$0.isTerminal }
        guard live else {
            watchdogTask?.cancel()
            watchdogTask = nil
            return
        }
        guard watchdogTask == nil else { return }
        lastRealtimeActivity = .now
        watchdogTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard let self, !Task.isCancelled else { return }
                let policy = self.app?.isRealtimeConnected == true ? Self.pollingWithRealtime : Self.pollingWithoutRealtime
                let now = ContinuousClock.now
                if now - self.lastRealtimeActivity > policy.silence, now - self.lastPoll >= policy.interval, !self.isSending {
                    self.lastPoll = now
                    await self.load()
                }
            }
        }
    }

    /// Streaming can deliver dozens of events a second; redraw at most ~16 times a second.
    private func scheduleProjection() {
        guard projectionTask == nil else { return }
        projectionTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(60))
            guard let self, !Task.isCancelled else { return }
            self.projectionTask = nil
            self.project()
        }
    }

    // MARK: Realtime

    func receive(_ message: RealtimeMessage) {
        lastRealtimeActivity = .now
        switch message {
        case .responseEvent(let event):
            guard var tracker = trackers[event.responseId] else { return }
            let changed = tracker.receive(event)
            trackers[event.responseId] = tracker
            if changed { scheduleProjection() }
            // The server stores the finished reply before generating the
            // chat's title, and only then sends the final snapshot. The
            // stored state is already complete, so fetch it now.
            if ["response.completed", "response.failed", "response.incomplete"].contains(event.type) {
                reload(after: .milliseconds(300))
            }
        case .responseSnapshot(let snapshot):
            guard var tracker = trackers[snapshot.responseId] else { return }
            let changed = tracker.receive(snapshot)
            trackers[snapshot.responseId] = tracker
            if changed { scheduleProjection() }
            if tracker.isTerminal {
                app?.unsubscribe(responseId: snapshot.responseId)
                reload(after: .milliseconds(200))
            }
        default:
            break
        }
    }

    /// After a reconnect, replays whatever was missed for live replies.
    func resubscribe() {
        for tracker in trackers.values where !tracker.isTerminal {
            app?.subscribe(responseId: tracker.responseId, afterSequence: tracker.sequence)
        }
        if !trackers.isEmpty { reload(after: .milliseconds(500)) }
    }

    // MARK: Sending

    func send(_ rawText: String) async {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isGenerating, canSend else { return }
        guard let modelId = model?.id else {
            failedDraft = text
            actionError = "No models are available on this server."
            return
        }
        actionError = nil
        failedDraft = nil

        let reuse = failedSubmission?.text == text ? failedSubmission : nil
        failedSubmission = nil
        let isNewChat = chatId == nil
        let chatId = self.chatId ?? reuse?.chatId ?? UUID().uuidString.lowercased()
        let responseId = reuse?.responseId ?? UUID().uuidString.lowercased()
        let previousDetail = detail
        let previousChatId = self.chatId
        let now = Date()

        // Show the message immediately and catch events that beat the HTTP reply.
        var working = detail ?? ChatDetail(id: chatId, title: text, modelId: modelId, createdAt: now, updatedAt: now)
        working.responses.append(ChatResponse(
            id: responseId, parentResponseId: detail.flatMap(Transcript.leafId), modelId: modelId, status: .queued,
            input: [["role": "user", "content": [["type": "input_text", "text": .string(text)]]]],
            createdAt: now, snapshot: .queued(responseId, at: now)
        ))
        working.activeBranchLeafId = responseId
        self.chatId = chatId
        detail = working
        trackers[responseId] = ResponseTracker(.queued(responseId, at: now))
        isSending = true
        project()

        let request = PulpoAPI.NewResponse(clientId: responseId, input: text, modelId: modelId)
        do {
            let snapshot: ResponseSnapshot
            if isNewChat {
                let started = try await library.api.startChat(.init(chatId: chatId, title: text, response: request))
                var summary = started.chat
                summary.inFlightResponseIds = [responseId]
                library.upsert(summary)
                snapshot = started.response
            } else {
                snapshot = try await library.api.respond(in: chatId, request)
            }
            trackers[responseId]?.receive(snapshot)
            acknowledged[responseId] = loadGeneration
            app?.subscribe(responseId: responseId, afterSequence: trackers[responseId]?.sequence ?? 0)
            isSending = false
            project()
            await stopIfRequested()
        } catch {
            trackers.removeValue(forKey: responseId)
            detail = previousDetail
            self.chatId = previousChatId
            isSending = false
            stopRequested = false
            failedSubmission = (text, isNewChat ? chatId : previousChatId, responseId)
            failedDraft = text
            actionError = Self.message(for: error)
            project()
            await report(error)
        }
    }

    func clearFailedDraft() {
        failedDraft = nil
    }

    func stop() async {
        // The reply doesn't exist on the server until the send is acknowledged.
        if isSending {
            stopRequested = true
            return
        }
        guard let responseId = activeResponseId else { return }
        do {
            let snapshot = try await library.api.cancel(responseId)
            trackers[responseId]?.receive(snapshot)
            if snapshot.status.isActive || snapshot.status == .cancelled { trackers[responseId]?.markCancelled() }
            project()
            reload(after: .milliseconds(400))
        } catch {
            actionError = "Couldn’t stop the reply. \(Self.message(for: error))"
            await report(error)
        }
    }

    private func stopIfRequested() async {
        guard stopRequested else { return }
        stopRequested = false
        await stop()
    }

    /// Asks for a new version of a reply. It becomes the active branch.
    func regenerate(_ turnId: String) async {
        await branch(from: turnId, newText: nil, failure: "Couldn’t regenerate.") { responseId, modelId in
            try await self.library.api.regenerate(turnId, .init(clientId: responseId, modelId: modelId))
        }
    }

    /// Sends an edited version of the user's message in `turnId`.
    func edit(_ turnId: String, text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        await branch(from: turnId, newText: trimmed, failure: "Couldn’t send the edited message.") { responseId, modelId in
            try await self.library.api.editMessage(turnId, .init(content: trimmed, clientId: responseId, modelId: modelId))
        }
    }

    /// Starts a sibling of `turnId` (same parent) and makes it the active branch.
    private func branch(
        from turnId: String, newText: String?, failure: String,
        request: (String, String) async throws -> ResponseSnapshot
    ) async {
        guard !isGenerating, var working = detail,
              let original = working.responses.first(where: { $0.id == turnId }) else { return }
        actionError = nil
        let responseId = UUID().uuidString.lowercased()
        let modelId = model?.id ?? original.modelId
        let now = Date()
        let input: [JSONValue] = newText.map { [["role": "user", "content": [["type": "input_text", "text": .string($0)]]]] } ?? original.input
        working.responses.append(ChatResponse(
            id: responseId, parentResponseId: original.parentResponseId, modelId: modelId, status: .queued,
            input: input, createdAt: now, snapshot: .queued(responseId, at: now)
        ))
        let previousDetail = detail
        working.activeBranchLeafId = responseId
        detail = working
        trackers[responseId] = ResponseTracker(.queued(responseId, at: now))
        isSending = true
        project()
        do {
            let snapshot = try await request(responseId, modelId)
            trackers[responseId]?.receive(snapshot)
            acknowledged[responseId] = loadGeneration
            app?.subscribe(responseId: responseId, afterSequence: trackers[responseId]?.sequence ?? 0)
            isSending = false
            project()
            await stopIfRequested()
        } catch {
            trackers.removeValue(forKey: responseId)
            detail = previousDetail
            isSending = false
            stopRequested = false
            actionError = "\(failure) \(Self.message(for: error))"
            project()
            await report(error)
        }
    }

    /// Switches to another version of a reply (or of the message before it).
    func showVersion(_ responseId: String) async {
        guard !isGenerating else { return }
        do {
            try await library.api.activate(responseId)
            await load()
        } catch {
            actionError = "Couldn’t switch versions. \(Self.message(for: error))"
            await report(error)
        }
    }

    func selectModel(_ modelId: String) async {
        guard modelId != selectedModelId else { return }
        selectedModelId = modelId
        guard let chatId, detail != nil else { return }
        detail?.modelId = modelId
        await library.setModel(modelId, chatId: chatId)
    }

    // MARK: Errors

    private func report(_ error: Error) async {
        if let error = error as? APIError, error.isUnauthorized { await app?.handleUnauthorized() }
    }

    /// Error text for people, with guidance for the cases that need it.
    static func message(for error: Error) -> String {
        guard let error = error as? APIError else { return error.localizedDescription }
        switch error.code {
        case "insufficient_balance":
            return "Your balance is too low for this model. Add credit on the web, or choose a less expensive model."
        case "billing_hold":
            return "Billing for this account is on hold. Check your account on the web."
        case "account_blocked":
            return "This account has been blocked."
        case "model_not_found":
            return "That model is no longer available. Choose another model."
        case "not_found":
            return "This chat no longer exists. It may have been deleted on another device."
        case "temporary_chat_expired":
            return "This temporary chat has expired."
        default:
            return error.message
        }
    }
}
