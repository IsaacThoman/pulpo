import Foundation
import Testing
@testable import PulpoKit

private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
    try JSONDecoder.pulpo.decode(T.self, from: Data(json.utf8))
}

private func response(_ id: String, parent: String?, text: String = "q", status: ResponseStatus = .completed) -> ChatResponse {
    ChatResponse(
        id: id, parentResponseId: parent, modelId: "m", status: status,
        input: [["role": "user", "content": [["type": "input_text", "text": .string(text)]]]],
        createdAt: Date(timeIntervalSince1970: 0)
    )
}

@Suite("Decoding server responses")
struct DecodingTests {
    @Test func decodesABranchedChat() throws {
        let chat = try decode(ChatDetail.self, Fixtures.branchedChat)
        #expect(chat.title == "🍎 Three Popular Fruits")
        #expect(chat.responses.count == 3)
        #expect(chat.responses[1].detailAvailable == false)
        #expect(chat.responses[0].snapshot?.sequence == 23)
        #expect(chat.responses[0].snapshot?.output.isEmpty == true)
        #expect(chat.responses[0].liveSnapshot.output.count == 1)
        #expect(chat.responses[0].usage?.outputTokens == 19)
        #expect(chat.summary.inFlightResponseIds.isEmpty)
    }

    @Test func decodesTheChatList() throws {
        let list = try decode(DataEnvelope<ChatSummary>.self, Fixtures.chatList).data
        #expect(list.count == 1)
        #expect(list[0].modelId == "gpt-5.6-luna")
        #expect(!list[0].isGenerating)
    }

    @Test func decodesTheModelCatalog() throws {
        let models = try decode(ModelCatalog.self, Fixtures.models).data
        #expect(models.map(\.id) == ["gpt-5.6-luna"])
        #expect(models[0].name == "GPT-5.6 Luna")
        #expect(models[0].logoKey == "openai")
        #expect(models[0].subtitle == "OpenAI · Pulpo Baby")
    }

    @Test func toleratesOlderServersAndUnknownValues() throws {
        let chat = try decode(ChatSummary.self, #"{"id":"c","createdAt":"2026-01-01T00:00:00Z"}"#)
        #expect(chat.title == "New chat")
        #expect(chat.updatedAt == chat.createdAt)
        let snapshot = try decode(ResponseSnapshot.self, #"{"responseId":"r","status":"paused_for_review"}"#)
        #expect(snapshot.status.rawValue == "paused_for_review")
        #expect(snapshot.status.isActive == false)
    }

    @Test func decodesStringInputFromImportedChats() throws {
        let json = #"{"id":"r","modelId":"m","status":"completed","input":"Imported question","output":[],"createdAt":"2026-01-01T00:00:00.000Z"}"#
        let turn = try decode(ChatResponse.self, json)
        #expect(Transcript.inputText(turn.input) == "Imported question")
    }

    @Test func decodesSettingsAndAuth() throws {
        let settings = try decode(AccountSettings.self, #"{"values":{"defaultModelId":"x","favoriteModelIds":["x"],"chatSortMode":"recent"}}"#)
        #expect(settings == AccountSettings(defaultModelId: "x", favoriteModelIds: ["x"], chatSortMode: "recent"))
        let auth = try decode(NativeAuthResponse.self, #"""
        {"user":{"id":"u","email":"a@b.co","name":"Ada Lovelace","username":"ada","avatarUrl":null,"profileColor":"#ff8800",
        "role":"pending","balanceMicros":-5,"storageLimitBytes":0,"blocked":false,"stateRevision":1,"createdAt":"2026-01-01T00:00:00.000Z"},
        "session":{"token":"tttttttttttttttttttttttttttttttttttttttttt","expiresAt":"2026-02-01T00:00:00.000Z"}}
        """#)
        #expect(auth.user.role == .pending)
        #expect(auth.session.expiresAt != nil)
    }

    @Test func decodesTheInstanceConfig() throws {
        let config = try decode(InstanceConfig.self, #"""
        {"mobileApiVersion":1,"instance":{"name":"Pulpo","version":"0.1.0","publicUrl":"http://localhost:8090"},
        "setupRequired":false,"auth":{"signupEnabled":false,"pendingMessage":"Wait"},"capabilities":{"realtime":true}}
        """#)
        #expect(config.instance.name == "Pulpo")
        #expect(config.auth?.pendingMessage == "Wait")
    }

    @Test func extractsErrorMessages() {
        let error = APIError.from(status: 402, data: Data(#"{"error":{"message":"Insufficient balance for the request","type":"x","code":"insufficient_balance","param":null}}"#.utf8))
        #expect(error == APIError(status: 402, code: "insufficient_balance", message: "Insufficient balance for the request"))
        let html = APIError.from(status: 502, data: Data("<html>bad gateway</html>".utf8))
        #expect(html.code == "request_failed")
        #expect(html.message == "The server ran into a problem. Try again in a moment.")
    }
}

@Suite("Transcript projection")
struct TranscriptTests {
    @Test func rendersTheActiveBranchOfTheFixture() throws {
        let chat = try decode(ChatDetail.self, Fixtures.branchedChat)
        let turns = Transcript.turns(for: chat)
        #expect(turns.map(\.id) == ["6509cd4c-e70d-4fbe-9b12-93eca7172a43", "651b3c88-035a-4689-ab8e-d500dcbafba6"])
        #expect(turns[0].userText == "Reply with a short markdown list of 3 fruits and one sentence.")
        #expect(turns[0].content.text == "- Apple\n- Banana\n- Orange\n\nThese are three popular fruits.")
        #expect(turns[1].assistantBranch == BranchPosition(ids: ["99ebb8a9-1fae-476d-9e43-f70af7ceabcd", "651b3c88-035a-4689-ab8e-d500dcbafba6"], index: 1))
        #expect(turns[1].assistantBranch?.previous == "99ebb8a9-1fae-476d-9e43-f70af7ceabcd")
        #expect(turns[1].assistantBranch?.next == nil)
        #expect(turns[0].thinkingDuration.map { abs($0 - 2.632) < 0.001 } == true)
    }

    @Test func walksFromTheLeafAndSurvivesCycles() {
        let responses = [response("a", parent: nil), response("b", parent: "a"), response("c", parent: "b"), response("x", parent: "a")]
        #expect(Transcript.lineage(responses, leafId: "c").map(\.id) == ["a", "b", "c"])
        #expect(Transcript.lineage(responses, leafId: "x").map(\.id) == ["a", "x"])
        #expect(Transcript.lineage(responses, leafId: "missing").isEmpty)
        let cyclic = [response("a", parent: "b"), response("b", parent: "a")]
        #expect(Transcript.lineage(cyclic, leafId: "a").map(\.id) == ["b", "a"])
    }

    @Test func findsTheNewestDescendant() {
        let responses = [response("a", parent: nil), response("b", parent: "a"), response("c", parent: "a"), response("d", parent: "c")]
        #expect(Transcript.newestDescendant(of: "a", in: responses) == "d")
        #expect(Transcript.newestDescendant(of: "b", in: responses) == "b")
    }

    @Test func foldsLiveSnapshotsIntoTheTranscript() {
        var detail = ChatDetail(id: "c", title: "t", modelId: "m", activeBranchLeafId: "r", createdAt: .now, updatedAt: .now)
        detail.responses = [response("r", parent: nil, text: "Hi", status: .queued)]
        var tracker = ResponseTracker(.queued("r"))
        tracker.receive(ResponseEvent(responseId: "r", sequence: 1, type: "response.output_text.delta", payload: ["delta": "Hello"], emittedAt: "2026-01-01T00:00:01.000Z"))
        let turns = Transcript.turns(for: detail, live: ["r": tracker.snapshot])
        #expect(turns.count == 1)
        #expect(turns[0].userText == "Hi")
        #expect(turns[0].status == .inProgress)
        #expect(turns[0].content.text == "Hello")
    }

    @Test func surfacesFailuresButNotCancellations() {
        var detail = ChatDetail(id: "c", title: "t", modelId: "m", activeBranchLeafId: "r", createdAt: .now, updatedAt: .now)
        var failed = response("r", parent: nil, status: .failed)
        failed.error = ["message": "Provider overloaded", "category": "rate_limit"]
        detail.responses = [failed]
        #expect(Transcript.turns(for: detail).first?.errorMessage == "Provider overloaded")
        failed.status = .cancelled
        failed.error = ["message": "Generation cancelled"]
        detail.responses = [failed]
        #expect(Transcript.turns(for: detail).first?.errorMessage == nil)
        #expect(Transcript.turns(for: detail).first?.isCancelled == true)
    }

    @Test func listsUserAttachments() {
        var detail = ChatDetail(id: "c", title: "t", modelId: "m", activeBranchLeafId: "r", createdAt: .now, updatedAt: .now)
        detail.attachments = [AttachmentSummary(id: "f", originalName: "cat.png", mimeType: "image/png", sizeBytes: 10)]
        detail.responses = [ChatResponse(
            id: "r", parentResponseId: nil, modelId: "m", status: .completed,
            input: [["role": "user", "content": [["type": "input_text", "text": "Look"], ["type": "input_file", "attachment_id": "f"]]]],
            createdAt: .now
        )]
        let turn = Transcript.turns(for: detail).first
        #expect(turn?.userAttachments == [AttachmentReference(id: "f", name: "cat.png", mimeType: "image/png", generated: false)])
        #expect(turn?.userAttachments.first?.isImage == true)
    }
}
