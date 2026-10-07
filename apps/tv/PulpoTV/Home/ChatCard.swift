import PulpoKit
import SwiftUI

/// A chat in a grid: its title emoji, title, and when and with which model it
/// was last active. Uses the system card style for the tvOS lift-on-focus.
struct ChatCard: View {
    let chat: ChatSummary
    let library: LibraryModel
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            let title = ChatTitle(chat.title)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .top) {
                    if let emoji = title.emoji {
                        Text(emoji).font(.system(size: 60))
                    } else {
                        ModelIcon(model: library.model(id: chat.modelId), size: 64)
                    }
                    Spacer(minLength: 0)
                    if chat.isGenerating {
                        LiveDot().padding(.top, 12)
                    } else if chat.pinned {
                        Image(systemName: "pin.fill")
                            .font(.callout)
                            .foregroundStyle(Theme.secondaryText)
                            .rotationEffect(.degrees(45))
                    }
                }
                Spacer(minLength: 14)
                Text(title.text)
                    .font(.headline)
                    .foregroundStyle(Theme.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(Theme.secondaryText)
                    .lineLimit(1)
                    .padding(.top, 8)
            }
            .padding(30)
            .frame(height: 284)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.card)
        .chatContextMenu(chat, library: library)
        .accessibilityIdentifier("chat-card")
        .accessibilityLabel(Text(ChatTitle(chat.title).text))
        .accessibilityValue(Text(caption))
    }

    private var caption: String {
        let time = chat.isGenerating ? "Replying now" : RelativeTime.label(for: chat.updatedAt)
        return "\(time) · \(library.modelName(chat.modelId))"
    }
}

/// The large card that starts a new chat.
struct NewChatCard: View {
    let model: AIModel?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "plus.bubble.fill")
                    .font(.system(size: 54, weight: .semibold))
                    .foregroundStyle(Theme.glow)
                Spacer(minLength: 12)
                Text("New Chat")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Theme.text)
                if let model {
                    Text("with \(model.name)")
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(1)
                        .padding(.top, 6)
                }
            }
            .padding(34)
            .frame(width: 440, height: 250, alignment: .leading)
        }
        .buttonStyle(.card)
        .accessibilityIdentifier("new-chat")
    }
}

/// A suggested opening message from the server's prompt list.
struct SuggestionCard: View {
    let prompt: SuggestedPrompt
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 0) {
                Image(systemName: "sparkles")
                    .font(.title3)
                    .foregroundStyle(Theme.secondaryText)
                Spacer(minLength: 12)
                Text(prompt.label)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(Theme.text)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(30)
            .frame(width: 400, height: 250, alignment: .leading)
        }
        .buttonStyle(.card)
        .accessibilityIdentifier("suggestion")
    }
}

// MARK: - Chat actions

private struct ChatContextMenu: ViewModifier {
    let chat: ChatSummary
    let library: LibraryModel
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var confirmingDelete = false

    func body(content: Content) -> some View {
        content
            .contextMenu {
                Button {
                    Task { await library.setPinned(!chat.pinned, chatId: chat.id) }
                } label: {
                    Label(chat.pinned ? "Unpin" : "Pin", systemImage: chat.pinned ? "pin.slash" : "pin")
                }
                Button {
                    newTitle = ChatTitle(chat.title).text
                    renaming = true
                } label: {
                    Label("Rename", systemImage: "pencil")
                }
                Button(role: .destructive) {
                    confirmingDelete = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
            .renameChatAlert(isPresented: $renaming, title: $newTitle) {
                Task { await library.rename(chatId: chat.id, to: preservingEmoji(newTitle)) }
            }
            .confirmationDialog("Delete “\(ChatTitle(chat.title).text)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
                Button("Delete Chat", role: .destructive) {
                    Task { await library.delete(chatId: chat.id) }
                }
            } message: {
                Text("The chat is removed from all of your devices.")
            }
    }

    /// Keeps the generated emoji when the words are renamed.
    private func preservingEmoji(_ title: String) -> String {
        guard let emoji = ChatTitle(chat.title).emoji, ChatTitle(title).emoji == nil else { return title }
        return "\(emoji) \(title)"
    }
}

extension View {
    func chatContextMenu(_ chat: ChatSummary, library: LibraryModel) -> some View {
        modifier(ChatContextMenu(chat: chat, library: library))
    }

    func renameChatAlert(isPresented: Binding<Bool>, title: Binding<String>, save: @escaping () -> Void) -> some View {
        alert("Rename Chat", isPresented: isPresented) {
            TextField("Title", text: title)
                .accessibilityIdentifier("rename-field")
            Button("Save", action: save)
            Button("Cancel", role: .cancel) {}
        }
    }
}
