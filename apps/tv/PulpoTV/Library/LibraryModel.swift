import Observation
import PulpoKit
import SwiftUI

/// The signed-in account's chats, folders, and model catalog.
@MainActor
@Observable
final class LibraryModel {
    enum LoadState: Equatable {
        case idle
        case loading
        case loaded
        case failed(String)
    }

    let api: PulpoAPI
    var user: User
    private(set) var chats: [ChatSummary] = []
    private(set) var folders: [Folder] = []
    private(set) var models: [AIModel] = []
    private(set) var settings: AccountSettings?
    private(set) var suggestions: [SuggestedPrompt] = []
    private(set) var state: LoadState = .idle
    /// A transient message for a failed chat action (rename, pin, delete).
    var actionError: String?

    @ObservationIgnored private weak var app: AppModel?
    @ObservationIgnored private var pendingScopes: Set<String> = []
    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var isRefreshing = false

    init(api: PulpoAPI, user: User, app: AppModel?) {
        self.api = api
        self.user = user
        self.app = app
    }

    var defaultModel: AIModel? { ChatLibrary.defaultModel(models, settings: settings) }

    func model(id: String?) -> AIModel? {
        guard let id else { return nil }
        return models.first { $0.id == id }
    }

    /// The model's display name, falling back to its identifier for models
    /// that are no longer offered.
    func modelName(_ id: String) -> String {
        model(id: id)?.name ?? id
    }

    func sections(folderId: String? = nil) -> [ChatSection] {
        ChatLibrary.sections(chats, folderId: folderId)
    }

    func chat(id: String) -> ChatSummary? {
        chats.first { $0.id == id }
    }

    // MARK: Loading

    func loadIfNeeded() async {
        guard state == .idle else { return }
        await refreshAll()
    }

    func refreshAll() async {
        if chats.isEmpty { state = .loading }
        async let chats = api.chats()
        async let folders = api.folders()
        async let models = api.models()
        async let settings = api.settings()
        async let suggestions = api.suggestedPrompts()
        do {
            let (loadedChats, loadedModels) = try await (chats, models)
            self.chats = loadedChats
            self.models = loadedModels
            self.folders = (try? await folders) ?? self.folders
            self.settings = (try? await settings) ?? self.settings
            self.suggestions = (try? await suggestions) ?? self.suggestions
            state = .loaded
        } catch {
            await report(error)
            if self.chats.isEmpty { state = .failed(error.localizedDescription) }
        }
    }

    func refreshChats() async {
        do {
            chats = try await api.chats()
            if state != .loaded { state = .loaded }
        } catch {
            await report(error)
        }
    }

    /// Everything the library shows, for catching up after a reconnect.
    static let allScopes = ["chats", "folders", "models", "settings"]

    /// Coalesces bursts of realtime invalidations (a reply finishing emits
    /// several) into one refresh. Like the mobile app, every revision
    /// refreshes the chat list, and one without scopes (an account-level
    /// change such as settings) also refreshes settings.
    func scheduleRefresh(scopes: [String]) {
        pendingScopes.formUnion(["chats"] + (scopes.isEmpty ? ["settings"] : scopes))
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(350))
            guard let self, !Task.isCancelled else { return }
            // From here a new request queues behind this refresh rather than
            // cancelling it, so no scope is dropped.
            self.refreshTask = nil
            await self.flushRefresh()
        }
    }

    private func flushRefresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }
        while !pendingScopes.isEmpty {
            let scopes = pendingScopes
            pendingScopes = []
            if scopes.contains("chats") || scopes.contains("folders") {
                await refreshChats()
                if scopes.contains("folders"), let folders = try? await api.folders() { self.folders = folders }
            }
            if scopes.contains("models"), let models = try? await api.models() { self.models = models }
            if scopes.contains("settings"), let settings = try? await api.settings() { self.settings = settings }
        }
    }

    // MARK: Local updates

    /// Records a chat the app just created or changed, before the next refresh.
    func upsert(_ chat: ChatSummary) {
        if let index = chats.firstIndex(where: { $0.id == chat.id }) {
            chats[index] = chat
        } else {
            chats.insert(chat, at: 0)
        }
    }

    // MARK: Chat actions

    func setPinned(_ pinned: Bool, chatId: String) async {
        await mutate(chatId) { $0.pinned = pinned } request: {
            try await self.api.updateChat(chatId, .init(pinned: pinned))
        }
    }

    func rename(chatId: String, to title: String) async {
        let trimmed = String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(200))
        guard !trimmed.isEmpty else { return }
        await mutate(chatId) { $0.title = trimmed } request: {
            try await self.api.updateChat(chatId, .init(title: trimmed))
        }
    }

    func setModel(_ modelId: String, chatId: String) async {
        await mutate(chatId) { $0.modelId = modelId } request: {
            try await self.api.updateChat(chatId, .init(modelId: modelId))
        }
    }

    func setDefaultModel(_ modelId: String) async {
        let previous = settings
        var updated = settings ?? AccountSettings()
        updated.defaultModelId = modelId
        settings = updated
        do {
            try await api.setDefaultModel(modelId)
        } catch {
            settings = previous
            actionError = "Couldn’t change the default model. \(error.localizedDescription)"
            await report(error)
        }
    }

    @discardableResult
    func delete(chatId: String) async -> Bool {
        let previous = chats
        chats.removeAll { $0.id == chatId }
        do {
            try await api.deleteChat(chatId)
            return true
        } catch {
            chats = previous
            actionError = "Couldn’t delete the chat. \(error.localizedDescription)"
            await report(error)
            return false
        }
    }

    /// Applies a change optimistically and rolls it back if the server refuses.
    private func mutate(_ chatId: String, _ change: (inout ChatSummary) -> Void, request: () async throws -> ChatSummary) async {
        let previous = chats
        if let index = chats.firstIndex(where: { $0.id == chatId }) { change(&chats[index]) }
        do {
            let updated = try await request()
            if let index = chats.firstIndex(where: { $0.id == chatId }) {
                var merged = updated
                merged.inFlightResponseIds = chats[index].inFlightResponseIds
                chats[index] = merged
            }
        } catch {
            chats = previous
            actionError = "Couldn’t update the chat. \(error.localizedDescription)"
            await report(error)
        }
    }

    func report(_ error: Error) async {
        if let error = error as? APIError, error.isUnauthorized { await app?.handleUnauthorized() }
    }
}
