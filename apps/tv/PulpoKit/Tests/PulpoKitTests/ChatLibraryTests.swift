import Foundation
import Testing
@testable import PulpoKit

private let calendar: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/Chicago")!
    return calendar
}()

private let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: 6, hour: 15))!

private func chat(_ id: String, hoursAgo: Double, pinned: Bool = false, sortOrder: Int = 0, folder: String? = nil, temporary: Bool = false) -> ChatSummary {
    let date = now.addingTimeInterval(-hoursAgo * 3_600)
    return ChatSummary(
        id: id, title: id, modelId: "m", pinned: pinned, folderId: folder, sortOrder: sortOrder,
        temporary: temporary, createdAt: date, updatedAt: date
    )
}

@Suite("Chat library")
struct ChatLibraryTests {
    @Test func groupsPinnedThenByRecency() {
        let sections = ChatLibrary.sections([
            chat("old", hoursAgo: 24 * 40),
            chat("today", hoursAgo: 1),
            chat("pinnedB", hoursAgo: 5, pinned: true, sortOrder: 1),
            chat("yesterday", hoursAgo: 20),
            chat("pinnedA", hoursAgo: 50, pinned: true, sortOrder: 0),
            chat("temp", hoursAgo: 0, temporary: true),
            chat("today2", hoursAgo: 0.5),
        ])
        #expect(sections.map(\.title) == ["Pinned", "Recent"])
        #expect(sections.map { $0.chats.map(\.id) } == [["pinnedA", "pinnedB"], ["today2", "today", "yesterday", "old"]])
    }

    @Test func omitsEmptySections() {
        #expect(ChatLibrary.sections([]).isEmpty)
        #expect(ChatLibrary.sections([chat("a", hoursAgo: 1)]).map(\.title) == ["Recent"])
    }

    @Test func filtersByFolder() {
        let sections = ChatLibrary.sections([
            chat("a", hoursAgo: 1, folder: "f1"), chat("b", hoursAgo: 1, folder: "f2"), chat("c", hoursAgo: 2),
        ], folderId: "f1")
        #expect(sections.flatMap(\.chats).map(\.id) == ["a"])
    }

    @Test func splitsTheGeneratedTitleEmoji() {
        #expect(ChatTitle("🍎 Three Popular Fruits") == ChatTitle(emoji: "🍎", text: "Three Popular Fruits"))
        #expect(ChatTitle("👩🏽‍💻 Debugging Swift") == ChatTitle(emoji: "👩🏽‍💻", text: "Debugging Swift"))
        #expect(ChatTitle("❤️ Love") == ChatTitle(emoji: "❤️", text: "Love"))
        #expect(ChatTitle("3 ways to cook") == ChatTitle(emoji: nil, text: "3 ways to cook"))
        #expect(ChatTitle("#1 priority") == ChatTitle(emoji: nil, text: "#1 priority"))
        #expect(ChatTitle("  ") == ChatTitle(emoji: nil, text: "New chat"))
        #expect(ChatTitle("🔥") == ChatTitle(emoji: "🔥", text: "🔥"))
    }

    @Test func picksTheDefaultModel() {
        let models = [AIModel(id: "a", name: "A"), AIModel(id: "b", name: "B")]
        #expect(ChatLibrary.defaultModel(models, settings: AccountSettings(defaultModelId: "b"))?.id == "b")
        #expect(ChatLibrary.defaultModel(models, settings: AccountSettings(defaultModelId: "gone"))?.id == "a")
        #expect(ChatLibrary.defaultModel(models, settings: nil)?.id == "a")
        #expect(ChatLibrary.defaultModel([], settings: nil) == nil)
    }

    @Test func formatsRelativeTimes() {
        #expect(RelativeTime.label(for: now.addingTimeInterval(-20), now: now, calendar: calendar) == "Just now")
        #expect(RelativeTime.label(for: now.addingTimeInterval(-5 * 60), now: now, calendar: calendar) == "5 min ago")
        #expect(RelativeTime.label(for: now.addingTimeInterval(-3 * 3_600), now: now, calendar: calendar) == "3 hr ago")
        #expect(RelativeTime.label(for: now.addingTimeInterval(-20 * 3_600), now: now, calendar: calendar) == "Yesterday")
    }
}

@Suite("Users")
struct UserTests {
    @Test func derivesInitialsAndFirstName() {
        let user = User(id: "1", email: "a@b.c", name: "Preview Admin", username: "preview_admin")
        #expect(user.initials == "PA")
        #expect(user.firstName == "Preview")
        let single = User(id: "1", email: "a@b.c", name: "cher", username: "cher")
        #expect(single.initials == "C")
    }
}
