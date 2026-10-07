import PulpoKit
import SwiftUI

/// Where a navigation stack can go.
enum Route: Hashable {
    case chat(id: String)
    /// A new chat, optionally sending `prompt` as soon as it opens.
    case newChat(token: UUID, prompt: String?)

    static func new(prompt: String? = nil) -> Route {
        .newChat(token: UUID(), prompt: prompt)
    }
}

struct MainView: View {
    let library: LibraryModel
    @State private var tab: MainTab = .chats
    @State private var chatsPath: [Route] = []
    @State private var searchPath: [Route] = []

    enum MainTab: Hashable {
        case chats, search, settings
    }

    var body: some View {
        TabView(selection: $tab) {
            Tab("Chats", systemImage: "bubble.left.and.bubble.right", value: MainTab.chats) {
                NavigationStack(path: $chatsPath) {
                    HomeView(library: library) { chatsPath.append($0) }
                        .navigationDestination(for: Route.self) { ConversationScreen(route: $0, library: library) }
                }
            }
            Tab(value: MainTab.search, role: .search) {
                NavigationStack(path: $searchPath) {
                    SearchView(library: library) { searchPath.append($0) }
                        .navigationDestination(for: Route.self) { ConversationScreen(route: $0, library: library) }
                }
            }
            Tab("Settings", systemImage: "gearshape", value: MainTab.settings) {
                SettingsView(library: library)
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .task { await library.loadIfNeeded() }
    }
}

/// Owns a conversation's model for as long as it is on the navigation stack.
struct ConversationScreen: View {
    @Environment(AppModel.self) private var app
    let route: Route
    let library: LibraryModel
    @State private var model: ConversationModel?

    var body: some View {
        Group {
            if let model {
                ConversationView(model: model, initialPrompt: initialPrompt)
            } else {
                Color.clear
            }
        }
        .onAppear {
            if model == nil { model = ConversationModel(chatId: chatId, library: library, app: app) }
        }
    }

    private var chatId: String? {
        if case .chat(let id) = route { return id }
        return nil
    }

    private var initialPrompt: String? {
        if case .newChat(_, let prompt) = route { return prompt }
        return nil
    }
}
