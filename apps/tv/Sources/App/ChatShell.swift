import SwiftUI

enum Sheet: String, Identifiable {
    case search, models, settings, folders, trash, chatActions, options
    var id: String { rawValue }
}

struct ChatShell: View {
    @Bindable var store: Store
    @State private var sheet: Sheet?
    @State private var expandedFolders: Set<String> = []
    @FocusState private var sidebarFocused: Bool
    var body: some View {
        HStack(spacing: 0) {
            sidebar.frame(width: 330)
            Rectangle().fill(Palette.separator).frame(width: 1)
            VStack(spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(store.selected?.title ?? (store.temporary ? "Temporary chat" : "New chat"))
                            .font(.system(size: 27, weight: .semibold)).lineLimit(1)
                        if store.offline { Text("Offline").font(.system(size: 20)).foregroundStyle(.secondary) }
                    }
                    Spacer()
                    Button { sheet = .models } label: { Label(store.currentModel["name"].optionalString ?? "Models", systemImage: "chevron.down") }
                        .font(.system(size: 24)).accessibilityIdentifier("model-picker")
                    Button { sheet = store.selected == nil ? .options : .chatActions } label: { Image(systemName: "ellipsis") }
                        .accessibilityLabel("Chat options").accessibilityIdentifier("chat-options")
                }.padding(.horizontal, 14).padding(.top, 8)
                ErrorBanner(store: store)
                if store.chatLoading { Spacer(); ProgressView().accessibilityLabel("Loading chat"); Spacer() }
                else if let chat = store.selected { TranscriptView(store: store, chat: chat).id(chat.id) }
                else {
                    Spacer()
                    VStack(spacing: 25) {
                        Image("PulpoMark").resizable().scaledToFit().frame(width: 95, height: 95)
                        Text(store.temporary ? "Temporary chat" : "New chat").font(.system(size: 38, weight: .medium))
                        if store.models.isEmpty { Text("No models available").foregroundStyle(.secondary) }
                    }.accessibilityIdentifier("empty-chat")
                    Spacer()
                }
                composer
            }.padding(.leading, 38).padding(.vertical, 8)
                .frame(maxWidth: .infinity).focusSection()
        }
        .padding(.horizontal, 64).padding(.vertical, 48)
        .background(Palette.background)
        .sheet(item: $sheet) { value in
            switch value {
            case .search: SearchView(store: store)
            case .models: ModelPicker(store: store)
            case .settings: SettingsView(store: store)
            case .folders: FoldersView(store: store)
            case .trash: TrashView(store: store)
            case .chatActions: ChatActionsView(store: store)
            case .options: GenerationOptions(store: store)
            }
        }
        .onExitCommand(perform: sidebarFocused ? nil : { sidebarFocused = true })
    }
    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 14) {
                Image("PulpoMark").resizable().scaledToFit().frame(width: 40, height: 40)
                Text("Pulpo").font(.system(size: 32, weight: .semibold))
            }.padding(.horizontal, 20).padding(.bottom, 16)
            Button { Task { await store.select(nil) } } label: { row("New chat", icon: "square.and.pencil") }
                .focused($sidebarFocused).buttonStyle(TVButtonStyle(selected: store.selectedID == nil))
                .accessibilityIdentifier("new-chat")
            Button { sheet = .search } label: { row("Search", icon: "magnifyingglass") }
                .buttonStyle(TVButtonStyle()).accessibilityIdentifier("search")
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    ForEach(store.chats.filter(\.pinned)) { chat in chatButton(chat) }
                    ForEach(store.folders, id: \.id) { folder in
                        Button {
                            if !expandedFolders.insert(folder.id).inserted { expandedFolders.remove(folder.id) }
                        } label: {
                            HStack { Image(systemName: expandedFolders.contains(folder.id) ? "folder.fill" : "folder"); Text(folder["name"].string).lineLimit(1); Spacer(); Image(systemName: expandedFolders.contains(folder.id) ? "chevron.down" : "chevron.right").font(.system(size: 16)) }
                        }.buttonStyle(TVButtonStyle()).accessibilityIdentifier("folder-\(folder.id)")
                        if expandedFolders.contains(folder.id) {
                            ForEach(store.chats.filter { $0.folderID == folder.id && !$0.pinned }) { chat in chatButton(chat).padding(.leading, 16) }
                        }
                    }
                    ForEach(store.chats.filter { !$0.pinned && $0.folderID == nil }) { chat in chatButton(chat) }
                    if store.chats.isEmpty { Text("No chats").foregroundStyle(.secondary).padding(20) }
                }.padding(.vertical, 10)
            }.scrollClipDisabled().frame(maxHeight: .infinity)
            HStack(spacing: 0) {
                Button { sheet = .folders } label: { Image(systemName: "folder.badge.plus") }.accessibilityLabel("Folders").accessibilityIdentifier("folders")
                Button { sheet = .trash } label: { Image(systemName: "trash") }.accessibilityLabel("Trash").accessibilityIdentifier("trash")
                Button { sheet = .settings } label: { Image(systemName: "gearshape") }.accessibilityLabel("Settings").accessibilityIdentifier("settings")
            }.buttonStyle(TVButtonStyle()).padding(.top, 8)
        }.font(.system(size: 24)).padding(.trailing, 24).focusSection()
    }
    private func row(_ title: String, icon: String) -> some View {
        HStack(spacing: 16) { Image(systemName: icon).frame(width: 24); Text(title); Spacer() }
    }
    private func chatButton(_ chat: Chat) -> some View {
        Button { Task { await store.select(chat) } } label: {
            HStack(spacing: 12) { if chat.pinned { Image(systemName: "pin.fill").font(.system(size: 17)) }; Text(chat.title).lineLimit(2).multilineTextAlignment(.leading); Spacer(minLength: 0) }
        }.buttonStyle(TVButtonStyle(selected: store.selectedID == chat.id)).accessibilityIdentifier("chat-\(chat.id)")
    }
    private var composer: some View {
        VStack(spacing: 14) {
            if store.pending != nil {
                HStack(spacing: 28) {
                    Text(store.working ? "Sending…" : "Message not confirmed").font(.system(size: 21)).foregroundStyle(.secondary)
                    Spacer()
                    if !store.working { Button("Retry") { Task { await store.retrySend() } }.accessibilityIdentifier("send-retry") }
                }
            }
            HStack(spacing: 26) {
                TextField("Message", text: Binding(get: { store.draft }, set: { store.updateDraft($0) }))
                    .accessibilityIdentifier("composer").disabled(store.pending != nil || store.chatLoading)
                    .submitLabel(.done)
                Button { sheet = .options } label: { Image(systemName: "slider.horizontal.3") }
                    .accessibilityLabel("Generation options").accessibilityIdentifier("generation-options")
                if store.selected?.turns.contains(where: \.busy) == true {
                    Button { Task { await store.stop() } } label: { Image(systemName: "stop.fill") }
                        .disabled(store.working).accessibilityLabel("Stop response").accessibilityIdentifier("stop")
                }
                Button { Task { await store.send() } } label: { Image(systemName: store.selected?.busy == true ? "text.badge.plus" : "arrow.up") }
                    .disabled(!store.canSend).accessibilityLabel(store.selected?.busy == true ? "Queue message" : "Send")
                    .accessibilityIdentifier("send")
            }
        }.padding(18).background(Palette.panel, in: RoundedRectangle(cornerRadius: 22))
    }
}

struct SearchView: View {
    @Bindable var store: Store
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Panel(title: "Search") {
            TextField("Search chats", text: $store.search).accessibilityIdentifier("search-field").onSubmit { Task { await store.runSearch() } }
            Button("Search") { Task { await store.runSearch() } }.accessibilityIdentifier("search-submit")
            if store.searching { ProgressView() }
            ForEach(store.searchResults) { chat in
                Button(chat.title) { Task { await store.select(chat); dismiss() } }.accessibilityIdentifier("search-result-\(chat.id)")
            }
            if !store.search.isEmpty && !store.searching && store.searchResults.isEmpty { Text("No results").foregroundStyle(.secondary) }
            ErrorBanner(store: store)
        }
    }
}

struct ModelPicker: View {
    @Bindable var store: Store
    @State private var query = ""
    @Environment(\.dismiss) private var dismiss
    var models: [JSON] { store.models.filter { query.isEmpty || $0["name"].string.localizedCaseInsensitiveContains(query) || $0["provider"]["name"].string.localizedCaseInsensitiveContains(query) } }
    var body: some View {
        Panel(title: "Models") {
            TextField("Search models", text: $query).accessibilityIdentifier("model-search")
            ForEach(models, id: \.id) { model in
                Button {
                    store.chooseModel(model.id)
                    Task { if store.selected != nil && !store.temporary { await store.patchChat(["modelId": .string(model.id)]) } }
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 7) { Text(model["name"].string); Text(model["lab"]["name"].optionalString ?? model["provider"]["name"].string).font(.system(size: 21)).foregroundStyle(.secondary) }
                        Spacer()
                        if store.modelID == model.id { Image(systemName: "checkmark") }
                    }
                }.buttonStyle(TVButtonStyle(selected: store.modelID == model.id)).accessibilityIdentifier("model-\(model.id)")
            }
            if models.isEmpty { Text("No models").foregroundStyle(.secondary) }
        }
    }
}

struct GenerationOptions: View {
    @Bindable var store: Store
    var body: some View {
        Panel(title: "Options") {
            if store.selectedID == nil {
                Toggle("Temporary chat", isOn: Binding(get: { store.temporary }, set: { store.setTemporary($0) })).disabled(store.pending != nil).accessibilityIdentifier("temporary-toggle")
            }
            if store.agentAvailable && store.currentModel["agentEnabled"].bool { Toggle("Agent mode", isOn: $store.agent).accessibilityIdentifier("agent-toggle") }
            ForEach(store.currentModel["presets"].array, id: \.id) { preset in
                ChoiceRow(title: preset["name"].string, selection: Binding(get: { store.presets[preset.id].optionalString ?? preset["defaultChoiceId"].string }, set: { store.presets[preset.id] = .string($0) }), choices: preset["choices"].array.map { Choice($0.id, $0["displayName"].string) })
            }
            if !store.agentAvailable && store.currentModel["presets"].array.isEmpty && store.selectedID != nil { Text("No additional options").foregroundStyle(.secondary) }
        }
    }
}
