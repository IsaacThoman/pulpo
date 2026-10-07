import PulpoKit
import SwiftUI

/// The landing screen: a greeting, ways to start a chat, and every chat by
/// how recently it was used.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    let library: LibraryModel
    let open: (Route) -> Void
    @State private var folderId: String?
    @FocusState private var newChatFocused: Bool
    @State private var placedInitialFocus = false

    private let columns = [GridItem(.adaptive(minimum: 400, maximum: 520), spacing: 48, alignment: .top)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 64) {
                Greeting(user: library.user)
                startRow
                if !library.folders.isEmpty {
                    FolderFilter(folders: library.folders, selection: $folderId)
                }
                history
            }
            .padding(.horizontal, Theme.screenPadding)
            .padding(.top, 40)
            .padding(.bottom, 80)
        }
        .scrollClipDisabled()
        .defaultFocus($newChatFocused, true)
        .task {
            // The sidebar takes focus at launch; start on New Chat instead.
            // Signing in can still be dismissing its keyboard, so try twice.
            guard !placedInitialFocus else { return }
            placedInitialFocus = true
            for delay in [250, 700] {
                try? await Task.sleep(for: .milliseconds(delay))
                newChatFocused = true
            }
        }
        .alert("Something went wrong", isPresented: Binding(
            get: { library.actionError != nil },
            set: { if !$0 { library.actionError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(library.actionError ?? "")
        }
    }

    private var startRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 48) {
                NewChatCard(model: library.defaultModel) { open(.new()) }
                    .focused($newChatFocused)
                if library.settings?.showPromptSuggestions != false {
                    ForEach(library.suggestions) { prompt in
                        SuggestionCard(prompt: prompt) { open(.new(prompt: prompt.message)) }
                    }
                }
            }
            .padding(.vertical, 30)
        }
        .scrollClipDisabled()
        .focusSection()
    }

    @ViewBuilder private var history: some View {
        let sections = library.sections(folderId: folderId)
        switch library.state {
        case .idle where sections.isEmpty, .loading where sections.isEmpty:
            HStack {
                Spacer()
                ProgressView("Loading your chats…")
                Spacer()
            }
            .padding(.top, 60)
        case .failed(let message) where sections.isEmpty:
            MessageState(
                systemImage: "wifi.exclamationmark", title: "Couldn’t load your chats", message: message,
                actionTitle: "Try Again"
            ) {
                Task { await library.refreshAll() }
            }
            .frame(height: 500)
        default:
            if sections.isEmpty {
                EmptyHistory(filtered: folderId != nil)
            } else {
                ForEach(sections) { section in
                    VStack(alignment: .leading, spacing: 30) {
                        SectionTitle(title: section.title)
                        LazyVGrid(columns: columns, alignment: .leading, spacing: 56) {
                            ForEach(section.chats) { chat in
                                ChatCard(chat: chat, library: library) { open(.chat(id: chat.id)) }
                            }
                        }
                    }
                    .focusSection()
                }
            }
        }
    }
}

private struct Greeting: View {
    let user: User

    var body: some View {
        HStack(spacing: 36) {
            BrandMark(size: 120, glowing: true)
            VStack(alignment: .leading, spacing: 8) {
                Text("\(salutation), \(user.firstName)")
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.text)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text("What would you like to talk about?")
                    .font(.title3)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var salutation: String {
        switch Calendar.current.component(.hour, from: .now) {
        case 5..<12: "Good morning"
        case 12..<17: "Good afternoon"
        default: "Good evening"
        }
    }
}

private struct FolderFilter: View {
    let folders: [Folder]
    @Binding var selection: String?

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 24) {
                chip("All Chats", systemImage: "tray.full", id: nil)
                ForEach(folders) { folder in
                    chip(folder.name, systemImage: "folder", id: folder.id)
                }
            }
            .padding(.vertical, 20)
        }
        .scrollClipDisabled()
        .focusSection()
    }

    private func chip(_ title: String, systemImage: String, id: String?) -> some View {
        Button {
            selection = id
        } label: {
            Label(title, systemImage: selection == id ? "checkmark" : systemImage)
                .font(.callout.weight(selection == id ? .bold : .medium))
        }
        .buttonStyle(.bordered)
        .accessibilityAddTraits(selection == id ? .isSelected : [])
    }
}

private struct EmptyHistory: View {
    let filtered: Bool

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: filtered ? "folder" : "bubble.left.and.text.bubble.right")
                .font(.system(size: 72))
                .foregroundStyle(Theme.tertiaryText)
            Text(filtered ? "No chats in this folder" : "No chats yet")
                .font(.title3.weight(.semibold))
            Text(filtered ? "Chats you file here on another device appear here." : "Start a new chat and it will appear here, and on all your other devices.")
                .font(.callout)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 40)
    }
}
