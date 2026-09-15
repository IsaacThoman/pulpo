import Foundation

struct Chat: Identifiable, Equatable {
    var value: JSON
    var id: String { value.id }
    var title: String { value["title"].optionalString ?? "New chat" }
    var modelID: String { value["modelId"].string }
    var folderID: String? { value["folderId"].optionalString }
    var pinned: Bool { value["pinned"].bool }
    var temporary: Bool { value["temporary"].bool }
    var turns: [Turn] {
        // Compact history includes inactive branch stubs. Walk the selected
        // lineage, exactly as the shared client does, instead of rendering them.
        let rows = value["responses"].array
        var byID: [String: JSON] = [:]
        for row in rows { byID[row.id] = row }
        var id = leafID.optionalString ?? rows.last?.id
        var seen = Set<String>(), result: [Turn] = []
        while let next = id, seen.insert(next).inserted, let row = byID[next] {
            if row["detailAvailable"] != .bool(false) { result.append(Turn(value: row)) }
            id = row["parentResponseId"].optionalString
        }
        return result.reversed()
    }
    var queue: [JSON] { value["queuedMessages"].array }
    var leafID: JSON { value["activeBranchLeafId"] == .null ? value["activeResponseId"] : value["activeBranchLeafId"] }
    var busy: Bool { value["responses"].array.contains { Turn(value: $0).busy } || !queue.isEmpty }
    var attachments: [JSON] { value["attachments"].array }
}
struct Turn: Identifiable, Equatable {
    var value: JSON
    var id: String { value.id }
    var status: String { value["snapshot"]["status"].optionalString ?? value["status"].string }
    var busy: Bool { ["queued", "in_progress"].contains(status) }
    var modelID: String { value["displayModelId"].optionalString ?? value["modelId"].string }
    var output: [JSON] { value["snapshot"]["output"] == .null ? value["output"].array : value["snapshot"]["output"].array }
    var prompt: String {
        Self.content(value["input"].array.last(where: { $0["role"].string == "user" })?["content"] ?? .null)
    }
    var text: String { output.filter { $0["type"].string == "message" }.map { Self.content($0["content"]) }.filter { !$0.isEmpty }.joined(separator: "\n\n") }
    var reasoning: String { output.filter { $0["type"].string == "reasoning" }.map { Self.content($0["summary"]) }.joined(separator: "\n\n") }
    var activities: [JSON] { output.filter { ["pulpo_tool", "pulpo_workspace", "pulpo_recall", "pulpo_compaction"].contains($0["type"].string) } }
    var generatedFiles: [JSON] { output.filter { $0["type"].string == "pulpo_attachment" }.map {
        ["id": $0["attachment_id"], "originalName": $0["name"], "mimeType": $0["mime_type"]]
    } }
    var inputFileIDs: [String] { value["input"].array.flatMap { $0["content"].array }.compactMap { $0["attachment_id"].optionalString } }
    var failure: String? { value["snapshot"]["error"]["message"].optionalString ?? value["error"]["message"].optionalString }
    var branches: [String] { value["branches"]["assistant"]["ids"].array.map(\.string) }
    var branchIndex: Int { value["branches"]["assistant"]["index"].int }
    static func content(_ value: JSON) -> String {
        if case .string(let v) = value { return v }
        return value.array.map { $0["text"].optionalString ?? $0["refusal"].optionalString ?? $0.string }.joined()
    }
}

/// A failed submission keeps its UUID and exact body for a safe, explicit retry.
struct Submission: Codable, Equatable {
    let key: String
    let path: String
    let body: JSON
    let draft: String
    let chatID: String
    static func make(chat: Chat?, text: String, modelID: String, presets: JSON, agent: Bool,
                     temporary: Bool, autoExpire: Bool) -> Submission {
        let key = UUID().uuidString.lowercased()
        let chatID = chat?.id ?? UUID().uuidString.lowercased()
        let response: JSON = ["clientId": .string(key), "input": .string(text), "modelId": .string(modelID),
            "parentResponseId": chat?.leafID ?? .null, "presetSelections": presets, "agentMode": .bool(agent),
            "attachmentIds": [], "timeZone": .string(TimeZone.current.identifier)]
        if let chat {
            let path = "/api/chats/\(API.resource(chat.id))/\(chat.busy ? "queued-messages" : "responses")"
            return Submission(key: key, path: path, body: response, draft: text, chatID: chatID)
        }
        return Submission(key: key, path: "/api/chats/start", body: ["chat": ["clientId": .string(chatID),
            "title": .string(String(text.prefix(80))), "modelId": .string(modelID),
            "temporary": .bool(temporary), "autoExpire": .bool(autoExpire && !temporary)], "response": response], draft: text, chatID: chatID)
    }
}
