import Foundation

/// Swift port of `applyResponseEventToSnapshot` and `mergeResponseSnapshots`
/// from `packages/contracts/src/index.ts`. Keep the two in step: every client
/// must fold realtime events into identical snapshots.
public enum ResponseReducer {
    public static func apply(_ event: ResponseEvent, to snapshot: ResponseSnapshot) -> ResponseSnapshot {
        guard event.sequence > snapshot.sequence else { return snapshot }
        let payload = event.payload
        let delta = payload["delta"]?.stringValue ?? ""
        var output = snapshot.output
        if !delta.isEmpty, event.type == "response.output_text.delta" {
            output = appendOutputText(output, delta: delta, payload: payload)
        }
        if !delta.isEmpty, event.type == "response.reasoning_summary_text.delta" {
            output = appendReasoning(output, delta: delta, payload: payload)
        }
        output = applyAgentEventOutput(output, event: event)

        var next = snapshot
        if next.status == .queued { next.status = .inProgress }
        next.sequence = event.sequence
        next.output = output
        next.requestReceivedAt = snapshot.requestReceivedAt ?? event.requestReceivedAt
        next.firstReplyTextAt = snapshot.firstReplyTextAt ?? event.firstReplyTextAt
            ?? (eventHasAssistantReplyText(type: event.type, payload: event.payload) ? event.emittedAt : nil)
        next.updatedAt = event.emittedAt
        return next
    }

    public static func merge(_ current: ResponseSnapshot, _ incoming: ResponseSnapshot) -> ResponseSnapshot {
        guard incoming.sequence >= current.sequence else { return current }
        let requestReceivedAt = current.requestReceivedAt ?? incoming.requestReceivedAt
        let firstReplyTextAt = current.firstReplyTextAt ?? incoming.firstReplyTextAt
        var current = current
        var incoming = incoming
        current.requestReceivedAt = requestReceivedAt
        current.firstReplyTextAt = firstReplyTextAt
        incoming.requestReceivedAt = requestReceivedAt
        incoming.firstReplyTextAt = firstReplyTextAt

        if incoming.sequence == current.sequence {
            let currentTerminal = current.status.isTerminal
            let incomingTerminal = incoming.status.isTerminal
            if currentTerminal, !incomingTerminal { return current }
            if incomingTerminal, !currentTerminal {
                if incoming.output.isEmpty, !current.output.isEmpty { incoming.output = current.output }
                return incoming
            }
            if incoming.updatedAt < current.updatedAt { return current }
            if incoming.updatedAt == current.updatedAt {
                if current.output.isEmpty, !incoming.output.isEmpty { return incoming }
                return current
            }
            if incoming.output.isEmpty, !current.output.isEmpty {
                incoming.output = current.output
                return incoming
            }
        }
        if incoming.status.isActive, incoming.output.isEmpty, !current.output.isEmpty {
            incoming.output = current.output
        }
        return incoming
    }

    // MARK: - Reply timing

    /// Only reply text ends the initial wait; reasoning and tools do not.
    public static func eventHasAssistantReplyText(type: String, payload: JSONValue) -> Bool {
        guard case .object = payload else { return false }
        switch type {
        case "response.output_text.delta", "response.output_text.done", "response.refusal.delta", "response.refusal.done":
            let text = payload["delta"] ?? payload["text"] ?? payload["refusal"]
            return text?.stringValue.map { !$0.isBlank } ?? false
        case "response.output_item.added", "response.output_item.done":
            return hasAssistantReplyText([payload["item"] ?? .null])
        case "response.content_part.added", "response.content_part.done":
            return hasAssistantReplyText([.object(["type": "message", "content": .array([payload["part"] ?? .null])])])
        default:
            guard type.hasPrefix("response.") else { return false }
            return hasAssistantReplyText(payload["response"]?["output"]?.arrayValue ?? [])
        }
    }

    public static func hasAssistantReplyText(_ output: [JSONValue]) -> Bool {
        output.contains { item in
            guard item["type"]?.stringValue == "message" else { return false }
            if let role = item["role"]?.stringValue, role != "assistant" { return false }
            if let text = item["content"]?.stringValue { return !text.isBlank }
            return item["content"]?.arrayValue?.contains { part in
                let text = part.stringValue ?? (part["text"] ?? part["content"] ?? part["refusal"])?.stringValue
                return text.map { !$0.isBlank } ?? false
            } ?? false
        }
    }

    // MARK: - Delta targeting

    private static func string(_ payload: JSONValue, _ keys: String...) -> String? {
        for key in keys { if let value = payload[key]?.stringValue { return value } }
        return nil
    }

    private static func number(_ payload: JSONValue, _ keys: String...) -> Double? {
        for key in keys { if case .number(let value) = payload[key] { return value } }
        return nil
    }

    private static func targetItemIndex(_ output: [JSONValue], payload: JSONValue, type: String) -> Int? {
        if let itemId = string(payload, "item_id", "itemId") {
            // A targeted delta for an unseen item starts a new item rather
            // than joining the previous agent turn.
            return output.firstIndex { $0["id"]?.stringValue == itemId }
        }
        if let outputIndex = number(payload, "output_index", "outputIndex").flatMap(Int.init(exactly:)),
           output.indices.contains(outputIndex), output[outputIndex]["type"]?.stringValue == type {
            return outputIndex
        }
        if let agentTurn = number(payload, "agent_turn"), let contentIndex = number(payload, "content_index", "contentIndex") {
            let match = output.firstIndex {
                $0["type"]?.stringValue == type
                    && $0["agent_turn"] == .number(agentTurn)
                    && $0["agent_content_index"] == .number(contentIndex)
            }
            if let match { return match }
        }
        // Untargeted events belong to the currently active tail item.
        if let active = output.lastIndex(where: { $0["type"]?.stringValue == type && $0["status"]?.stringValue == "in_progress" }) {
            return active
        }
        return output.lastIndex { $0["type"]?.stringValue == type }
    }

    private static func appendOutputText(_ output: [JSONValue], delta: String, payload: JSONValue) -> [JSONValue] {
        var output = output
        var message: [String: JSONValue]
        let index = targetItemIndex(output, payload: payload, type: "message")
        if let index, case .object(let existing) = output[index] {
            message = existing
        } else {
            message = ["type": "message", "role": "assistant", "status": "in_progress", "content": .array([])]
            if let itemId = string(payload, "item_id", "itemId") { message["id"] = .string(itemId) }
        }
        var content = message["content"]?.arrayValue ?? []
        let contentIndex = number(payload, "content_index", "contentIndex").flatMap(Int.init(exactly:))
        let partIndex: Int? = if let contentIndex, content.indices.contains(contentIndex),
                                 content[contentIndex]["type"]?.stringValue == "output_text" {
            contentIndex
        } else {
            content.firstIndex { $0["type"]?.stringValue == "output_text" }
        }
        var part: [String: JSONValue] = ["type": "output_text", "text": ""]
        if let partIndex, case .object(let existing) = content[partIndex] { part = existing }
        part["text"] = .string((part["text"]?.stringValue ?? "") + delta)
        if let partIndex { content[partIndex] = .object(part) } else { content.append(.object(part)) }
        message["content"] = .array(content)
        if let index, case .object = output[index] { output[index] = .object(message) } else { output.append(.object(message)) }
        return output
    }

    private static func appendReasoning(_ output: [JSONValue], delta: String, payload: JSONValue) -> [JSONValue] {
        var output = output
        var reasoning: [String: JSONValue]
        let index = targetItemIndex(output, payload: payload, type: "reasoning")
        if let index, case .object(let existing) = output[index] {
            reasoning = existing
        } else {
            reasoning = ["type": "reasoning", "status": "in_progress", "summary": .array([])]
            if let itemId = string(payload, "item_id", "itemId") { reasoning["id"] = .string(itemId) }
        }
        var summary = reasoning["summary"]?.arrayValue ?? []
        let partIndex = summary.firstIndex { $0["type"]?.stringValue == "summary_text" }
        var part: [String: JSONValue] = ["type": "summary_text", "text": ""]
        if let partIndex, case .object(let existing) = summary[partIndex] { part = existing }
        part["text"] = .string((part["text"]?.stringValue ?? "") + delta)
        if let partIndex { summary[partIndex] = .object(part) } else { summary.append(.object(part)) }
        reasoning["summary"] = .array(summary)
        if let index, case .object = output[index] { output[index] = .object(reasoning) } else { output.append(.object(reasoning)) }
        return output
    }

    private static func upsert(
        _ output: [JSONValue], where match: ([String: JSONValue]) -> Bool, value: [String: JSONValue]
    ) -> [JSONValue] {
        var output = output
        let index = output.firstIndex {
            if case .object(let item) = $0 { return match(item) }
            return false
        }
        if let index, case .object(let existing) = output[index] {
            output[index] = .object(existing.merging(value) { _, new in new })
        } else {
            output.append(.object(value))
        }
        return output
    }

    private static func applyAgentEventOutput(_ output: [JSONValue], event: ResponseEvent) -> [JSONValue] {
        guard case .object(let payload) = event.payload else { return output }
        let id = payload["id"]?.stringValue
        let type = event.type
        if type == "pulpo.recall.completed", let id {
            return upsert(output, where: { $0["type"]?.stringValue == "pulpo_recall" && $0["id"]?.stringValue == id }, value: payload)
        }
        if type.hasPrefix("pulpo.agent.workspace.") {
            return upsert(output, where: { $0["type"]?.stringValue == "pulpo_workspace" }, value: payload)
        }
        if type == "pulpo.compaction.updated", let id {
            return upsert(output, where: { $0["id"]?.stringValue == id }, value: payload)
        }
        if type == "pulpo.agent.cost_limit", let id {
            return upsert(output, where: { $0["type"]?.stringValue == "pulpo_cost_limit" && $0["id"]?.stringValue == id }, value: payload)
        }
        if type == "pulpo.agent.attachment.created", let attachmentId = payload["attachment_id"]?.stringValue {
            return upsert(output, where: {
                $0["type"]?.stringValue == "pulpo_attachment" && $0["attachment_id"]?.stringValue == attachmentId
            }, value: payload)
        }
        if type == "pulpo.agent.reasoning.completed", let id {
            var value = payload
            value["type"] = "reasoning"
            value["status"] = "completed"
            return upsert(output, where: { $0["id"]?.stringValue == id }, value: value)
        }
        guard type.hasPrefix("pulpo.agent.tool."), let id else { return output }
        if type == "pulpo.agent.tool.delta" {
            return upsert(output, where: { $0["id"]?.stringValue == id }, value: [
                "id": .string(id), "type": "pulpo_tool",
                "output": .string(payload["delta"]?.stringValue ?? ""), "status": "running",
            ])
        }
        if type == "pulpo.agent.tool.completed" {
            var value = payload
            value["type"] = "pulpo_tool"
            value["status"] = payload["isError"] == .bool(true) ? "failed" : "completed"
            return upsert(output, where: { $0["id"]?.stringValue == id }, value: value)
        }
        return upsert(output, where: { $0["id"]?.stringValue == id }, value: payload)
    }
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral,
    ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral, ExpressibleByNilLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        self = .object(Dictionary(elements, uniquingKeysWith: { _, new in new }))
    }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(nilLiteral: ()) { self = .null }
}

extension String {
    var isBlank: Bool { allSatisfy(\.isWhitespace) }
}
