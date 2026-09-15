import SwiftUI

@main struct PulpoTVApp: App {
    @State private var store = Store()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView(store: store)
                .preferredColorScheme(store.settings["theme"].string == "light" ? .light : store.settings["theme"].string == "dark" ? .dark : nil)
                .task { await store.bootstrap() }
                .task { await store.poll() }
                .onChange(of: phase) { _, next in Task { await store.foreground(next == .active) } }
        }
    }
}

struct RootView: View {
    @Bindable var store: Store
    var body: some View {
        Group {
            if store.loading { ProgressView().accessibilityLabel("Loading Pulpo") }
            else if store.session == nil { SignInView(store: store) }
            else if store.user["role"].string == "pending" {
                VStack(spacing: 28) {
                    Text("Account pending").font(.title)
                    if let message = store.config["auth"]["pendingMessage"].optionalString, !message.isEmpty { Text(message) }
                    Button("Refresh") { Task { await store.reload() } }
                    Button("Sign out") { Task { await store.signOut() } }
                    ErrorBanner(store: store)
                }.frame(maxWidth: 800)
            } else { ChatShell(store: store) }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Palette.background)
        .tint(.primary)
    }
}

enum Palette {
    static let background = Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? .black : UIColor(red: 0.961, green: 0.961, blue: 0.969, alpha: 1) })
    static let panel = Color.primary.opacity(0.055)
    static let separator = Color.primary.opacity(0.10)
}

struct TVButtonStyle: ButtonStyle {
    @Environment(\.isFocused) private var focused
    @Environment(\.colorScheme) private var scheme
    var selected = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(focused ? (scheme == .dark ? Color.black : .white) : .primary)
            .padding(.horizontal, 20).padding(.vertical, 15)
            .background(focused ? Color.primary : selected ? Color.primary.opacity(0.14) : .clear, in: RoundedRectangle(cornerRadius: 14))
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: focused)
    }
}

struct ErrorBanner: View {
    @Bindable var store: Store
    var body: some View {
        if let error = store.error {
            HStack(spacing: 24) {
                Image(systemName: "exclamationmark.circle")
                Text(error).font(.system(size: 23)).lineLimit(3)
                Spacer()
                Button("Retry") { Task { if store.pending != nil { await store.retrySend() } else { await store.reload() } } }
                    .disabled(store.working).accessibilityIdentifier("error-retry")
                Button { store.error = nil } label: { Image(systemName: "xmark") }.accessibilityLabel("Dismiss error")
            }.padding(20).background(Palette.panel, in: RoundedRectangle(cornerRadius: 16))
        }
    }
}

struct SignInView: View {
    @Bindable var store: Store
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""
    @State private var name = ""
    @State private var username = ""
    @State private var signup = false
    @State private var showServer = false
    var body: some View {
        HStack(spacing: 140) {
            VStack(spacing: 24) {
                Image("PulpoMark").resizable().scaledToFit().frame(width: 130, height: 130)
                Text("Pulpo").font(.system(size: 56, weight: .semibold))
            }.frame(width: 300)
            ScrollView {
                VStack(alignment: .leading, spacing: 25) {
                    Text(signup ? "Create account" : "Sign in").font(.title2).fontWeight(.semibold)
                    if signup {
                        TextField("Name", text: $name).textContentType(.name).accessibilityIdentifier("signup-name")
                        TextField("Username", text: $username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    TextField("Email", text: $email).textContentType(.username).keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("login-email")
                    SecureField("Password", text: $password).textContentType(signup ? .newPassword : .password).accessibilityIdentifier("login-password")
                    if !signup && store.requiresTwoFactor {
                        TextField("Authenticator or recovery code", text: $code).textContentType(.oneTimeCode)
                            .textInputAutocapitalization(.characters).autocorrectionDisabled().accessibilityIdentifier("login-code")
                    }
                    if let error = store.error { Text(error).foregroundStyle(.red).font(.system(size: 22)).accessibilityIdentifier("login-error") }
                    Button {
                        Task { await store.authenticate(email: email, password: password, code: code, name: name, username: username, signup: signup) }
                    } label: {
                        HStack { Text(store.working ? "Signing in…" : signup ? "Create account" : "Sign in"); Spacer(); Image(systemName: "arrow.right") }
                    }.disabled(store.working || email.isEmpty || password.isEmpty || (signup && (name.isEmpty || username.isEmpty)))
                        .accessibilityIdentifier("login-submit")
                    HStack(spacing: 24) {
                        Button(store.server.replacingOccurrences(of: "https://", with: "")) { showServer = true }.accessibilityIdentifier("change-server")
                        if store.config["auth"]["signupEnabled"].bool {
                            Button(signup ? "Sign in" : "Create account") { signup.toggle(); store.error = nil }
                        }
                    }.font(.system(size: 21))
                }.padding(35)
            }.frame(width: 740, height: signup ? 880 : 720)
        }
        .sheet(isPresented: $showServer) {
            Panel(title: "Server") {
                TextField("Server address", text: $store.server).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                if let error = store.error { Text(error).foregroundStyle(.red) }
                Button("Connect") { Task { await store.loadConfig(); if store.error == nil { showServer = false } } }.accessibilityIdentifier("server-connect")
            }
        }
        #if DEBUG
        .onAppear {
            if ProcessInfo.processInfo.arguments.contains("-UITesting") {
                email = ProcessInfo.processInfo.environment["PULPO_TV_TEST_EMAIL"] ?? ""
                password = ProcessInfo.processInfo.environment["PULPO_TV_TEST_PASSWORD"] ?? ""
            }
        }
        #endif
    }
}

struct Panel<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            HStack { Text(title).font(.title2).fontWeight(.semibold); Spacer(); Button("Done") { dismiss() }.accessibilityIdentifier("panel-done") }
            ScrollView { VStack(alignment: .leading, spacing: 28) { content }.padding(30) }.scrollClipDisabled()
        }.padding(.horizontal, 100).padding(.vertical, 60).frame(maxWidth: 1400, maxHeight: .infinity)
            .background(Palette.background)
            .onExitCommand { dismiss() }
    }
}

struct Choice: Identifiable {
    let id: String
    let title: String
    init(_ id: String, _ title: String) { self.id = id; self.title = title }
}

/// tvOS defaults Picker to a segmented control. A list scales to a full model
/// catalog and keeps the setting's label visible at television distance.
struct ChoiceRow: View {
    let title: String
    @Binding var selection: String
    let choices: [Choice]
    @State private var choosing = false
    var body: some View {
        Button { choosing = true } label: {
            HStack(spacing: 25) {
                Text(title)
                Spacer()
                Text(choices.first { $0.id == selection }?.title ?? "None").foregroundStyle(.secondary).lineLimit(1)
                Image(systemName: "chevron.right").font(.system(size: 20))
            }
        }
        .sheet(isPresented: $choosing) {
            Panel(title: title) {
                ForEach(choices) { choice in
                    Button {
                        selection = choice.id; choosing = false
                    } label: {
                        HStack { Text(choice.title); Spacer(); if choice.id == selection { Image(systemName: "checkmark") } }
                    }.buttonStyle(TVButtonStyle(selected: choice.id == selection)).accessibilityIdentifier("choice-\(choice.id)")
                }
            }
        }
    }
}
