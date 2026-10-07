import PulpoServices
import SwiftUI

struct SignInView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var instance = PulpoClient.defaultInstance.host() ?? "pulpo.baby"
  @State private var email = ""
  @State private var password = ""
  @State private var code = ""
  @State private var needsCode = false
  @State private var working = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Server", text: $instance)
            .textContentType(.URL)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityIdentifier("server")
        } footer: {
          Text("Use pulpo.baby or your own Pulpo server.")
        }
        Section {
          TextField("Email", text: $email)
            .textContentType(.username)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityIdentifier("email")
          SecureField("Password", text: $password)
            .textContentType(.password)
            .accessibilityIdentifier("password")
          if needsCode {
            TextField("Authentication Code", text: $code)
              .textContentType(.oneTimeCode)
              .keyboardType(.numberPad)
              .accessibilityIdentifier("code")
          }
        }
        if let error {
          Section {
            Text(error).foregroundStyle(.red)
          }
        }
        Section {
          Button {
            Task { await signIn() }
          } label: {
            HStack {
              Text("Sign In")
              if working {
                Spacer()
                ProgressView()
              }
            }
          }
          .disabled(working || email.isEmpty || password.isEmpty)
          .accessibilityIdentifier("submit-sign-in")
        }
      }
      .navigationTitle("Sign In to Pulpo")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
      }
    }
  }

  private func signIn() async {
    working = true
    error = nil
    defer { working = false }
    do {
      try await model.signIn(instance: instance, email: email, password: password, twoFactorCode: needsCode ? code : nil)
      dismiss()
    } catch let failure as PulpoError where failure.needsTwoFactor {
      needsCode = true
      error = needsCode && !code.isEmpty ? failure.message : nil
    } catch {
      self.error = error.localizedDescription
    }
  }
}
