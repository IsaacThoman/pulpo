import SwiftUI

struct SettingsView: View {
    @Bindable var store: Store
    @AppStorage("tv-large-text") private var largeText = false
    @State private var signOutConfirm = false
    @State private var devices = false
    @State private var security: SecurityPanel?
    @State private var profileName = ""
    var body: some View {
        Panel(title: "Settings") {
            Text("Appearance").font(.headline)
            ChoiceRow(title: "Theme", selection: preference("theme", fallback: "system"), choices: [Choice("system", "System"), Choice("light", "Light"), Choice("dark", "Dark")]).accessibilityIdentifier("theme-picker")
            Toggle("Larger text", isOn: $largeText).accessibilityIdentifier("larger-text")
            Toggle("Show reasoning", isOn: boolPreference("showReasoning", fallback: true))
            Text("Chats").font(.headline)
            ChoiceRow(title: "Default model", selection: preference("defaultModelId", fallback: ""), choices: [Choice("", "None")] + store.models.map { Choice($0.id, $0["name"].string) })
            Toggle("Memory", isOn: boolPreference("memoryEnabled"))
            ChoiceRow(title: "Trash retention", selection: preference("trashRetention", fallback: "30d"), choices: [Choice("24h", "24 hours"), Choice("7d", "7 days"), Choice("30d", "30 days"), Choice("90d", "90 days"), Choice("indefinite", "Keep until deleted")])
            Text("Account").font(.headline)
            Text(store.user["email"].string).foregroundStyle(.secondary)
            TextField("Name", text: $profileName).accessibilityIdentifier("profile-name")
            Button("Save name") { Task { if let result = await store.mutate("/api/me", method: "PATCH", body: ["name": .string(profileName)]) { store.user = result["user"] } } }.disabled(profileName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.working)
            Button("Devices") { devices = true }.accessibilityIdentifier("devices")
            Button("Change password") { security = .password }.accessibilityIdentifier("change-password")
            Button("Delete account", role: .destructive) { security = .delete }.accessibilityIdentifier("delete-account")
            Text(store.server).font(.system(size: 23)).foregroundStyle(.secondary)
            Button("Sign out", role: .destructive) { signOutConfirm = true }.accessibilityIdentifier("sign-out")
            ErrorBanner(store: store)
        }.onAppear { profileName = store.user["name"].string }
        .confirmationDialog("Sign out?", isPresented: $signOutConfirm, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await store.signOut() } }
        }
        .sheet(isPresented: $devices) { DevicesView(store: store) }
        .sheet(item: $security) { value in AccountSecurityView(store: store, action: value) }
    }
    private func preference(_ key: String, fallback: String) -> Binding<String> {
        Binding(get: { store.settings[key].optionalString ?? fallback }, set: { value in Task { await store.updateSettings(.object([key: .string(value)])) } })
    }
    private func boolPreference(_ key: String, fallback: Bool = false) -> Binding<Bool> {
        Binding(get: { store.settings[key] == .null ? fallback : store.settings[key].bool }, set: { value in Task { await store.updateSettings(.object([key: .bool(value)])) } })
    }
}

struct DevicesView: View {
    @Bindable var store: Store
    @State private var sessions: [JSON] = []
    @State private var removing: JSON?
    var body: some View {
        Panel(title: "Devices") {
            ForEach(sessions, id: \.id) { session in
                HStack(spacing: 30) {
                    VStack(alignment: .leading) { Text(session["deviceLabel"].string); if session["isCurrent"].bool { Text("This device").font(.system(size: 21)).foregroundStyle(.secondary) } }
                    Spacer()
                    if !session["isCurrent"].bool { Button("Sign out") { removing = session } }
                }
            }
            ErrorBanner(store: store)
        }.task { await refresh() }
        .confirmationDialog("Sign out this device?", isPresented: Binding(get: { removing != nil }, set: { if !$0 { removing = nil } }), titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { if let session = removing { Task { _ = await store.mutate("/api/me/sessions/\(API.resource(session.id))", method: "DELETE"); removing = nil; await refresh() } } }
        }
    }
    private func refresh() async {
        do { sessions = try await store.api?.request("/api/me/sessions")["sessions"].array ?? [] } catch { store.fail(error) }
    }
}


enum SecurityPanel: String, Identifiable {
    case password, delete
    var id: String { rawValue }
}

struct AccountSecurityView: View {
    @Bindable var store: Store
    let action: SecurityPanel
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var code = ""
    @State private var requirements: JSON = .null
    @State private var availability: JSON = .null
    @State private var confirming = false
    @State private var ready = false
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Panel(title: action == .password ? "Change password" : "Delete account") {
            if !ready { ProgressView() }
            if action == .delete && ready && !availability["accountDeletionEnabled"].bool {
                Text("Account deletion is unavailable on this server.")
                if let email = availability["adminEmail"].optionalString, !email.isEmpty { Text(email).foregroundStyle(.secondary) }
            } else if ready {
                if action == .delete {
                    Text("Permanently removes your chats, files, memories and shared links. Subscriptions are canceled and unused credits are forfeited. This cannot be undone.").font(.system(size: 25)).fixedSize(horizontal: false, vertical: true)
                }
                SecureField("Current password", text: $currentPassword).textContentType(.password).accessibilityIdentifier("security-password")
                if action == .password { SecureField("New password", text: $newPassword).textContentType(.newPassword) }
                if requirements["twoFactorEnabled"].bool {
                    TextField("Authenticator or recovery code", text: $code).textContentType(.oneTimeCode).autocorrectionDisabled()
                }
                Button(action == .password ? "Save password" : "Delete account", role: action == .delete ? .destructive : nil) {
                    if action == .delete { confirming = true } else { Task { await submit() } }
                }.disabled(store.working || currentPassword.isEmpty || (action == .password && newPassword.count < 8) || (requirements["twoFactorEnabled"].bool && code.isEmpty)).accessibilityIdentifier("security-submit")
            }
            if let error = store.error { Text(error).foregroundStyle(.red) }
            if !ready && store.error != nil { Button("Retry") { Task { await load() } } }
        }.task { await load() }
        .confirmationDialog("Permanently delete your account?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) { Task { await submit() } }
        }
    }
    private func load() async {
        if action == .password { ready = true; return }
        do {
            guard let api = store.api else { return }
            availability = try await api.request("/api/auth/settings")
            if availability["accountDeletionEnabled"].bool { requirements = try await api.request("/api/me/deletion") }
            ready = true
        } catch { store.fail(error) }
    }
    private func submit() async {
        var body: JSON = ["currentPassword": .string(currentPassword)]
        if action == .password { body["newPassword"] = .string(newPassword) }
        if requirements["twoFactorEnabled"].bool { body["verificationCode"] = .string(code) }
        if await store.securityRequest(action == .password ? "/api/me/password" : "/api/me", method: action == .password ? "POST" : "DELETE", body: body, endsSession: action == .delete) { dismiss() }
        else if action == .delete { await load(); code = "" }
    }
}
