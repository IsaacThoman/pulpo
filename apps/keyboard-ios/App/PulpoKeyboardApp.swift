import KeyboardCore
import SwiftUI

@main
struct PulpoKeyboardApp: App {
  @State private var model = AppModel()
  @Environment(\.scenePhase) private var scenePhase

  var body: some Scene {
    WindowGroup {
      HomeView()
        .environment(model)
        .onOpenURL { model.handle($0) }
        .onChange(of: scenePhase) { _, phase in
          guard phase == .active else { return }
          model.refreshStatus()
          Task { await model.refreshAccount() }
        }
    }
  }
}

struct HomeView: View {
  @Environment(AppModel.self) private var model
  @State private var confirmClear = false
  @State private var path: [Screen] = ProcessInfo.processInfo.arguments.contains("-PKPreview") ? [.tryIt] : []

  enum Screen: Hashable {
    case tryIt
  }

  var body: some View {
    @Bindable var model = model
    NavigationStack(path: $path) {
      List {
        Section {
          HStack(spacing: 14) {
            Image("PulpoSmiley")
              .resizable()
              .interpolation(.high)
              .frame(width: 52, height: 52)
            VStack(alignment: .leading, spacing: 2) {
              Text("Pulpo Keyboard").font(.title2.weight(.semibold))
              Text("Swipe typing, on-device autocorrect, and Pulpo dictation.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
          }
          .padding(.vertical, 4)
        }

        SetupSection()

        Section {
          NavigationLink(value: Screen.tryIt) {
            Label("Try It", systemImage: "keyboard")
          }
          .accessibilityIdentifier("try-it")
        }

        AccountSection()

        Section {
          Toggle("Auto-Correction", isOn: $model.settings.autocorrect)
          Toggle("Predictive Text", isOn: $model.settings.predictions)
          Toggle("Auto-Capitalization", isOn: $model.settings.autoCapitalization)
          Toggle("\u{201C}.\u{201D} Shortcut", isOn: $model.settings.doubleSpacePeriod)
          Toggle("Smart Punctuation", isOn: $model.settings.smartPunctuation)
          Toggle("Slide to Type", isOn: $model.settings.swipeTyping)
          Toggle("Show Slide Trail", isOn: $model.settings.swipeTrail)
            .disabled(!model.settings.swipeTyping)
          Toggle("Character Preview", isOn: $model.settings.keyPopups)
          Toggle("Number Hints on Top Row", isOn: $model.settings.digitHints)
        } header: {
          Text("Typing")
        } footer: {
          Text("Double-tapping the space bar types a period. Slide to Type lets you swipe across letters to write a word.")
        }

        Section("Feedback") {
          Toggle("Haptic Feedback", isOn: $model.settings.haptics)
          Toggle("Sound", isOn: $model.settings.sounds)
        }

        Section {
          Picker("Keep Microphone Ready", selection: $model.settings.dictationStandbyMinutes) {
            Text("Off").tag(0)
            Text("1 minute").tag(1)
            Text("5 minutes").tag(5)
            Text("15 minutes").tag(15)
          }
        } header: {
          Text("Dictation")
        } footer: {
          Text("Keyboards can't use the microphone, so Pulpo Keyboard briefly opens this app to record. Keeping the microphone ready lets your next dictation start right away without leaving your app. iOS shows the microphone indicator while it's ready.")
        }

        Section {
          Toggle("Learn New Words", isOn: $model.settings.learnWords)
          Button("Clear Learned Words", role: .destructive) { confirmClear = true }
        } header: {
          Text("Privacy")
        } footer: {
          Text("Everything you type stays on this device. Autocorrect, predictions and learned words never leave it. Only dictation recordings you start are sent to your Pulpo account. Passwords and other private fields are never learned.")
        }

        Section("About") {
          LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
          Text("English dictionary from the Android Open Source Project (Apache 2.0). Next-word statistics derived from Tatoeba sentences (CC-BY 2.0 FR). Emoji data from Unicode.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        }
      }
      .navigationTitle("Keyboard")
      .navigationBarTitleDisplayMode(.inline)
      .navigationDestination(for: Screen.self) { _ in TryItView() }
      .confirmationDialog("Clear all learned words?", isPresented: $confirmClear, titleVisibility: .visible) {
        Button("Clear Learned Words", role: .destructive) { model.clearLearnedWords() }
      } message: {
        Text("Pulpo Keyboard forgets the words it learned from your typing.")
      }
      .sheet(isPresented: Binding(get: { model.route == .account && model.session == nil }, set: { if !$0 { model.route = nil } })) {
        SignInView()
      }
      .fullScreenCover(isPresented: Binding(get: { model.route == .dictation }, set: { if !$0 { model.route = nil } })) {
        DictationSessionView()
      }
    }
  }
}

struct SetupSection: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Section {
      SetupRow(done: model.keyboardEnabled, title: "Add Pulpo Keyboard", detail: "Settings › General › Keyboard › Keyboards › Add New Keyboard")
      SetupRow(done: model.fullAccess, title: "Allow Full Access", detail: "Needed for dictation, haptics, and syncing settings with the keyboard. Your typing stays on this device.")
      if !model.setupComplete {
        Button {
          model.openSystemSettings()
        } label: {
          Label("Open Settings", systemImage: "gear")
        }
      }
    } header: {
      Text("Setup")
    } footer: {
      if !model.setupComplete {
        Text("In Settings, tap Keyboards, turn on Pulpo Keyboard, then turn on Allow Full Access. When typing, tap or hold \u{1F310} to switch to it.")
      }
    }
  }
}

struct SetupRow: View {
  let done: Bool
  let title: String
  let detail: String

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: done ? "checkmark.circle.fill" : "circle")
        .font(.title3)
        .foregroundStyle(done ? Color.green : Color.secondary)
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
        Text(detail).font(.footnote).foregroundStyle(.secondary)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityValue(done ? "Done" : "Not done")
  }
}

struct AccountSection: View {
  @Environment(AppModel.self) private var model
  @State private var signingIn = false

  var body: some View {
    Section {
      if let session = model.session {
        LabeledContent("Signed In", value: session.user.name)
        LabeledContent("Server", value: session.instance.host() ?? session.instance.absoluteString)
        LabeledContent("Dictation", value: session.dictationAvailable ? "Available" : "Not enabled on this server")
        if let balance = session.user.balance, balance != 0 {
          LabeledContent("Balance", value: balance.formatted(.currency(code: "USD")))
        }
        Button("Sign Out", role: .destructive) { model.signOut() }
      } else {
        Button {
          signingIn = true
        } label: {
          Label("Sign In to Pulpo", systemImage: "person.crop.circle")
        }
        .accessibilityIdentifier("sign-in")
      }
    } header: {
      Text("Pulpo Account")
    } footer: {
      Text("Dictation uses the same transcription as Pulpo and is billed to your Pulpo account.")
    }
    .sheet(isPresented: $signingIn) { SignInView() }
  }
}
