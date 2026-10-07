import PulpoKit
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    let library: LibraryModel
    @State private var confirmingSignOut = false
    @State private var choosingModel = false
    @State private var speechRate = Preferences.speechRate
    @State private var serverVersion: String?

    var body: some View {
        HStack(alignment: .top, spacing: 80) {
            ProfileCard(user: library.user, server: app.session?.server)
                .frame(width: 560)
            List {
                Section("Chats") {
                    Button {
                        choosingModel = true
                    } label: {
                        LabeledContent("Default Model") {
                            Text(library.defaultModel?.name ?? "None")
                        }
                    }
                    .accessibilityIdentifier("default-model")
                }
                Section {
                    Picker("Speaking Rate", selection: $speechRate) {
                        Text("Relaxed").tag(0.85)
                        Text("Normal").tag(1.0)
                        Text("Brisk").tag(1.15)
                        Text("Fast").tag(1.3)
                    }
                    .onChange(of: speechRate) { _, rate in Preferences.speechRate = rate }
                } header: {
                    Text("Read Aloud")
                } footer: {
                    Text("Press ⏯ on the remote in a chat to hear the latest reply, using this Apple TV’s voice.")
                        .font(.caption)
                        .foregroundStyle(Theme.secondaryText)
                }
                Section("About") {
                    LabeledContent("Server", value: app.session?.server.displayName ?? "—")
                    if let serverVersion {
                        LabeledContent("Server Version", value: serverVersion)
                    }
                    LabeledContent("App Version", value: Self.appVersion)
                    LabeledContent("Live Updates", value: app.isRealtimeConnected ? "Connected" : "Connecting…")
                }
                Section {
                    Button {
                        confirmingSignOut = true
                    } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .accessibilityIdentifier("sign-out")
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(.horizontal, Theme.screenPadding)
        .padding(.top, 60)
        .sheet(isPresented: $choosingModel) {
            ModelPicker(library: library, selectedId: library.defaultModel?.id) { id in
                Task { await library.setDefaultModel(id) }
            }
        }
        .confirmationDialog("Sign out of Pulpo?", isPresented: $confirmingSignOut, titleVisibility: .visible) {
            Button("Sign Out", role: .destructive) { Task { await app.signOut() } }
        } message: {
            Text("Your chats stay on \(app.session?.server.displayName ?? "the server") and on your other devices.")
        }
        .task {
            serverVersion = try? await library.api.instanceConfig().instance.version
        }
    }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }
}

private struct ProfileCard: View {
    let user: User
    let server: ServerAddress?

    var body: some View {
        VStack(spacing: 28) {
            Avatar(user: user, size: 200)
                .shadow(color: .black.opacity(0.3), radius: 30, y: 14)
            VStack(spacing: 10) {
                Text(user.name)
                    .font(.title2.weight(.bold))
                    .multilineTextAlignment(.center)
                Text(user.email)
                    .font(.callout)
                    .foregroundStyle(Theme.secondaryText)
                if let server {
                    Label(server.displayName, systemImage: "server.rack")
                        .font(.caption)
                        .foregroundStyle(Theme.tertiaryText)
                        .padding(.top, 6)
                }
                if user.role == .admin {
                    Text("Administrator")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 16)
                        .padding(.vertical, 6)
                        .background(Capsule().fill(Theme.fillStrong))
                        .padding(.top, 6)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
        .background(RoundedRectangle(cornerRadius: 40, style: .continuous).fill(.regularMaterial))
        .accessibilityElement(children: .combine)
    }
}
