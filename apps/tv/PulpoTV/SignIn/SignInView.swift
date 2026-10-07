import PulpoKit
import SwiftUI

struct SignInView: View {
    @Environment(AppModel.self) private var app
    @State private var model: SignInModel?

    var body: some View {
        HStack(spacing: 0) {
            BrandPanel()
                .frame(maxWidth: .infinity)
            Group {
                if let model {
                    SignInForm(model: model)
                }
            }
            .frame(width: 860)
            .padding(.trailing, Theme.screenPadding + 40)
        }
        .task {
            if model == nil { model = SignInModel(environment: app.environment) }
            await model?.loadInstance()
        }
    }
}

/// The smiley floating over its glow, with the wordmark beneath.
private struct BrandPanel: View {
    var body: some View {
        VStack(spacing: 44) {
            TimelineView(.animation) { context in
                BrandMark(size: 300, glowing: true)
                    .offset(y: 12 * oscillation(context.date, period: 6.4))
                    .rotationEffect(.degrees(2 * oscillation(context.date, period: 6.4, offset: 0.25)))
            }
            VStack(spacing: 14) {
                Text("Pulpo")
                    .font(.system(size: 104, weight: .bold, design: .rounded))
                    .foregroundStyle(Theme.text)
                Text("Every model, on the big screen.")
                    .font(.title3)
                    .foregroundStyle(Theme.secondaryText)
            }
        }
    }
}

private struct SignInForm: View {
    @Environment(AppModel.self) private var app
    @Bindable var model: SignInModel
    @FocusState private var focus: Field?

    enum Field: Hashable {
        case email, password, code, server, submit
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 34) {
            header
            if let notice = app.signedOutNotice, model.step == .credentials {
                Label(notice, systemImage: "info.circle")
                    .font(.callout)
                    .foregroundStyle(Theme.secondaryText)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(notice)
            }
            switch model.step {
            case .credentials: credentials
            case .twoFactor: twoFactor
            case .server: serverChoice
            }
            if let error = model.error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.callout)
                    .foregroundStyle(Theme.critical)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(error)
                    .accessibilityIdentifier("sign-in-error")
            }
        }
        .padding(64)
        .background(RoundedRectangle(cornerRadius: 48, style: .continuous).fill(.regularMaterial))
        .overlay(RoundedRectangle(cornerRadius: 48, style: .continuous).strokeBorder(Theme.separator, lineWidth: 2))
        .disabled(model.isWorking)
        .animation(.easeInOut(duration: 0.25), value: model.step)
        .onChange(of: model.step) { _, step in
            focus = switch step {
            case .credentials: model.email.isEmpty ? .email : .password
            case .twoFactor: .code
            case .server: .server
            }
        }
        .defaultFocus($focus, model.email.isEmpty ? .email : .password)
    }

    @ViewBuilder private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.title2.weight(.bold))
            Text(subtitle)
                .font(.callout)
                .foregroundStyle(Theme.secondaryText)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var title: String {
        switch model.step {
        case .credentials: "Sign in"
        case .twoFactor: "Two-factor authentication"
        case .server: "Choose a server"
        }
    }

    private var subtitle: String {
        switch model.step {
        case .credentials:
            let name = model.instanceName.map { $0 == "Pulpo" ? "" : " (\($0))" } ?? ""
            return "to \(model.server.displayName)\(name)"
        case .twoFactor:
            return "Enter the 6-digit code from your authenticator app, or one of your recovery codes."
        case .server:
            return "Connect to a self-hosted Pulpo instance. Leave this empty to use pulpo.baby."
        }
    }

    @ViewBuilder private var credentials: some View {
        VStack(spacing: 22) {
            TextField("Email", text: $model.email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($focus, equals: .email)
                .submitLabel(.next)
                .onSubmit { focus = .password }
                .fieldBackground()
                .accessibilityIdentifier("email")
            SecureField("Password", text: $model.password)
                .textContentType(.password)
                .focused($focus, equals: .password)
                .submitLabel(.go)
                .onSubmit { Task { await model.submitCredentials(app: app) } }
                .fieldBackground()
                .accessibilityIdentifier("password")
        }
        Button {
            Task { await model.submitCredentials(app: app) }
        } label: {
            ProgressLabel(title: "Sign In", working: model.isWorking)
        }
        .buttonStyle(.borderedProminent)
        .disabled(!model.canSubmitCredentials)
        .focused($focus, equals: .submit)
        .accessibilityIdentifier("sign-in")
        HStack(spacing: 18) {
            Image(systemName: "iphone")
            Text("Typing is easier on your iPhone: when the keyboard appears, use the notification on your phone.")
        }
        .font(.caption)
        .foregroundStyle(Theme.secondaryText)
        .fixedSize(horizontal: false, vertical: true)
        Button("Use a Different Server") { model.showServerStep() }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("change-server")
    }

    @ViewBuilder private var twoFactor: some View {
        TextField("Code", text: $model.code)
            .textContentType(.oneTimeCode)
            .keyboardType(.asciiCapable)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.characters)
            .focused($focus, equals: .code)
            .submitLabel(.done)
            .onSubmit { Task { await model.submitCode(app: app) } }
            .fieldBackground()
            .accessibilityIdentifier("two-factor-code")
        HStack(spacing: 24) {
            Button {
                Task { await model.submitCode(app: app) }
            } label: {
                ProgressLabel(title: "Verify", working: model.isWorking)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canSubmitCode)
            .accessibilityIdentifier("verify")
            Button("Back") { model.backToCredentials() }
                .buttonStyle(.bordered)
        }
    }

    @ViewBuilder private var serverChoice: some View {
        TextField("pulpo.example.com", text: $model.serverInput)
            .keyboardType(.URL)
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .focused($focus, equals: .server)
            .submitLabel(.continue)
            .onSubmit { Task { await model.submitServer() } }
            .fieldBackground()
            .accessibilityIdentifier("server-address")
        HStack(spacing: 24) {
            Button {
                Task { await model.submitServer() }
            } label: {
                ProgressLabel(title: "Continue", working: model.isWorking)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("server-continue")
            Button("Use pulpo.baby") { Task { await model.useDefaultServer() } }
                .buttonStyle(.bordered)
            Button("Cancel") { model.backToCredentials() }
                .buttonStyle(.bordered)
        }
    }
}

/// A button title that swaps to a spinner while its action runs.
struct ProgressLabel: View {
    var title: String
    var working: Bool

    var body: some View {
        ZStack {
            Text(title).opacity(working ? 0 : 1)
            if working { ProgressView() }
        }
        .frame(maxWidth: .infinity)
    }
}

struct PendingApprovalView: View {
    @Environment(AppModel.self) private var app
    @State private var message: String?
    @State private var checking = false

    var body: some View {
        VStack(spacing: 40) {
            BrandMark(size: 180, glowing: true)
            Text("Waiting for approval")
                .font(.title2.weight(.bold))
            Text(message ?? "Your account is pending approval. An admin will review it shortly.")
                .font(.callout)
                .foregroundStyle(Theme.secondaryText)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 1000)
            if let user = app.user {
                Text("Signed in as \(user.email)")
                    .font(.caption)
                    .foregroundStyle(Theme.tertiaryText)
            }
            HStack(spacing: 30) {
                Button {
                    Task {
                        checking = true
                        await app.refreshUser()
                        checking = false
                    }
                } label: {
                    ProgressLabel(title: "Check Again", working: checking)
                        .frame(width: 280)
                }
                .buttonStyle(.borderedProminent)
                Button("Sign Out") { Task { await app.signOut() } }
                    .buttonStyle(.bordered)
            }
        }
        .task {
            if let api = app.api {
                message = try? await api.instanceConfig().auth?.pendingMessage
            }
        }
    }
}
