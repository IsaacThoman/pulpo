import SwiftUI
import CoreImage.CIFilterBuiltins

struct TranscriptView: View {
    @Bindable var store: Store
    let chat: Chat
    @State private var detail: Turn?
    @State private var file: JSON?
    @AppStorage("tv-large-text") private var largeText = false
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 30) {
                    ForEach(chat.turns) { turn in
                        VStack(alignment: .leading, spacing: 20) {
                            Button { detail = turn } label: {
                                Text(turn.prompt).font(.system(size: largeText ? 31 : 27)).multilineTextAlignment(.leading)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }.buttonStyle(TVButtonStyle()).background(Palette.panel, in: RoundedRectangle(cornerRadius: 16))
                                .accessibilityIdentifier("prompt-\(turn.id)")
                            HStack {
                                Text(store.models.first { $0.id == turn.modelID }?["name"].optionalString ?? turn.modelID)
                                    .font(.system(size: 22, weight: .semibold)).foregroundStyle(.secondary)
                                Spacer()
                                Button { detail = turn } label: { Image(systemName: "ellipsis") }.accessibilityLabel("Message actions").accessibilityIdentifier("message-actions-\(turn.id)")
                            }.padding(.horizontal, 15)
                            ForEach(Array(MarkdownBlock.parse(turn.text).enumerated()), id: \.offset) { index, block in
                                Button { detail = turn } label: {
                                    MarkdownText(block: block, size: largeText ? 31 : 27).frame(maxWidth: .infinity, alignment: .leading)
                                }.buttonStyle(TVButtonStyle()).accessibilityIdentifier("reply-\(turn.id)-\(index)")
                            }
                            if store.settings["showReasoning"] != .bool(false), !turn.reasoning.isEmpty {
                                Button("Reasoning") { detail = turn }.font(.system(size: 22))
                            }
                            if !turn.activities.isEmpty { Button("Activity (\(turn.activities.count))") { detail = turn }.font(.system(size: 22)) }
                            ForEach(chat.attachments.filter { turn.inputFileIDs.contains($0.id) } + turn.generatedFiles, id: \.id) { attachment in
                                Button { file = attachment } label: { Label(attachment["originalName"].optionalString ?? "File", systemImage: attachment["mimeType"].string.hasPrefix("image/") ? "photo" : "doc") }
                            }
                            if turn.busy { HStack(spacing: 15) { ProgressView(); Text(turn.status == "queued" ? "Queued" : "Responding…").foregroundStyle(.secondary) }.padding(15) }
                            if let failure = turn.failure { Text(failure).foregroundStyle(.red).padding(15) }
                            if ["cancelled", "incomplete", "failed"].contains(turn.status) { Text(turn.status.capitalized).font(.system(size: 21)).foregroundStyle(.secondary).padding(.horizontal, 15) }
                        }
                    }
                    ForEach(chat.queue, id: \.id) { queued in
                        HStack {
                            VStack(alignment: .leading, spacing: 8) { Text("Queued").font(.system(size: 21)).foregroundStyle(.secondary); Text(queued["content"].string).lineLimit(3) }
                            Spacer()
                            Button { Task { _ = await store.mutate("/api/chats/\(API.resource(chat.id))/queued-messages/\(API.resource(queued.id))", method: "DELETE") } } label: { Image(systemName: "xmark") }
                                .disabled(queued["status"].string == "dispatching").accessibilityLabel("Remove queued message")
                        }.padding(24).background(Palette.panel, in: RoundedRectangle(cornerRadius: 16))
                    }
                    Color.clear.frame(height: 8).id("end")
                }.padding(20)
            }.scrollClipDisabled().defaultScrollAnchor(.bottom)
                .onChange(of: chat.turns.count) { _, _ in proxy.scrollTo("end", anchor: .bottom) }
        }
        .sheet(item: $detail) { turn in MessageDetail(store: store, turn: turn) }
        .sheet(isPresented: Binding(get: { file != nil }, set: { if !$0 { file = nil } })) { if let file { FilePreview(store: store, file: file) } }
    }
}

struct MarkdownBlock: Equatable {
    let text: String
    let code: Bool
    static func parse(_ value: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = [], lines: [String] = [], code = false
        func flush() {
            let text = lines.joined(separator: "\n")
            if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                // Each focus target fits on a television; long answers scroll with the remote.
                var remaining = text[...]
                while !remaining.isEmpty {
                    let end = remaining.index(remaining.startIndex, offsetBy: min(600, remaining.count))
                    blocks.append(MarkdownBlock(text: String(remaining[..<end]), code: code))
                    remaining = remaining[end...]
                }
            }
            lines = []
        }
        for line in value.components(separatedBy: "\n") {
            if line.hasPrefix("```") { flush(); code.toggle() }
            else if line.isEmpty && !code { flush() }
            else { lines.append(line) }
        }
        flush(); return blocks
    }
}
struct MarkdownText: View {
    let block: MarkdownBlock
    var size: CGFloat = 27
    var body: some View {
        Group {
            if block.code { Text(block.text).font(.system(size: size - 3, design: .monospaced)) }
            else {
                Text((try? AttributedString(markdown: block.text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(block.text))
                    .font(.system(size: size))
            }
        }.lineSpacing(9).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
    }
}

struct MessageDetail: View {
    @Bindable var store: Store
    let turn: Turn
    @State private var editing = false
    @State private var text = ""
    @State private var deleteConfirm = false
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Panel(title: "Message") {
            HStack(spacing: 35) {
                Button("Regenerate") { Task { await store.regenerate(turn); if store.error == nil { dismiss() } } }.disabled(store.working || store.selected?.busy == true).accessibilityIdentifier("regenerate")
                if !turn.id.isEmpty {
                    Button("Edit message") { text = turn.prompt; editing = true }.disabled(store.selected?.busy == true).accessibilityIdentifier("edit-message")
                }
                Button("Delete", role: .destructive) { deleteConfirm = true }.disabled(store.working).accessibilityIdentifier("delete-message")
            }
            if turn.value["branches"]["user"]["ids"].array.count > 1 {
                ChoiceRow(title: "Prompt version", selection: Binding(get: { turn.id }, set: { id in
                    Task { _ = await store.mutate("/api/messages/\(API.resource(id))/activate"); if store.error == nil { dismiss() } }
                }), choices: turn.value["branches"]["user"]["ids"].array.enumerated().map { Choice($0.element.string, "\($0.offset + 1)") })
            }
            if turn.branches.count > 1 {
                HStack(spacing: 30) {
                    Text("Version \(turn.branchIndex + 1) of \(turn.branches.count)")
                    ForEach(Array(turn.branches.enumerated()), id: \.element) { index, id in
                        Button("\(index + 1)") { Task { _ = await store.mutate("/api/messages/\(API.resource(id))/activate"); if store.error == nil { dismiss() } } }.disabled(index == turn.branchIndex)
                    }
                }
            }
            if editing {
                TextField("Message", text: $text).accessibilityIdentifier("edit-message-field")
                Button("Send") {
                    Task {
                        _ = await store.mutate("/api/messages/\(API.resource(turn.id + ":input"))", method: "PATCH", body: ["clientId": .string(UUID().uuidString.lowercased()), "content": .string(text), "modelId": .string(store.modelID), "presetSelections": store.presets, "agentMode": .bool(store.agent), "timeZone": .string(TimeZone.current.identifier)])
                        if store.error == nil { dismiss() }
                    }
                }.disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.working).accessibilityIdentifier("edit-message-submit")
            }
            if !turn.reasoning.isEmpty {
                Text("Reasoning").font(.headline)
                ReadableText(text: turn.reasoning)
            }
            ForEach(Array(turn.activities.enumerated()), id: \.offset) { _, activity in
                Text(activity["tool"].optionalString ?? activity["type"].string.replacingOccurrences(of: "pulpo_", with: "").capitalized).font(.headline)
                ReadableText(text: activity["output"].optionalString ?? activity["summary"].optionalString ?? activity.pretty)
            }
            ReadableText(text: turn.text)
            ErrorBanner(store: store)
        }
        .confirmationDialog("Delete this message and its replies?", isPresented: $deleteConfirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { _ = await store.mutate("/api/messages/\(API.resource(turn.id + ":input"))", method: "DELETE"); if store.error == nil { dismiss() } } }
        }
    }
}
struct ReadableText: View {
    let text: String
    var body: some View {
        ForEach(Array(MarkdownBlock.parse(text).enumerated()), id: \.offset) { _, block in
            MarkdownText(block: block).frame(maxWidth: .infinity, alignment: .leading).padding(18).focusable()
        }
    }
}

struct FilePreview: View {
    @Bindable var store: Store
    let file: JSON
    @State private var image: UIImage?
    @State private var text: String?
    @State private var error: String?
    @State private var loading = true
    var body: some View {
        Panel(title: file["originalName"].optionalString ?? "File") {
            if loading { ProgressView() }
            if let image { Image(uiImage: image).resizable().scaledToFit().frame(maxHeight: 650).focusable().accessibilityIdentifier("attachment-image") }
            if let text { ReadableText(text: text) }
            if let error { Text(error).foregroundStyle(.secondary) }
        }.task {
            defer { loading = false }
            do {
                guard let api = store.api else { return }
                let mime = file["mimeType"].string
                guard mime.hasPrefix("image/") || mime.hasPrefix("text/") || mime == "application/json" else {
                    error = "Open this file in Pulpo on your phone or computer."; return
                }
                if file["sizeBytes"].int > 20_000_000 { error = "This file is too large to preview."; return }
                let result = try await api.request("/api/attachments/\(API.resource(file.id))/download")
                guard let url = URL(string: result["url"].string, relativeTo: api.origin)?.absoluteURL else { throw URLError(.badURL) }
                let data: Data
                if url.host == api.origin.host && url.scheme == api.origin.scheme && url.port == api.origin.port {
                    data = try await api.data(url.absoluteString).0
                } else {
                    guard url.scheme == "https", url.user == nil, url.password == nil else { throw URLError(.badURL) }
                    // Presigned object-store URLs never receive the Pulpo bearer token.
                    let session = URLSession(configuration: .ephemeral)
                    defer { session.invalidateAndCancel() }
                    let (bytes, response) = try await session.data(from: url)
                    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
                    data = bytes
                }
                guard data.count <= 20_000_000 else { error = "This file is too large to preview."; return }
                if mime.hasPrefix("image/") { image = UIImage(data: data); if image == nil { error = "Image preview unavailable." } }
                else { text = String(data: data.prefix(200_000), encoding: .utf8) ?? "Preview unavailable." }
            } catch { self.error = error.localizedDescription }
        }
    }
}

struct QRView: View {
    let url: String
    private var image: UIImage? {
        let filter = CIFilter.qrCodeGenerator(); filter.message = Data(url.utf8)
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 12, y: 12)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
    var body: some View {
        VStack(spacing: 30) {
            if let image { Image(uiImage: image).interpolation(.none).resizable().scaledToFit().frame(width: 330, height: 330).padding(24).background(.white) }
            Text(url).font(.system(size: 22))
        }.frame(maxWidth: .infinity)
    }
}
