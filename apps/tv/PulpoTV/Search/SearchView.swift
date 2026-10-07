import PulpoKit
import SwiftUI

/// Full-text search across every chat's title and messages.
struct SearchView: View {
    let library: LibraryModel
    let open: (Route) -> Void
    @State private var query = ""
    @State private var results: [ChatSummary] = []
    @State private var searchedQuery = ""
    @State private var isSearching = false
    @State private var error: String?

    private let columns = [GridItem(.adaptive(minimum: 400, maximum: 520), spacing: 48, alignment: .top)]

    var body: some View {
        ScrollView {
            Group {
                if trimmedQuery.isEmpty {
                    recent
                } else if let error {
                    MessageState(systemImage: "exclamationmark.magnifyingglass", title: "Search isn’t working right now", message: error)
                        .frame(height: 500)
                } else if results.isEmpty, !isSearching, searchedQuery == trimmedQuery {
                    MessageState(systemImage: "magnifyingglass", title: "No results", message: "No chats mention “\(trimmedQuery)”.")
                        .frame(height: 500)
                } else {
                    grid(results.map { library.chat(id: $0.id) ?? $0 })
                }
            }
            .padding(.horizontal, Theme.screenPadding)
            .padding(.vertical, 40)
        }
        .scrollClipDisabled()
        .searchable(text: $query, prompt: "Search your chats")
        .task(id: trimmedQuery) { await search(trimmedQuery) }
    }

    private var trimmedQuery: String { query.trimmingCharacters(in: .whitespacesAndNewlines) }

    @ViewBuilder private var recent: some View {
        let chats = Array(library.chats.sorted { $0.updatedAt > $1.updatedAt }.prefix(8))
        if !chats.isEmpty {
            VStack(alignment: .leading, spacing: 30) {
                SectionTitle(title: "Recent")
                LazyVGrid(columns: columns, alignment: .leading, spacing: 56) {
                    ForEach(chats) { chat in
                        ChatCard(chat: chat, library: library) { open(.chat(id: chat.id)) }
                    }
                }
            }
        }
    }

    private func grid(_ chats: [ChatSummary]) -> some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 56) {
            ForEach(chats) { chat in
                ChatCard(chat: chat, library: library) { open(.chat(id: chat.id)) }
            }
        }
    }

    private func search(_ text: String) async {
        guard !text.isEmpty else {
            results = []
            error = nil
            return
        }
        // Wait for typing to pause before asking the server.
        try? await Task.sleep(for: .milliseconds(350))
        guard !Task.isCancelled else { return }
        isSearching = true
        defer { isSearching = false }
        do {
            let found = try await library.api.searchChats(text)
            guard !Task.isCancelled else { return }
            results = found
            searchedQuery = text
            error = nil
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
            await library.report(error)
        }
    }
}
