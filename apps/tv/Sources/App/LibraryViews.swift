import SwiftUI

struct ChatActionsView: View {
    @Bindable var store: Store
    @State private var title = ""
    @State private var deleteConfirm = false
    @State private var shareURL: String?
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Panel(title: "Chat") {
            if let chat = store.selected {
                if !chat.temporary {
                    TextField("Title", text: $title).accessibilityIdentifier("chat-title")
                    Button("Rename") { Task { await store.patchChat(["title": .string(title)]); if store.error == nil { dismiss() } } }
                        .disabled(title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.working).accessibilityIdentifier("rename-chat")
                    Button(chat.pinned ? "Unpin" : "Pin") { Task { await store.patchChat(["pinned": .bool(!chat.pinned)]); if store.error == nil { dismiss() } } }.accessibilityIdentifier("pin-chat")
                    ChoiceRow(title: "Folder", selection: Binding(get: { chat.folderID ?? "" }, set: { id in Task { await store.patchChat(["folderId": id.isEmpty ? .null : .string(id)]) } }), choices: [Choice("", "None")] + store.folders.map { Choice($0.id, $0["name"].string) }).accessibilityIdentifier("move-chat")
                    Button("Duplicate") {
                        Task {
                            if let result = await store.mutate("/api/chats/\(API.resource(chat.id))/duplicate", idempotent: true) {
                                let value = result["chat"] == .null ? result : result["chat"]
                                await store.select(Chat(value: value)); dismiss()
                            }
                        }
                    }.accessibilityIdentifier("duplicate-chat")
                    Button("Share") {
                        Task {
                            if let result = await store.mutate("/api/chat-shares", body: ["chatId": .string(chat.id), "expiresAt": nil], idempotent: true),
                               let token = result["token"].optionalString { shareURL = "\(store.server)/share/\(token)" }
                        }
                    }.accessibilityIdentifier("share-chat")
                    if let shareURL { QRView(url: shareURL) }
                } else {
                    Button("Keep chat") { Task { _ = await store.mutate("/api/chats/\(API.resource(chat.id))/persist"); if store.error == nil { store.temporary = false; dismiss() } } }
                }
                Button("Delete chat", role: .destructive) { deleteConfirm = true }.accessibilityIdentifier("delete-chat")
                ErrorBanner(store: store)
            }
        }.onAppear { title = store.selected?.title ?? "" }
        .confirmationDialog("Delete chat?", isPresented: $deleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    if let id = store.selectedID {
                        await store.select(nil)
                        if await store.mutate("/api/chats/\(API.resource(id))", method: "DELETE") != nil { dismiss() }
                    }
                }
            }
        }
    }
}

struct FoldersView: View {
    @Bindable var store: Store
    @State private var name = ""
    @State private var selectedID: String?
    @State private var deleting: JSON?
    var body: some View {
        Panel(title: "Folders") {
            TextField("Folder name", text: $name).accessibilityIdentifier("folder-name")
            HStack(spacing: 30) {
                Button(selectedID == nil ? "Create folder" : "Rename") {
                    Task {
                        let id = selectedID ?? UUID().uuidString.lowercased()
                        let result = await store.mutate(selectedID == nil ? "/api/folders" : "/api/folders/\(API.resource(id))", method: selectedID == nil ? "POST" : "PATCH", body: ["clientId": .string(id), "name": .string(name)])
                        if result != nil { name = ""; selectedID = nil }
                    }
                }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.working).accessibilityIdentifier("folder-save")
                if selectedID != nil { Button("Cancel") { selectedID = nil; name = "" } }
            }
            ForEach(store.folders, id: \.id) { folder in
                HStack(spacing: 25) {
                    Button(folder["name"].string) { selectedID = folder.id; name = folder["name"].string }.frame(maxWidth: .infinity, alignment: .leading)
                    Button { deleting = folder } label: { Image(systemName: "trash") }.accessibilityLabel("Delete \(folder["name"].string)")
                }
            }
            ErrorBanner(store: store)
        }.confirmationDialog("Delete folder? Chats will be kept.", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete folder", role: .destructive) { if let folder = deleting { Task { _ = await store.mutate("/api/folders/\(API.resource(folder.id))", method: "DELETE"); deleting = nil } } }
        }
    }
}

struct TrashView: View {
    @Bindable var store: Store
    @State private var chats: [JSON] = []
    @State private var loading = true
    @State private var deleting: JSON?
    var body: some View {
        Panel(title: "Trash") {
            if loading { ProgressView() }
            if !loading && chats.isEmpty { Text("No deleted chats").foregroundStyle(.secondary) }
            ForEach(chats, id: \.id) { chat in
                HStack(spacing: 30) {
                    Text(chat["title"].string).frame(maxWidth: .infinity, alignment: .leading).lineLimit(2)
                    Button("Restore") { Task { if await store.mutate("/api/chats/\(API.resource(chat.id))/recover") != nil { await refresh() } } }.accessibilityIdentifier("restore-\(chat.id)")
                    Button { deleting = chat } label: { Image(systemName: "trash") }.accessibilityLabel("Delete permanently")
                }
            }
            ErrorBanner(store: store)
        }.task { await refresh() }
        .confirmationDialog("Permanently delete this chat?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete permanently", role: .destructive) { if let chat = deleting { Task { _ = await store.mutate("/api/chats/\(API.resource(chat.id))/permanent", method: "DELETE"); deleting = nil; await refresh() } } }
        }
    }
    private func refresh() async {
        do { chats = try await store.api?.request("/api/chats/deleted")["data"].array ?? [] }
        catch { store.fail(error) }
        loading = false
    }
}
