import PulpoKit
import SwiftUI

struct ConversationView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let model: ConversationModel
    let initialPrompt: String?

    @State private var draft = ""
    /// The viewer stayed on the composer while the current reply streamed.
    @State private var followingReply = false
    @State private var replyStartedAt = ContinuousClock.now
    @State private var sentInitialPrompt = false
    @State private var showingModelPicker = false
    @State private var actionsTurn: TranscriptTurn?
    @State private var userActionsTurn: TranscriptTurn?
    @State private var thinkingTurn: TranscriptTurn?
    @State private var viewingImage: AttachmentReference?
    @State private var editing: TranscriptTurn?
    @State private var editText = ""
    @State private var renaming = false
    @State private var newTitle = ""
    @State private var confirmingDelete = false
    @FocusState private var transcriptFocus: TranscriptFocus?
    @FocusState private var composerFocus: ComposerFocus?

    enum ComposerFocus: Hashable {
        case field, send, stop
    }

    var body: some View {
        VStack(spacing: 0) {
            ConversationHeader(
                model: model,
                showModelPicker: { showingModelPicker = true },
                rename: {
                    newTitle = ChatTitle(model.title).text
                    renaming = true
                },
                delete: { confirmingDelete = true }
            )
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Composer(
                model: model,
                draft: $draft,
                focus: $composerFocus,
                send: send,
                stop: { Task { await model.stop() } }
            )
        }
        .background(Backdrop())
        .task {
            app.activeConversation = model
            await model.load()
            if let initialPrompt, !sentInitialPrompt {
                sentInitialPrompt = true
                await model.send(initialPrompt)
            }
        }
        .onAppear {
            // Replays anything missed while another screen was in front.
            app.activeConversation = model
            model.resubscribe()
        }
        .onDisappear {
            if app.activeConversation === model { app.activeConversation = nil }
            app.readAloud.stop()
        }
        .task {
            // Start on the composer rather than the first control at the top.
            try? await Task.sleep(for: .milliseconds(300))
            if transcriptFocus == nil { composerFocus = model.isGenerating ? .stop : .field }
        }
        .onPlayPauseCommand(perform: playPause)
        .onChange(of: model.isGenerating) { _, generating in
            // Keep the remote on the composer as it swaps between the field
            // and Stop, unless the viewer moved up to read the reply. When
            // Stop disappears tvOS may first move focus into the transcript,
            // so the decision uses whether the viewer was following along.
            if generating {
                replyStartedAt = .now
                guard followingReply || transcriptFocus == nil else { return }
                followingReply = true
                transcriptFocus = nil
                composerFocus = .stop
            } else if followingReply {
                followingReply = false
                transcriptFocus = nil
                composerFocus = .field
            }
        }
        .onChange(of: transcriptFocus) { _, focus in
            // Moving up to read stops following, but not the focus shuffle
            // as a dialog closes or Stop appears.
            if focus != nil, model.isGenerating, ContinuousClock.now - replyStartedAt > .seconds(1) {
                followingReply = false
            }
        }
        .onChange(of: model.failedDraft) { _, failed in
            if let failed, draft.isEmpty { draft = failed }
        }
        .sheet(isPresented: $showingModelPicker) {
            ModelPicker(library: model.library, selectedId: model.model?.id) { id in
                Task { await model.selectModel(id) }
            }
        }
        .sheet(item: $thinkingTurn) { turn in
            ThinkingSheet(turn: model.turns.first { $0.id == turn.id } ?? turn)
        }
        .fullScreenCover(item: $viewingImage) { attachment in
            ImageViewer(attachment: attachment, api: model.library.api)
        }
        .confirmationDialog(
            actionsTurn.map { _ in "Reply" } ?? "",
            isPresented: Binding(get: { actionsTurn != nil }, set: { if !$0 { actionsTurn = nil } }),
            presenting: actionsTurn
        ) { turn in
            replyActions(turn)
        }
        .confirmationDialog(
            "Your Message",
            isPresented: Binding(get: { userActionsTurn != nil }, set: { if !$0 { userActionsTurn = nil } }),
            presenting: userActionsTurn
        ) { turn in
            messageActions(turn)
        }
        .alert("Edit Message", isPresented: Binding(get: { editing != nil }, set: { if !$0 { editing = nil } })) {
            TextField("Message", text: $editText)
            Button("Send") {
                if let turn = editing {
                    let text = editText
                    followNewReply { await model.edit(turn.id, text: text) }
                }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Sends your edited message as a new version and gets a fresh reply.")
        }
        .renameChatAlert(isPresented: $renaming, title: $newTitle) {
            guard let chatId = model.chatId else { return }
            var title = newTitle
            if let emoji = ChatTitle(model.title).emoji, ChatTitle(title).emoji == nil { title = "\(emoji) \(title)" }
            Task { await model.library.rename(chatId: chatId, to: title) }
        }
        .confirmationDialog("Delete “\(ChatTitle(model.title).text)”?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete Chat", role: .destructive) {
                guard let chatId = model.chatId else { return }
                Task {
                    if await model.library.delete(chatId: chatId) { dismiss() }
                }
            }
        } message: {
            Text("The chat is removed from all of your devices.")
        }
    }

    // MARK: Content

    @ViewBuilder private var content: some View {
        switch model.state {
        case .loading where model.isEmpty:
            ProgressView()
        case .failed(let message) where model.isEmpty:
            MessageState(systemImage: "exclamationmark.bubble", title: "Couldn’t open this chat", message: message, actionTitle: "Try Again") {
                Task { await model.load() }
            }
        default:
            if model.isEmpty {
                NewChatPrompt(model: model) { prompt in send(prompt) }
            } else {
                transcript
            }
        }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 48) {
                    ForEach(model.turns) { turn in
                        VStack(alignment: .leading, spacing: 36) {
                            UserMessageView(turn: turn, api: model.library.api) { userActionsTurn = turn }
                                .focused($transcriptFocus, equals: .user(turn.id))
                            AssistantMessageView(
                                turn: turn,
                                model: model.library.model(id: turn.modelId),
                                modelName: model.library.modelName(turn.modelId),
                                api: model.library.api,
                                isSpeaking: app.readAloud.isSpeaking(turn.id),
                                onSelect: { actionsTurn = turn },
                                onShowThinking: { thinkingTurn = turn },
                                onRetry: { Task { await model.regenerate(turn.id) } },
                                onOpenImage: { viewingImage = $0 },
                                focus: $transcriptFocus
                            )
                        }
                        .id(turn.id)
                    }
                    if let error = model.actionError {
                        ErrorBanner(message: error, retryTitle: "Dismiss") { model.actionError = nil }
                            .accessibilityIdentifier("action-error")
                    }
                    Color.clear.frame(height: 1).id(Self.bottom)
                }
                .frame(maxWidth: Theme.transcriptWidth)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 30)
            }
            .mask {
                // Fade text out under the header instead of cutting it off.
                VStack(spacing: 0) {
                    LinearGradient(colors: [.clear, .black], startPoint: .top, endPoint: .bottom).frame(height: 40)
                    Color.black
                }
            }
            .onAppear { proxy.scrollTo(Self.bottom, anchor: .bottom) }
            .onChange(of: model.turns.count) { _, _ in
                withAnimation(.easeOut(duration: 0.3)) { proxy.scrollTo(Self.bottom, anchor: .bottom) }
            }
            .onChange(of: model.turns.last?.content.text.count) { _, _ in
                // Follow a streaming reply unless the viewer has moved up into the transcript.
                guard transcriptFocus == nil else { return }
                proxy.scrollTo(Self.bottom, anchor: .bottom)
            }
        }
    }

    private static let bottom = "transcript-bottom"

    // MARK: Actions

    private func send(_ text: String) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty, !model.isGenerating, model.canSend else { return }
        draft = ""
        model.clearFailedDraft()
        Task { await model.send(message) }
        // If the keyboard is still open (Return on a hardware keyboard), tvOS
        // writes the field's text back as it closes; clear it so the message
        // can't be sent twice. A failed send puts the text back on purpose.
        Task {
            try? await Task.sleep(for: .milliseconds(150))
            if draft == text, model.failedDraft == nil { draft = "" }
        }
    }

    /// Play/Pause reads the focused reply aloud, or the latest one.
    private func playPause() {
        let readAloud = app.readAloud
        if readAloud.speakingId != nil, transcriptFocus == nil || readAloud.isSpeaking(transcriptFocus?.turnId ?? "") {
            readAloud.stop()
            return
        }
        let turn = transcriptFocus.flatMap { focus in model.turns.first { $0.id == focus.turnId } }
            ?? model.turns.last { !$0.content.text.isEmpty }
        guard let turn, !turn.content.text.isEmpty else { return }
        readAloud.toggle(id: turn.id, markdown: turn.content.text)
    }

    /// Moves the remote to Stop and follows the reply an action starts, since
    /// the focused message is replaced by its new version.
    private func followNewReply(_ action: @escaping () async -> Void) {
        followingReply = true
        transcriptFocus = nil
        composerFocus = .stop
        Task {
            await action()
            if !model.isGenerating {
                // The request failed, or the reply already finished.
                followingReply = false
                composerFocus = .field
            }
        }
    }

    private func showVersion(_ responseId: String, focus: TranscriptFocus) {
        Task {
            await model.showVersion(responseId)
            transcriptFocus = focus
        }
    }

    @ViewBuilder private func replyActions(_ turn: TranscriptTurn) -> some View {
        if !turn.content.text.isEmpty {
            Button(app.readAloud.isSpeaking(turn.id) ? "Stop Reading" : "Read Aloud") {
                app.readAloud.toggle(id: turn.id, markdown: turn.content.text)
            }
        }
        if turn.content.reasoning != nil || !turn.content.activities.isEmpty {
            Button("Show Thinking") { thinkingTurn = turn }
        }
        if !model.isGenerating {
            Button("Regenerate") { followNewReply { await model.regenerate(turn.id) } }
        }
        if let branch = turn.assistantBranch, !model.isGenerating {
            if let previous = branch.previous {
                Button("Previous Version (\(branch.index) of \(branch.count))") { showVersion(previous, focus: .segment(previous, 0)) }
            }
            if let next = branch.next {
                Button("Next Version (\(branch.index + 2) of \(branch.count))") { showVersion(next, focus: .segment(next, 0)) }
            }
        }
        Button("Cancel", role: .cancel) {}
    }

    @ViewBuilder private func messageActions(_ turn: TranscriptTurn) -> some View {
        if !model.isGenerating, !turn.userText.isEmpty {
            Button("Edit Message") {
                editText = turn.userText
                editing = turn
            }
        }
        Button("Read Aloud") {
            app.readAloud.toggle(id: "\(turn.id):input", markdown: turn.userText)
        }
        if let branch = turn.userBranch, !model.isGenerating {
            if let previous = branch.previous {
                Button("Previous Edit (\(branch.index) of \(branch.count))") { showVersion(previous, focus: .user(previous)) }
            }
            if let next = branch.next {
                Button("Next Edit (\(branch.index + 2) of \(branch.count))") { showVersion(next, focus: .user(next)) }
            }
        }
        Button("Cancel", role: .cancel) {}
    }
}

// MARK: - Header

private struct ConversationHeader: View {
    @Environment(AppModel.self) private var app
    let model: ConversationModel
    let showModelPicker: () -> Void
    let rename: () -> Void
    let delete: () -> Void

    var body: some View {
        let title = ChatTitle(model.title)
        let readAloud = app.readAloud
        HStack(spacing: 28) {
            if let emoji = title.emoji {
                Text(emoji).font(.system(size: 56))
            }
            Text(title.text)
                .font(.title3.weight(.bold))
                .foregroundStyle(Theme.text)
                .lineLimit(1)
                .contentTransition(.opacity)
                .animation(.easeInOut, value: model.title)
                .accessibilityIdentifier("conversation-title")
            Spacer(minLength: 40)
            ReadingPill(readAloud: readAloud)
            Button(action: showModelPicker) {
                HStack(spacing: 16) {
                    ModelIcon(model: model.model, size: 44)
                    Text(model.model?.name ?? "Choose a Model")
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.caption.weight(.semibold))
                }
                .font(.callout.weight(.medium))
            }
            .buttonStyle(.bordered)
            .disabled(model.isGenerating)
            .accessibilityIdentifier("model-picker")
            if model.chatId != nil {
                Menu {
                    Button {
                        guard let chatId = model.chatId else { return }
                        Task { await model.library.setPinned(!model.isPinned, chatId: chatId) }
                    } label: {
                        Label(model.isPinned ? "Unpin" : "Pin", systemImage: model.isPinned ? "pin.slash" : "pin")
                    }
                    Button(action: rename) { Label("Rename", systemImage: "pencil") }
                    Button(role: .destructive, action: delete) { Label("Delete", systemImage: "trash") }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.callout.weight(.bold))
                        .frame(height: 44)
                }
                .buttonStyle(.bordered)
                .accessibilityIdentifier("chat-menu")
                .accessibilityLabel("Chat options")
            }
        }
        .padding(.horizontal, Theme.screenPadding)
        .padding(.top, 20)
        .padding(.bottom, 10)
        .animation(.easeInOut(duration: 0.25), value: readAloud.speakingId)
        .focusSection()
    }
}

// MARK: - New chat

/// The empty state of a new chat: the selected model and some starters.
private struct NewChatPrompt: View {
    let model: ConversationModel
    let send: (String) -> Void

    var body: some View {
        VStack(spacing: 34) {
            Spacer(minLength: 0)
            ModelIcon(model: model.model, size: 130)
                .shadow(color: .black.opacity(0.25), radius: 30, y: 14)
            VStack(spacing: 10) {
                Text(model.model?.name ?? "Pulpo")
                    .font(.title2.weight(.bold))
                if let subtitle = model.model?.subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.callout)
                        .foregroundStyle(Theme.secondaryText)
                }
            }
            if let error = model.actionError {
                // A first message that failed leaves the chat empty.
                ErrorBanner(message: error, retryTitle: "Dismiss") { model.actionError = nil }
                    .frame(maxWidth: Theme.transcriptWidth)
                    .focusSection()
                    .accessibilityIdentifier("action-error")
            }
            if model.library.settings?.showPromptSuggestions != false, !model.library.suggestions.isEmpty {
                HStack(spacing: 36) {
                    ForEach(model.library.suggestions.prefix(4)) { prompt in
                        SuggestionCard(prompt: prompt) { send(prompt.message) }
                    }
                }
                .padding(.top, model.actionError == nil ? 30 : 0)
                .focusSection()
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.screenPadding)
    }
}

// MARK: - Read aloud

/// Shows which reply is being read, with the remote shortcut to stop.
private struct ReadingPill: View {
    let readAloud: ReadAloud

    var body: some View {
        if readAloud.speakingId != nil {
            HStack(spacing: 16) {
                Image(systemName: "speaker.wave.2.fill")
                    .symbolEffect(.variableColor.iterative, options: .repeating)
                    .foregroundStyle(Theme.glow)
                Text("Reading aloud")
                Text("⏯ to stop")
                    .foregroundStyle(Theme.secondaryText)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 26)
            .padding(.vertical, 14)
            .glassEffect(.regular, in: Capsule())
            .transition(.scale(scale: 0.9).combined(with: .opacity))
            .accessibilityIdentifier("reading-pill")
        }
    }
}
