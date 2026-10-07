import Foundation
import Testing
@testable import PulpoKit

/// End-to-end checks against a running Pulpo server. Set
/// `PULPO_TV_LIVE_SERVER` (for example `http://localhost:8080`) and
/// `PULPO_TV_LIVE_TOKEN` (a session token) to enable them; they create and then
/// delete a chat, using the server's default model.
@Suite("Live server", .enabled(if: LiveServer.configuration != nil), .serialized)
struct LiveServerTests {
    @Test(.timeLimit(.minutes(2)))
    func streamsAReplyThatMatchesTheStoredResponse() async throws {
        let (server, token) = try #require(LiveServer.configuration)
        let api = PulpoAPI(HTTPClient(server: server, token: token))
        let models = try await api.models()
        let model = try #require(ChatLibrary.defaultModel(models, settings: try? await api.settings()))

        let realtime = SocketIOClient(server: server, token: token)
        await realtime.start()
        var messages = realtime.messages.makeAsyncIterator()
        #expect(await messages.next() == .connected)

        let chatId = UUID().uuidString.lowercased()
        let responseId = UUID().uuidString.lowercased()
        var tracker = ResponseTracker(.queued(responseId))
        let started = try await api.startChat(.init(
            chatId: chatId, title: "TV live test",
            response: .init(clientId: responseId, input: "Reply with exactly three short bullet points about octopuses.", modelId: model.id)
        ))
        #expect(started.chat.id == chatId)
        await realtime.subscribe(responseId: responseId, afterSequence: tracker.sequence)

        var deltas = 0
        while !tracker.isTerminal, let message = await messages.next() {
            switch message {
            case .responseEvent(let event):
                if event.type == "response.output_text.delta", event.responseId == responseId { deltas += 1 }
                tracker.receive(event)
            case .responseSnapshot(let snapshot):
                tracker.receive(snapshot)
            case .connected:
                await realtime.subscribe(responseId: responseId, afterSequence: tracker.sequence)
            default:
                break
            }
        }
        await realtime.stop()

        #expect(tracker.snapshot.status == .completed)
        #expect(deltas > 0)
        let streamedText = ResponseContent(output: tracker.snapshot.output).text
        let stored = try await api.chat(chatId)
        let storedText = Transcript.turns(for: stored).last?.content.text
        #expect(!streamedText.isEmpty)
        #expect(streamedText == storedText)

        try await api.deleteChat(chatId)
    }

    @Test func rejectsAnInvalidSessionOnTheSocket() async throws {
        let (server, _) = try #require(LiveServer.configuration)
        let realtime = SocketIOClient(server: server, token: String(repeating: "x", count: 43))
        await realtime.start()
        var messages = realtime.messages.makeAsyncIterator()
        #expect(await messages.next() == .unauthorized)
        await realtime.stop()
    }

    @Test func cancelsAGeneration() async throws {
        let (server, token) = try #require(LiveServer.configuration)
        let api = PulpoAPI(HTTPClient(server: server, token: token))
        let model = try #require(try await api.models().first)
        let chatId = UUID().uuidString.lowercased()
        let responseId = UUID().uuidString.lowercased()
        _ = try await api.startChat(.init(
            chatId: chatId, title: "TV cancel test",
            response: .init(clientId: responseId, input: "Write a 2000 word essay about the history of tea.", modelId: model.id)
        ))
        let snapshot = try await api.cancel(responseId)
        #expect([ResponseStatus.cancelled, .completed].contains(snapshot.status))
        try await api.deleteChat(chatId)
    }
}

enum LiveServer {
    static let configuration: (ServerAddress, String)? = {
        let environment = ProcessInfo.processInfo.environment
        guard let address = environment["PULPO_TV_LIVE_SERVER"], let token = environment["PULPO_TV_LIVE_TOKEN"],
              let server = try? ServerAddress(address, allowLocalHTTP: true)
        else { return nil }
        return (server, token)
    }()
}
