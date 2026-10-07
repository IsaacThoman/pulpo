import PulpoKit
import SwiftUI

/// The message field. Selecting it opens the tvOS keyboard, which also
/// offers dictation and typing from a nearby iPhone; finishing sends.
struct Composer: View {
    let model: ConversationModel
    @Binding var draft: String
    var focus: FocusState<ConversationView.ComposerFocus?>.Binding
    let send: (String) -> Void
    let stop: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 24) {
                if model.isGenerating {
                    Button(action: stop) {
                        Label("Stop Responding", systemImage: "stop.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .focused(focus, equals: .stop)
                    .accessibilityIdentifier("stop")
                } else {
                    TextField(placeholder, text: $draft)
                        .submitLabel(.send)
                        .onSubmit { send(draft) }
                        .focused(focus, equals: .field)
                        .fieldBackground()
                        .accessibilityIdentifier("composer")
                    Button {
                        send(draft)
                    } label: {
                        Image(systemName: "arrow.up")
                            .font(.title3.weight(.bold))
                            .frame(width: 44, height: 44)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!model.canSend || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .focused(focus, equals: .send)
                    .accessibilityIdentifier("send")
                    .accessibilityLabel("Send")
                }
            }
            .animation(.easeInOut(duration: 0.2), value: model.isGenerating)
            Text(hint)
                .font(.caption2)
                .foregroundStyle(Theme.tertiaryText)
                .lineLimit(1)
        }
        .frame(maxWidth: Theme.transcriptWidth)
        .frame(maxWidth: .infinity)
        .padding(.horizontal, Theme.screenPadding)
        .padding(.top, 18)
        .padding(.bottom, 36)
        .background(alignment: .top) {
            LinearGradient(colors: [Theme.background.opacity(0), Theme.background.opacity(0.85)], startPoint: .top, endPoint: .bottom)
                .padding(.top, -40)
                .allowsHitTesting(false)
        }
        .focusSection()
    }

    private var placeholder: String {
        model.isEmpty ? "Ask \(model.model?.name ?? "Pulpo") anything" : "Message \(model.model?.name ?? "Pulpo")"
    }

    private var hint: String {
        if model.isGenerating { return "Swipe up to read along as the reply arrives." }
        if model.isEmpty { return "Select the field to type, dictate with the remote’s microphone, or type on your iPhone." }
        return "Select a reply for more options  ·  ⏯ reads the latest reply aloud"
    }
}

/// Lists the account's models, favorites first.
struct ModelPicker: View {
    let library: LibraryModel
    let selectedId: String?
    let select: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                if !favorites.isEmpty {
                    Section("Favorites") { rows(favorites) }
                }
                Section(favorites.isEmpty ? "Models" : "All Models") { rows(others) }
            }
            .navigationTitle("Choose a Model")
            .overlay {
                if library.models.isEmpty {
                    MessageState(systemImage: "cpu", title: "No models available", message: "An administrator needs to enable a model on this server.")
                }
            }
        }
    }

    private var favorites: [AIModel] {
        let ids = library.settings?.favoriteModelIds ?? []
        return ids.compactMap { id in library.models.first { $0.id == id } }
    }

    private var others: [AIModel] {
        let favoriteIds = Set(favorites.map(\.id))
        return library.models.filter { !favoriteIds.contains($0.id) }
    }

    private func rows(_ models: [AIModel]) -> some View {
        ForEach(models) { model in
            Button {
                select(model.id)
                dismiss()
            } label: {
                HStack(spacing: 30) {
                    ModelIcon(model: model, size: 64)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 14) {
                            Text(model.name).font(.headline)
                            if library.settings?.defaultModelId == model.id {
                                Text("Default")
                                    .font(.caption2.weight(.semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 4)
                                    .background(Capsule().fill(Theme.fillStrong))
                            }
                        }
                        Text(details(model))
                            .font(.caption)
                            .foregroundStyle(Theme.secondaryText)
                            .lineLimit(2)
                    }
                    Spacer(minLength: 20)
                    if model.id == selectedId {
                        Image(systemName: "checkmark")
                            .font(.headline)
                            .accessibilityLabel("Selected")
                    }
                }
                .padding(.vertical, 8)
            }
            .contextMenu {
                if library.settings?.defaultModelId != model.id {
                    Button("Use for New Chats") { Task { await library.setDefaultModel(model.id) } }
                }
            }
            .accessibilityIdentifier("model-row")
        }
    }

    private func details(_ model: AIModel) -> String {
        let description = model.description?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let parts = [model.subtitle, model.tags.joined(separator: ", ")].filter { !$0.isEmpty }
        return description.isEmpty ? parts.joined(separator: " · ") : description
    }
}
