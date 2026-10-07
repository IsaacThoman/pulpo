import Foundation

/// A chat title split into the emoji the server's title generator prefixes
/// ("🍎 Three Popular Fruits") and the words after it.
public struct ChatTitle: Hashable, Sendable {
    public let emoji: String?
    public let text: String

    init(emoji: String?, text: String) {
        self.emoji = emoji
        self.text = text
    }

    public init(_ title: String) {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first, first.isEmojiGlyph else {
            emoji = nil
            text = trimmed.isEmpty ? "New chat" : trimmed
            return
        }
        let rest = trimmed.dropFirst().trimmingCharacters(in: .whitespacesAndNewlines)
        emoji = String(first)
        text = rest.isEmpty ? String(first) : rest
    }
}

extension Character {
    /// True for characters drawn as emoji. Digits, `#` and `*` are emoji only
    /// as keycap sequences, so a lone scalar must have emoji presentation.
    var isEmojiGlyph: Bool {
        guard let first = unicodeScalars.first else { return false }
        if first.properties.isEmojiPresentation { return true }
        return first.properties.isEmoji && unicodeScalars.count > 1
    }
}

public struct ChatSection: Hashable, Sendable, Identifiable {
    public let title: String
    public let chats: [ChatSummary]
    public var id: String { title }
}

public enum ChatLibrary {
    /// Pinned chats in their manual order, then everything else by last
    /// activity. On a television, picking up where you left off matters more
    /// than manual filing, and one dense grid reads better than many short
    /// date groups; each card shows when it was last used.
    public static func sections(_ chats: [ChatSummary], folderId: String? = nil) -> [ChatSection] {
        let visible = chats.filter { !$0.temporary && (folderId == nil || $0.folderId == folderId) }
        let pinned = visible.filter(\.pinned).sorted(by: manualOrder)
        let recent = visible.filter { !$0.pinned }.sorted { $0.updatedAt > $1.updatedAt }
        var sections: [ChatSection] = []
        if !pinned.isEmpty { sections.append(ChatSection(title: "Pinned", chats: pinned)) }
        if !recent.isEmpty { sections.append(ChatSection(title: "Recent", chats: recent)) }
        return sections
    }

    /// Manual order first, newest first among ties (matches the web sidebar).
    public static func manualOrder(_ left: ChatSummary, _ right: ChatSummary) -> Bool {
        if left.sortOrder != right.sortOrder { return left.sortOrder < right.sortOrder }
        return left.createdAt > right.createdAt
    }

    /// The model a new chat should use: the account default when it is still
    /// offered, otherwise the first model in the catalog.
    public static func defaultModel(_ models: [AIModel], settings: AccountSettings?) -> AIModel? {
        if let id = settings?.defaultModelId, let model = models.first(where: { $0.id == id }) { return model }
        return models.first
    }
}

public enum RelativeTime {
    /// "Just now", "5 min ago", "3 hr ago", "Yesterday", "Mon", "Sep 12", "Sep 12, 2025".
    public static func label(for date: Date, now: Date = Date(), calendar: Calendar = .current) -> String {
        let seconds = now.timeIntervalSince(date)
        if seconds < 60 { return "Just now" }
        if seconds < 3_600 { return "\(Int(seconds / 60)) min ago" }
        if calendar.isDate(date, inSameDayAs: now) { return "\(Int(seconds / 3_600)) hr ago" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        if seconds < 6 * 86_400 { return date.formatted(.dateTime.weekday(.wide)) }
        if calendar.component(.year, from: date) == calendar.component(.year, from: now) {
            return date.formatted(.dateTime.month(.abbreviated).day())
        }
        return date.formatted(.dateTime.month(.abbreviated).day().year())
    }
}
