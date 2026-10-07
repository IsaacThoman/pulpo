import Observation
import PulpoKit

@MainActor
@Observable
final class SignInModel {
    enum Step: Equatable {
        case credentials
        case twoFactor
        case server
    }

    private(set) var step: Step = .credentials
    private(set) var server: ServerAddress
    private(set) var instanceName: String?
    private(set) var isWorking = false
    var email: String
    var password = ""
    var code = ""
    var serverInput = ""
    var error: String?

    private let environment: AppEnvironment

    init(environment: AppEnvironment) {
        self.environment = environment
        self.server = Preferences.lastServer ?? environment.defaultServer
        self.email = Preferences.lastEmail ?? ""
    }

    var canSubmitCredentials: Bool {
        !isWorking && email.contains("@") && !password.isEmpty
    }

    var canSubmitCode: Bool {
        !isWorking && code.trimmingCharacters(in: .whitespaces).count >= 6
    }

    private var api: PulpoAPI { PulpoAPI(environment.makeHTTPClient(server, nil)) }

    /// Reads the instance's name for the form's subtitle.
    func loadInstance() async {
        instanceName = try? await api.instanceConfig().instance.name
    }

    func submitCredentials(app: AppModel) async {
        guard canSubmitCredentials else { return }
        await signIn(app: app, code: nil)
    }

    func submitCode(app: AppModel) async {
        guard canSubmitCode else { return }
        await signIn(app: app, code: code.trimmingCharacters(in: .whitespaces))
    }

    private func signIn(app: AppModel, code: String?) async {
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let response = try await api.login(.init(
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                password: password,
                twoFactorCode: code,
                deviceLabel: environment.deviceLabel
            ))
            password = ""
            self.code = ""
            app.completeSignIn(server: server, auth: response)
        } catch let failure as APIError {
            switch failure.code {
            case "two_factor_required":
                step = .twoFactor
            case "two_factor_code_invalid":
                error = "That code didn’t work. Check your authenticator app and try again."
                self.code = ""
            case "two_factor_rate_limited":
                error = "Too many attempts. Wait a few minutes, then try again."
            case "unauthorized":
                error = "That email and password don’t match an account on \(server.displayName)."
            default:
                error = failure.message
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func showServerStep() {
        serverInput = server == .production ? "" : server.displayName
        error = nil
        step = .server
    }

    func backToCredentials() {
        error = nil
        code = ""
        step = .credentials
    }

    /// Validates the address and checks that a Pulpo server answers there.
    func submitServer() async {
        let input = serverInput.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate: ServerAddress
        do {
            candidate = input.isEmpty ? environment.defaultServer : try ServerAddress(input, allowLocalHTTP: environment.allowLocalHTTP)
        } catch {
            self.error = error.localizedDescription
            return
        }
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let config = try await PulpoAPI(environment.makeHTTPClient(candidate, nil)).instanceConfig()
            server = candidate
            instanceName = config.instance.name
            Preferences.lastServer = candidate
            step = .credentials
        } catch let failure as APIError where failure.isOffline || failure.code == "tls" {
            error = "Couldn’t connect to \(candidate.displayName). Check the address and try again."
        } catch {
            self.error = "\(candidate.displayName) doesn’t appear to be a Pulpo server."
        }
    }

    func useDefaultServer() async {
        serverInput = ""
        await submitServer()
    }
}
