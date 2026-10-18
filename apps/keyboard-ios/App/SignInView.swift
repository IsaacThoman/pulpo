import PulpoServices
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var attempt = SignInAttempt()
  @FocusState private var codeFocused: Bool

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Server", text: $attempt.instance)
            .textContentType(.URL)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityIdentifier("server")
        } footer: {
          Text("Use pulpo.baby or your own Pulpo server.")
        }
        Section {
          TextField("Email", text: $attempt.email)
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityIdentifier("email")
          SecureField("Password", text: $attempt.password)
            .textContentType(.password)
            .accessibilityIdentifier("password")
          if attempt.needsCode {
            TextField("Authentication Code", text: $attempt.code)
              .textContentType(.oneTimeCode)
              .keyboardType(.numberPad)
              .accessibilityIdentifier("code")
              .focused($codeFocused)
            Button("Use Email and Password") { attempt.backToCredentials() }
              .accessibilityIdentifier("sign-in-back")
          }
        }
        if let error = attempt.error {
          Section {
            // Primary text keeps the message readable; the symbol carries the color.
            Label {
              Text(error)
            } icon: {
              Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Couldn't sign in. \(error)")
            .accessibilityIdentifier("sign-in-error")
          }
        }
        Section {
          Button {
            attempt.submit(using: model) { dismiss() }
          } label: {
            HStack {
              Text("Sign In")
              if attempt.working {
                Spacer()
                ProgressView()
              }
            }
          }
          .disabled(attempt.working || attempt.email.isEmpty || attempt.password.isEmpty)
          .accessibilityIdentifier("submit-sign-in")
        }
      }
      .navigationTitle("Sign In to Pulpo")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            attempt.cancel()
            dismiss()
          }
        }
      }
    }
    .onDisappear { attempt.cancel() }
    .onChange(of: attempt.needsCode) { _, needsCode in codeFocused = needsCode }
    .onChange(of: attempt.error) { _, error in
      if let error {
        AccessibilityNotification.Announcement("Couldn't sign in. \(error)").post()
      }
    }
  }
}
