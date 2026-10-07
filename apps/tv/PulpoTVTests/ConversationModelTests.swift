import Foundation
import PulpoKit
import Testing
@testable import Pulpo

/// A signed-in app with a conversation open on its own mock server. Holding
/// the harness keeps the app (and its realtime connection) alive.
@MainActor
final class Harness {
    let app: AppModel
    let library: LibraryModel
    let server: MockServer
    let model: ConversationModel

    init(app: AppModel, library: LibraryModel, server: MockServer, model: ConversationModel) {
        self.app = app
        self.library = library
        self.server = server
        self.model = model
    }
}

/// `chat` picks an existing chat by title; nil starts a new chat.
@MainActor
private func conversation(titled chat: String? = nil, wordDelay: Duration = .milliseconds(2)) async throws -> Harness {
    let (app, library, server) = try await signedInApp()
    server.wordDelay = wordDelay
    let chatId = try chat.map { title in try #require(library.chats.first { $0.title.contains(title) }?.id) }
    let model = ConversationModel(chatId: chatId, library: library, app: app)
    app.activeConversation = model
    #expect(await eventually { app.isRealtimeConnected })
    await model.load()
    return Harness(app: app, library: library, server: server, model: model)
}

@Suite("Conversation", .serialized)
@MainActor
struct ConversationModelTests {
    @Test func startsANewChatAndStreamsTheReply() async throws {
        let h = try await conversation()
        let (model, library) = (h.model, h.library)
        #expect(model.chatId == nil)
        #expect(model.title == "New Chat")
        #expect(model.model?.id == "gpt-5.6-luna")

        await model.send("Write a haiku about octopuses")
        let chatId = try #require(model.chatId)
        #expect(model.turns.count == 1)
        #expect(model.turns[0].userText == "Write a haiku about octopuses")
        #expect(await eventually { model.turns.first?.status == ResponseStatus.completed })
        #expect(model.turns[0].content.text.hasPrefix("Eight arms in the dark"))
        #expect(!model.isGenerating)
        // The server names the chat after the first reply.
        #expect(await eventually { library.chat(id: chatId)?.title == "✨ Write A Haiku About" })
        #expect(model.title == "✨ Write A Haiku About")
    }

    @Test func continuesAnExistingChat() async throws {
        let h = try await conversation(titled: "Ramen")
        let model = h.model
        #expect(model.turns.count == 1)
        #expect(model.model?.id == "claude-opus")

        await model.send("Make it vegetarian")
        #expect(model.turns.count == 2)
        #expect(await eventually { model.turns.last?.status == ResponseStatus.completed })
        #expect(model.turns.last?.content.text.contains("Pulpo mock server") == true)
    }

    @Test func ignoresEmptyMessagesAndSendsWhileIdleOnly() async throws {
        let h = try await conversation()
        let (model, server) = (h.model, h.server)
        await model.send("   \n ")
        #expect(model.turns.isEmpty)
        #expect(!server.requests.contains("POST /api/chats/start"))
    }

    @Test func stopsAReplyAndKeepsWhatStreamed() async throws {
        let h = try await conversation(wordDelay: .milliseconds(40))
        let model = h.model
        await model.send("Write a long essay")
        #expect(await eventually { (model.turns.first?.content.text.count ?? 0) > 40 })
        await model.stop()
        #expect(model.turns.first?.status == ResponseStatus.cancelled)
        let stopped = model.turns.first?.content.text ?? ""
        #expect(!stopped.isEmpty)
        // A later refetch must not lose the partial reply.
        model.reload()
        try await Task.sleep(for: .milliseconds(400))
        #expect(model.turns.first?.status == ResponseStatus.cancelled)
        #expect((model.turns.first?.content.text.count ?? 0) >= stopped.count - 20)
        #expect(!model.isGenerating)
        #expect(model.turns.first?.errorMessage == nil)
    }

    @Test func stopsAReplyPressedBeforeTheServerAcknowledgedIt() async throws {
        let h = try await conversation(titled: "Ramen", wordDelay: .milliseconds(40))
        let (model, server) = (h.model, h.server)
        let chatId = try #require(model.chatId)
        server.delayNext("/api/chats/\(chatId)/responses", by: 0.4)
        let sending = Task { await model.send("Write a long essay") }
        #expect(await eventually { model.isSending })
        // The reply doesn't exist on the server yet.
        await model.stop()
        #expect(model.actionError == nil)
        await sending.value
        #expect(await eventually { model.turns.last?.status == ResponseStatus.cancelled })
        #expect(model.actionError == nil)
        #expect(!model.isGenerating)
    }

    @Test func keepsANewReplyWhenAnOlderFetchArrivesLate() async throws {
        let h = try await conversation(titled: "Ramen")
        let (model, server) = (h.model, h.server)
        let chatId = try #require(model.chatId)
        // This fetch reads the chat now but its reply arrives after the send.
        server.delayNext("/api/chats/\(chatId)", by: 0.8, afterHandling: true)
        let stale = Task { await model.load() }
        try await Task.sleep(for: .milliseconds(100))
        await model.send("Make it vegetarian")
        #expect(await eventually { model.turns.last?.status == ResponseStatus.completed })
        await stale.value
        #expect(model.turns.count == 2)
        #expect(model.turns.last?.userText == "Make it vegetarian")
        #expect(model.turns.last?.status == ResponseStatus.completed)
        #expect(!model.isGenerating)
    }

    @Test func regeneratesAndSwitchesBetweenVersions() async throws {
        let h = try await conversation(titled: "Barre")
        let model = h.model
        let original = try #require(model.turns.first)

        await model.regenerate(original.id)
        #expect(await eventually { model.turns.first?.status == ResponseStatus.completed && model.turns.first?.id != original.id })
        await model.load()
        let regenerated = try #require(model.turns.first)
        #expect(regenerated.assistantBranch == BranchPosition(ids: [original.id, regenerated.id], index: 1))

        await model.showVersion(original.id)
        #expect(model.turns.first?.id == original.id)
        #expect(model.turns.first?.content.text == original.content.text)
        #expect(model.turns.first?.assistantBranch?.index == 0)
    }

    @Test func editsAMessageAsANewVersion() async throws {
        let h = try await conversation(titled: "Sky")
        let model = h.model
        let original = try #require(model.turns.first)

        await model.edit(original.id, text: "Compare three sci-fi classics in a table")
        #expect(await eventually { model.turns.first?.status == ResponseStatus.completed })
        #expect(model.turns.first?.userText == "Compare three sci-fi classics in a table")
        #expect(model.turns.first?.content.text.contains("| Fund type |") == true)
    }

    @Test func restoresTheMessageWhenSendingFails() async throws {
        let h = try await conversation()
        let (model, server) = (h.model, h.server)
        server.failNext("/api/chats/start", status: 402, code: "insufficient_balance", message: "Insufficient balance for the request")
        await model.send("Hello there")
        #expect(model.turns.isEmpty)
        #expect(model.chatId == nil)
        #expect(model.failedDraft == "Hello there")
        #expect(model.actionError == ConversationModel.message(for: APIError(status: 402, code: "insufficient_balance", message: "")))
        #expect(!model.isGenerating)

        // Retrying the same text reuses the same identifiers, so a request
        // that did reach the server is not duplicated.
        await model.send("Hello there")
        #expect(model.chatId != nil)
        #expect(await eventually { model.turns.first?.status == ResponseStatus.completed })
    }

    @Test func remembersTheModelForTheChat() async throws {
        let h = try await conversation(titled: "KV")
        let (model, library, server) = (h.model, h.library, h.server)
        let chatId = try #require(model.chatId)
        await model.selectModel("gemini-pro")
        #expect(model.model?.id == "gemini-pro")
        #expect(library.chat(id: chatId)?.modelId == "gemini-pro")
        #expect(server.requests.contains("PATCH /api/chats/\(chatId)"))

        await model.send("Explain how KV caching speeds up decoding")
        #expect(await eventually { model.turns.last?.status == ResponseStatus.completed })
        #expect(model.turns.last?.modelId == "gemini-pro")
    }

    @Test(.timeLimit(.minutes(1)))
    func fallsBackToPollingWhenRealtimeIsBlocked() async throws {
        let h = try await conversation()
        h.server.realtime.dropsResponses = true
        h.server.realtime.emit(.disconnected)
        await h.model.send("Write a haiku about octopuses")
        #expect(await eventually(timeout: .seconds(20)) { h.model.turns.first?.status == ResponseStatus.completed })
        #expect(h.model.turns.first?.content.text.hasPrefix("Eight arms in the dark") == true)
        #expect(!h.model.isGenerating)
    }

    @Test func showsWhenTheChatWasDeletedElsewhere() async throws {
        let h = try await conversation(titled: "Ramen")
        let chatId = try #require(h.model.chatId)
        try await h.library.api.deleteChat(chatId)
        await h.model.load()
        #expect(h.model.turns.isEmpty)
        #expect(h.model.state == .failed("This chat no longer exists. It may have been deleted on another device."))
    }

    @Test func explainsCommonErrors() {
        #expect(ConversationModel.message(for: APIError(status: 400, code: "model_not_found", message: "x")) == "That model is no longer available. Choose another model.")
        #expect(ConversationModel.message(for: APIError.offline) == APIError.offline.message)
        #expect(ConversationModel.message(for: APIError(status: 500, code: "internal_error", message: "Boom")) == "Boom")
    }
}
