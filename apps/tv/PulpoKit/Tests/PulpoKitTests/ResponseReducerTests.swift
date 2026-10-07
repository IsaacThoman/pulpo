import Testing
@testable import PulpoKit

// Mirrors `describe('response snapshot accumulation')` in
// packages/contracts/src/index.test.ts so both reducers stay identical.

private let responseId = "00000000-0000-4000-8000-000000000001"
private let streaming = ResponseSnapshot(
    responseId: responseId, status: .inProgress, sequence: 0, output: [], updatedAt: "2026-07-31T00:00:00.000Z"
)

private func delta(_ type: String, _ text: String, _ sequence: Int, itemId: String? = nil) -> ResponseEvent {
    var payload: [String: JSONValue] = ["delta": .string(text)]
    if let itemId { payload["item_id"] = .string(itemId) }
    return ResponseEvent(
        responseId: responseId, sequence: sequence, type: type, payload: .object(payload),
        emittedAt: "2026-07-31T00:00:0\(sequence).000Z"
    )
}

private func event(_ sequence: Int, _ type: String, _ payload: JSONValue) -> ResponseEvent {
    ResponseEvent(responseId: responseId, sequence: sequence, type: type, payload: payload, emittedAt: "2026-08-01T00:00:0\(sequence).000Z")
}

private func texts(_ output: [JSONValue]) -> [String] {
    output.map { ResponseContent.text(from: $0["content"] ?? $0["summary"]) }
}

@Suite("Response reducer")
struct ResponseReducerTests {
    @Test func doesNotLoseTextAcrossActiveSnapshotsWithoutOutput() {
        let first = ResponseReducer.apply(delta("response.output_text.delta", "chunk A", 1), to: streaming)
        var checkpointSnapshot = streaming
        checkpointSnapshot.sequence = 2
        let checkpoint = ResponseReducer.merge(first, checkpointSnapshot)
        let second = ResponseReducer.apply(delta("response.output_text.delta", " chunk B", 3), to: checkpoint)
        checkpointSnapshot.sequence = 4
        let nextCheckpoint = ResponseReducer.merge(second, checkpointSnapshot)
        let third = ResponseReducer.apply(delta("response.output_text.delta", " chunk C", 5), to: nextCheckpoint)
        #expect(texts(third.output) == ["chunk A chunk B chunk C"])
    }

    @Test func keepsSnapshotsAndEventsMonotonicBySequence() {
        let current = ResponseReducer.apply(delta("response.output_text.delta", "current", 3), to: streaming)
        let duplicate = ResponseReducer.apply(delta("response.output_text.delta", " duplicate", 3), to: current)
        var older = streaming
        older.sequence = 2
        #expect(duplicate == current)
        #expect(ResponseReducer.merge(current, older) == current)
    }

    @Test func usesSnapshotTimeAndTerminalStatusToOrderEqualSequences() {
        var current = streaming
        current.sequence = 3
        current.updatedAt = "2026-07-31T00:00:03.000Z"
        var stale = current
        stale.updatedAt = "2026-07-31T00:00:02.000Z"
        stale.output = [["stale": true]]
        var terminal = stale
        terminal.status = .completed
        #expect(ResponseReducer.merge(current, stale) == current)
        #expect(ResponseReducer.merge(current, terminal) == terminal)
        #expect(ResponseReducer.merge(terminal, current) == terminal)
    }

    @Test func upgradesEqualVersionEmptyOutputWithoutLaterDowngrade() {
        var empty = streaming
        empty.status = .completed
        empty.sequence = 3
        empty.updatedAt = "2026-07-31T00:00:03.000Z"
        var full = empty
        full.output = [["type": "message", "content": [["text": "Fetched branch"]]]]
        var newerEmpty = empty
        newerEmpty.updatedAt = "2026-07-31T00:00:04.000Z"
        #expect(ResponseReducer.merge(empty, full) == full)
        #expect(ResponseReducer.merge(full, empty) == full)
        var expected = newerEmpty
        expected.output = full.output
        #expect(ResponseReducer.merge(full, newerEmpty) == expected)
    }

    @Test func keepsReasoningSeparateFromAssistantOutput() {
        let reasoned = ResponseReducer.apply(delta("response.reasoning_summary_text.delta", "Think", 1), to: streaming)
        let answered = ResponseReducer.apply(delta("response.output_text.delta", "Answer", 2), to: reasoned)
        #expect(answered.output.map { $0["type"]?.stringValue } == ["reasoning", "message"])
        #expect(texts(answered.output) == ["Think", "Answer"])
        let content = ResponseContent(output: answered.output)
        #expect(content.text == "Answer")
        #expect(content.reasoning == "Think")
    }

    @Test func ignoresIndexesAndDurationsThatAreNotUsableNumbers() {
        let first = ResponseReducer.apply(delta("response.output_text.delta", "Hello", 1), to: streaming)
        let huge = ResponseReducer.apply(
            event(2, "response.output_text.delta", ["delta": " there", "output_index": .number(1e20), "content_index": .number(.nan)]), to: first
        )
        #expect(texts(huge.output) == ["Hello there"])
        let content = ResponseContent(output: [["type": "reasoning", "summary": "x", "durationMs": .number(1e300)]])
        #expect(content.reasoningDurationMs == nil)
        #expect(ResponseContent(output: [["type": "reasoning", "summary": "x", "durationMs": .number(1500.6)]]).reasoningDurationMs == 1501)
    }

    @Test func completesStreamedReasoningWithItsDuration() {
        let itemId = "agent:1:0:reasoning"
        let reasoned = ResponseReducer.apply(
            delta("response.reasoning_summary_text.delta", "Think", 1, itemId: itemId), to: streaming
        )
        let completed = ResponseReducer.apply(
            event(2, "pulpo.agent.reasoning.completed", ["id": .string(itemId), "durationMs": 5_000]), to: reasoned
        )
        #expect(completed.status == .inProgress)
        #expect(completed.output.count == 1)
        #expect(completed.output[0]["status"] == "completed")
        #expect(completed.output[0]["durationMs"] == 5_000)
        #expect(texts(completed.output) == ["Think"])
        #expect(ResponseContent(output: completed.output).reasoningDurationMs == 5_000)
    }

    @Test func projectsAgentToolWorkspaceCompactionAndAttachmentEvents() {
        let events = [
            event(1, "pulpo.agent.workspace.waiting", ["id": "workspace-1", "type": "pulpo_workspace", "state": "waiting"]),
            event(2, "pulpo.agent.tool.queued", [
                "id": "tool-1", "type": "pulpo_tool", "tool": "web_search", "arguments": ["query": "x"], "status": "queued", "output": "",
            ]),
            event(3, "pulpo.agent.tool.started", ["id": "tool-1", "type": "pulpo_tool", "status": "running"]),
            event(4, "pulpo.agent.tool.delta", ["id": "tool-1", "delta": "partial result"]),
            event(5, "pulpo.agent.tool.completed", ["id": "tool-1", "output": "final result", "isError": false, "durationMs": 10]),
            event(6, "pulpo.compaction.updated", ["id": "compact-1", "type": "pulpo_compaction", "status": "completed", "summary": "summary"]),
            event(7, "pulpo.agent.attachment.created", ["type": "pulpo_attachment", "attachment_id": "file-1", "name": "result.png", "mime_type": "image/png"]),
        ]
        let result = events.reduce(streaming) { ResponseReducer.apply($1, to: $0) }
        #expect(result.sequence == 7)
        #expect(result.output.count == 4)
        #expect(result.output[0]["state"] == "waiting")
        #expect(result.output[1]["tool"] == "web_search")
        #expect(result.output[1]["status"] == "completed")
        #expect(result.output[1]["output"] == "final result")
        #expect(result.output[2]["summary"] == "summary")
        #expect(result.output[3]["attachment_id"] == "file-1")

        let content = ResponseContent(output: result.output)
        #expect(content.activities.map(\.kind) == [.workspace, .tool, .compaction])
        #expect(content.activities[1].title == "Searched the web")
        #expect(content.activities[1].durationMs == 10)
        #expect(content.attachments == [AttachmentReference(id: "file-1", name: "result.png", mimeType: "image/png", generated: true)])
    }

    @Test func failedToolsAreMarkedFailed() {
        let result = [
            event(1, "pulpo.agent.tool.queued", ["id": "tool-1", "type": "pulpo_tool", "tool": "bash", "status": "queued"]),
            event(2, "pulpo.agent.tool.completed", ["id": "tool-1", "output": "boom", "isError": true]),
        ].reduce(streaming) { ResponseReducer.apply($1, to: $0) }
        #expect(result.output[0]["status"] == "failed")
        #expect(ResponseContent(output: result.output).activities.first?.isFailed == true)
    }

    @Test func projectsRecalledChats() {
        let recall: JSONValue = [
            "id": .string("\(responseId):recall"), "type": "pulpo_recall", "status": "completed",
            "sources": [["chat_id": "a", "response_id": "b", "title": "Earlier planning chat", "updated_at": "2026-08-27T00:00:00.000Z", "excerpt": "x"]],
        ]
        let result = ResponseReducer.apply(event(1, "pulpo.recall.completed", recall), to: streaming)
        #expect(result.output == [recall])
        let activity = ResponseContent(output: result.output).activities.first
        #expect(activity?.title == "Recalled from 1 chat")
        #expect(activity?.detail == "Earlier planning chat")
    }

    @Test func acceptsTerminalOutputAsAuthoritative() {
        let provisional = ResponseReducer.apply(delta("response.output_text.delta", "partial", 1), to: streaming)
        var terminal = streaming
        terminal.status = .completed
        terminal.sequence = 2
        terminal.output = [["type": "message", "content": [["type": "output_text", "text": "final answer"]]]]
        let merged = ResponseReducer.merge(provisional, terminal)
        #expect(merged.status == .completed)
        #expect(texts(merged.output) == ["final answer"])
    }

    @Test func appliesAgentDeltasToTheTargetedTurn() {
        var snapshot = streaming
        snapshot.sequence = 4
        snapshot.output = [
            ["id": "agent:1:0:message", "type": "message", "status": "completed", "content": [["type": "output_text", "text": "First turn"]]],
            ["id": "tool-1", "type": "pulpo_tool", "status": "completed"],
            ["id": "agent:2:0:message", "type": "message", "status": "in_progress", "content": [["type": "output_text", "text": "Second"]]],
        ]
        let result = ResponseReducer.apply(delta("response.output_text.delta", " turn", 5, itemId: "agent:2:0:message"), to: snapshot)
        #expect(texts(result.output) == ["First turn", "", "Second turn"])
    }

    @Test func startsDistinctMessageWhenNewAgentTurnDeltaPrecedesSnapshot() {
        var snapshot = streaming
        snapshot.sequence = 4
        snapshot.output = [
            ["id": "agent:1:0:message", "type": "message", "status": "in_progress", "content": [["type": "output_text", "text": "First turn"]]],
            ["id": "tool-1", "type": "pulpo_tool", "status": "completed"],
        ]
        let started = ResponseReducer.apply(delta("response.output_text.delta", "Second", 5, itemId: "agent:2:0:message"), to: snapshot)
        let continued = ResponseReducer.apply(delta("response.output_text.delta", " turn", 6, itemId: "agent:2:0:message"), to: started)
        #expect(continued.output.map { $0["id"]?.stringValue } == ["agent:1:0:message", "tool-1", "agent:2:0:message"])
        #expect(texts(continued.output) == ["First turn", "", "Second turn"])
    }

    @Test func startsDistinctReasoningForUncheckpointedTargetedItem() {
        var snapshot = streaming
        snapshot.sequence = 7
        snapshot.output = [[
            "id": "agent:1:0:reasoning", "type": "reasoning", "status": "in_progress",
            "summary": [["type": "summary_text", "text": "First thought"]],
        ]]
        let result = ResponseReducer.apply(
            delta("response.reasoning_summary_text.delta", "Next thought", 8, itemId: "agent:2:0:reasoning"), to: snapshot
        )
        #expect(texts(result.output) == ["First thought", "Next thought"])
    }

    @Test func untargetedDeltasJoinTheActiveTailItem() {
        // The Codex provider path sends only `{ delta }`.
        let first = ResponseReducer.apply(event(1, "response.output_text.delta", ["delta": "Hello"]), to: streaming)
        let second = ResponseReducer.apply(event(2, "response.output_text.delta", ["delta": ", world"]), to: first)
        #expect(texts(second.output) == ["Hello, world"])
    }

    @Test func outputIndexTargetsMatchingItemType() {
        var snapshot = streaming
        snapshot.output = [
            ["type": "reasoning", "status": "completed", "summary": [["type": "summary_text", "text": "R"]]],
            ["type": "message", "status": "completed", "content": [["type": "output_text", "text": "A"]]],
        ]
        let result = ResponseReducer.apply(event(1, "response.output_text.delta", ["delta": "B", "output_index": 1]), to: snapshot)
        #expect(texts(result.output) == ["R", "AB"])
    }

    @Test func queuedBecomesInProgressAndRecordsFirstReplyTime() {
        let queued = ResponseSnapshot.queued(responseId)
        let started = ResponseReducer.apply(event(1, "response.created", ["response": ["status": "in_progress", "output": []]]), to: queued)
        #expect(started.status == .inProgress)
        #expect(started.firstReplyTextAt == nil)
        let replied = ResponseReducer.apply(event(2, "response.output_text.delta", ["delta": "Hi"]), to: started)
        #expect(replied.firstReplyTextAt == "2026-08-01T00:00:02.000Z")
        let later = ResponseReducer.apply(event(3, "response.output_text.delta", ["delta": "!"]), to: replied)
        #expect(later.firstReplyTextAt == "2026-08-01T00:00:02.000Z")
    }

    @Test func whitespaceDeltasDoNotCountAsReplyText() {
        #expect(!ResponseReducer.eventHasAssistantReplyText(type: "response.output_text.delta", payload: ["delta": "  \n"]))
        #expect(ResponseReducer.eventHasAssistantReplyText(type: "response.output_item.done", payload: [
            "item": ["type": "message", "role": "assistant", "content": [["type": "output_text", "text": "x"]]],
        ]))
        #expect(!ResponseReducer.eventHasAssistantReplyText(type: "response.output_item.done", payload: [
            "item": ["type": "reasoning", "summary": [["type": "summary_text", "text": "x"]]],
        ]))
        #expect(ResponseReducer.eventHasAssistantReplyText(type: "response.completed", payload: [
            "response": ["output": [["type": "message", "content": "done"]]],
        ]))
    }
}

@Suite("Response tracker")
struct ResponseTrackerTests {
    @Test func buffersOutOfOrderEventsUntilTheGapFills() {
        var tracker = ResponseTracker(.queued(responseId))
        let changed1 = tracker.receive(delta("response.output_text.delta", " world", 2))
        #expect(!changed1)
        #expect(tracker.sequence == 0)
        let changed2 = tracker.receive(delta("response.output_text.delta", "Hello", 1))
        #expect(changed2)
        #expect(tracker.sequence == 2)
        #expect(ResponseContent(output: tracker.snapshot.output).text == "Hello world")
    }

    @Test func ignoresOtherResponsesAndDuplicates() {
        var tracker = ResponseTracker(.queued(responseId))
        let foreign = ResponseEvent(responseId: "other", sequence: 1, type: "response.output_text.delta", payload: ["delta": "x"], emittedAt: "")
        let changed3 = tracker.receive(foreign)
        #expect(!changed3)
        let changed4 = tracker.receive(delta("response.output_text.delta", "A", 1))
        #expect(changed4)
        let changed5 = tracker.receive(delta("response.output_text.delta", "A", 1))
        #expect(!changed5)
        #expect(ResponseContent(output: tracker.snapshot.output).text == "A")
    }

    @Test func snapshotsSkipBufferedEventsTheyCover() {
        var tracker = ResponseTracker(.queued(responseId))
        tracker.receive(delta("response.output_text.delta", "late", 3))
        var snapshot = streaming
        snapshot.sequence = 3
        snapshot.output = [["type": "message", "status": "in_progress", "content": [["type": "output_text", "text": "Server text"]]]]
        let changed6 = tracker.receive(snapshot)
        #expect(changed6)
        #expect(ResponseContent(output: tracker.snapshot.output).text == "Server text")
        tracker.receive(delta("response.output_text.delta", " continues", 4))
        #expect(ResponseContent(output: tracker.snapshot.output).text == "Server text continues")
    }

    @Test func terminalSnapshotEndsTheStream() {
        var tracker = ResponseTracker(.queued(responseId))
        var done = streaming
        done.status = .completed
        done.sequence = 9
        tracker.receive(done)
        #expect(tracker.isTerminal)
    }

    @Test func cancellationAcknowledgementWinsEvenWithAnOlderSequence() {
        var tracker = ResponseTracker(.queued(responseId))
        tracker.receive(delta("response.output_text.delta", "Partial", 1))
        tracker.markCancelled()
        #expect(tracker.snapshot.status == .cancelled)
        #expect(ResponseContent(output: tracker.snapshot.output).text == "Partial")
    }
}
