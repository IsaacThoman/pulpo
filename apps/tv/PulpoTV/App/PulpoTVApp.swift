import SwiftUI

@main
struct PulpoTVApp: App {
    @State private var app = AppModel(environment: AppEnvironment.current())
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .preferredColorScheme(Self.forcedColorScheme)
                .task { await app.launch() }
        }
        .onChange(of: scenePhase) { _, phase in
            app.scenePhaseChanged(to: phase)
        }
    }

    /// The simulator can't switch tvOS appearance, so debug builds accept
    /// `-PulpoAppearance light|dark` to review both themes.
    private static var forcedColorScheme: ColorScheme? {
        #if DEBUG
        switch UserDefaults.standard.string(forKey: "PulpoAppearance") {
        case "light": return .light
        case "dark": return .dark
        default: return nil
        }
        #else
        return nil
        #endif
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        ZStack {
            Backdrop()
            switch app.phase {
            case .launching:
                LoadingView()
                    .transition(.opacity)
            case .signedOut:
                SignInView()
                    .transition(.opacity)
            case .pendingApproval:
                PendingApprovalView()
                    .transition(.opacity)
            case .signedIn:
                if let library = app.library {
                    MainView(library: library)
                        .transition(.opacity)
                }
            }
        }
        .animation(.easeInOut(duration: 0.35), value: app.phase)
    }
}
