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
  @State private var confirmReset = false
  @State private var showLearningClearResult = false
  @State private var learningClearSucceeded = false
  // A scratch draft lives for this scene, including Settings navigation. Never
  // persist typing samples to preferences, the app group, or disk.
  @State private var tryItDraft = TryItDraft()
  @State private var tryItFocused = true
  /// Shared with the keyboard, which also changes it from the emoji key's menu.
  @AppStorage(OneHandedStore.key, store: AppGroup.defaults) private var oneHanded: OneHandedMode = .off
  @State private var path: [Screen] = ProcessInfo.processInfo.arguments.contains("-PKPreview") ? [.tryIt] : []

  enum Screen: Hashable {
    case tryIt, tips, privacy
  }

  var body: some View {
    @Bindable var model = model
    NavigationStack(path: $path) {
      ScrollViewReader { settingsScroll in
        List {
          Section {
            AppHeader()
          }

          SetupSection()

          Section {
            NavigationLink(value: Screen.tryIt) {
              Label("Try It", systemImage: "keyboard")
            }
            .accessibilityIdentifier("try-it")
            NavigationLink(value: Screen.tips) {
              Label("Tips & Gestures", systemImage: "lightbulb")
            }
            .accessibilityIdentifier("tips")
          }

          AccountSection()

          if model.keyboardEnabled, !model.fullAccess {
            Section {
              Label("Until Full Access is on, changes here, including typing language, don't reach the installed keyboard.", systemImage: "info.circle")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("settings-need-full-access")
            }
          }

          Section {
            Picker("Typing Language", selection: $model.settings.language) {
              ForEach(KeyboardLanguage.allCases, id: \.self) { language in
                Text(language.title).tag(language)
              }
            }
            .accessibilityIdentifier("typing-language")
            .id("typing-language")
          } header: {
            Text("Language")
          } footer: {
            Text("Spelling, suggestions and slide typing run on this iPhone. English + Español accepts both languages without switching. Touch and hold a letter for accents or ñ. This does not change dictation or translate text.")
          }

          Section("Typing") {
            SettingToggle("Auto-Correction", detail: "Fixes misspelled words when you type a space or punctuation.", isOn: $model.settings.autocorrect)
            SettingToggle("Predictive Text", detail: "Suggests words above the keys as you type.", isOn: $model.settings.predictions)
            SettingToggle("Auto-Capitalization", detail: "Capitalizes the first word of each sentence.", isOn: $model.settings.autoCapitalization)
            SettingToggle("\u{201C}.\u{201D} Shortcut", detail: "Double-tap the space bar to type a period and a space.", isOn: $model.settings.doubleSpacePeriod)
            SettingToggle("Smart Punctuation", detail: "Uses curly quotes and fixes the space around punctuation.", isOn: $model.settings.smartPunctuation)
          }

          Section("Slide to Type") {
            SettingToggle("Slide to Type", detail: "Slide across the letters of a word, then lift.", isOn: $model.settings.swipeTyping)
            SettingToggle("Show Slide Trail", detail: "Draws a line behind your finger as you slide.", isOn: $model.settings.swipeTrail)
              .disabled(!model.settings.swipeTyping)
          }

          Section {
            SettingToggle("Character Preview", detail: "Shows a larger letter above your finger as you type.", isOn: $model.settings.keyPopups)
            SettingToggle("Number Hints on Top Row", detail: "Shows a number on each top-row key. Touch and hold to type it.", isOn: $model.settings.digitHints)
            Picker("One-Handed Keyboard", selection: $oneHanded) {
              Text("Off").tag(OneHandedMode.off)
              Text("Left").tag(OneHandedMode.left)
              Text("Right").tag(OneHandedMode.right)
            }
            .accessibilityIdentifier("one-handed-setting")
            .id("one-handed-setting")
          } header: {
            Text("Keys")
          } footer: {
            Text("You can also touch and hold the emoji key to switch to a one-handed keyboard.")
          }

          Section {
            SettingToggle("Haptic Feedback", detail: "A light tap with each key. Needs Full Access.", isOn: $model.settings.haptics)
            SettingToggle("Sound", detail: "Key clicks, when Keyboard Clicks is on in Settings › Sounds & Haptics.", isOn: $model.settings.sounds)
          } header: {
            Text("Feedback")
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
            Text("Keyboards can't use the microphone, so Pulpo Keyboard briefly opens this app to record. Keeping the microphone ready lets your next dictation start right away without leaving your app. iOS shows the microphone indicator while it's ready, and nothing is recorded until you start a dictation.")
          }

          Section {
            SettingToggle("Learn New Words", detail: "Remembers words you type often, on this iPhone only.", isOn: $model.settings.learnWords)
              .id("privacy-settings")
            Button("Clear Learned Words", role: .destructive) { confirmClear = true }
              .accessibilityIdentifier("clear-learned-words")
            NavigationLink(value: Screen.privacy) {
              Text("Full Access & Privacy")
            }
            .accessibilityIdentifier("privacy")
          } header: {
            Text("Privacy")
          } footer: {
            Text("Everything you type stays on this device. Autocorrect, predictions and learned words never leave it. Only dictation recordings you start are sent to your Pulpo account. Passwords and other private fields are never learned.")
          }

          Section {
            Button("Reset Keyboard Settings", role: .destructive) { confirmReset = true }
              .accessibilityIdentifier("reset-settings")
          } footer: {
            Text("Turns the settings above back to their defaults. Learned words and your Pulpo account stay as they are.")
          }

          Section("About") {
            LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0")
            Text("English and Spanish dictionaries from the Android Open Source Project (Apache 2.0). Next-word statistics derived from Tatoeba sentences (CC-BY 2.0 FR). Emoji data from Unicode.")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        }
        .toolbar {
          ToolbarItem(placement: .topBarTrailing) {
            Menu("Find Setting", systemImage: "magnifyingglass") {
              Button("Language") { settingsScroll.scrollTo("typing-language", anchor: .top) }
              Button("One-Handed") { settingsScroll.scrollTo("one-handed-setting", anchor: .top) }
              Button("Privacy & Learning") { settingsScroll.scrollTo("privacy-settings", anchor: .top) }
            }
            .accessibilityIdentifier("find-setting")
            .accessibilityHint("Jump to language, one-handed keyboard, or privacy and learning settings.")
          }
        }
        .navigationTitle("Keyboard")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: Screen.self) { screen in
          switch screen {
          case .tryIt: TryItView(draft: $tryItDraft, focused: $tryItFocused)
          case .tips: TipsView()
          case .privacy: PrivacyView()
          }
        }
        .confirmationDialog("Clear all learned words?", isPresented: $confirmClear, titleVisibility: .visible) {
          Button("Clear Learned Words", role: .destructive) {
            learningClearSucceeded = model.clearLearnedWords()
            showLearningClearResult = true
          }
        } message: {
          Text("Clears learned words and touch adjustments shared with this app. Learning stored only inside a keyboard without shared access can’t be cleared here. Your language and keyboard settings stay as they are.")
        }
        .confirmationDialog("Reset keyboard settings?", isPresented: $confirmReset, titleVisibility: .visible) {
          Button("Reset Settings", role: .destructive) { model.resetSettings() }
        } message: {
          Text("Every setting goes back to its default. Learned words and your Pulpo account stay as they are.")
        }
        .alert(learningClearSucceeded ? "Learned Words Cleared" : "Couldn’t Clear Learned Words", isPresented: $showLearningClearResult) {
          Button("OK", role: .cancel) {}
        } message: {
          if learningClearSucceeded {
            Text(model.settings.learnWords ? "Shared learned words and touch adjustments have been cleared. Pulpo Keyboard starts learning again as you type." : "Shared learned words and touch adjustments have been cleared. Learn New Words is off, so nothing new will be learned.")
          } else {
            Text(model.learningResetError ?? "Couldn’t clear learned words. Please try again.")
          }
        }
        .fullScreenCover(isPresented: $model.showSetupGuide) {
          SetupGuideView()
        }
        .sheet(isPresented: Binding(get: { model.route == .account && model.session == nil }, set: { if !$0 { model.route = nil } })) {
          SignInView()
        }
        .fullScreenCover(isPresented: Binding(get: { model.route == .dictation }, set: { if !$0 { model.route = nil } })) {
          DictationSessionView()
        }
      }
    }
    .onChange(of: path) { _, screens in
      // The in-app keyboard can update shared preferences while the settings
      // screen's model remains alive behind the preview.
      if screens.isEmpty { model.refreshStatus() }
    }
    .onChange(of: model.route) { _, route in
      if route == .settings {
        path = []
        model.refreshStatus()
        model.route = nil
      }
    }
  }
}

/// The app's name and what it does, stacked at accessibility text sizes.
struct AppHeader: View {
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(spacing: 14))
    layout {
      Image("PulpoSmiley")
        .resizable()
        .interpolation(.high)
        .frame(width: 52, height: 52)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text("Pulpo Keyboard").font(.title2.weight(.semibold))
        Text("Swipe typing, on-device autocorrect, and Pulpo dictation.")
          .font(.subheadline)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }
}

/// A switch with a one-line explanation under its title.
struct SettingToggle: View {
  let title: LocalizedStringKey
  let detail: LocalizedStringKey
  @Binding var isOn: Bool

  init(_ title: LocalizedStringKey, detail: LocalizedStringKey, isOn: Binding<Bool>) {
    self.title = title
    self.detail = detail
    _isOn = isOn
  }

  var body: some View {
    Toggle(isOn: $isOn) {
      Text(title)
      Text(detail)
    }
  }
}

struct SetupSection: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    Section {
      if model.setupComplete {
        Label {
          VStack(alignment: .leading, spacing: 2) {
            Text("Ready to Use")
            Text("Switch to Pulpo Keyboard with \u{1F310} in any app.")
              .font(.footnote)
              .foregroundStyle(.secondary)
          }
        } icon: {
          Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("setup-ready-row")
        Button("Setup Guide") { model.showSetupGuide = true }
          .accessibilityIdentifier("setup-guide")
      } else {
        SetupRow(title: "Add Pulpo Keyboard", status: model.addKeyboardStatus)
        SetupRow(title: "Allow Full Access", status: model.fullAccessStatus)
        SetupRow(title: "Switch to Pulpo Keyboard", status: model.switchStatus)
        Button {
          model.showSetupGuide = true
        } label: {
          Label("Continue Setup", systemImage: "list.number")
        }
        .accessibilityIdentifier("continue-setup")
        Button {
          model.openSystemSettings()
        } label: {
          Label("Open Settings", systemImage: "gear")
        }
        .accessibilityHint("Opens the Settings app. Keyboards is under Apps, Pulpo Keyboard.")
      }
    } header: {
      Text("Setup")
    } footer: {
      if !model.setupComplete {
        Text("In Settings, open Apps › Pulpo Keyboard › Keyboards, then turn on Pulpo Keyboard and Allow Full Access. When typing, touch and hold \u{1F310} to switch to it.")
      }
    }
  }
}

struct SetupRow: View {
  let title: String
  let status: StepStatus

  var body: some View {
    // Side by side while both fit on one line, otherwise the status goes underneath.
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) {
        Text(title).fixedSize()
        Spacer(minLength: 8)
        StatusBadge(status: status).fixedSize()
      }
      VStack(alignment: .leading, spacing: 4) {
        Text(title)
        StatusBadge(status: status)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(title)
    .accessibilityValue(status.label)
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
      Text(model.session == nil
        ? "Sign in to dictate. Dictation uses the same transcription as Pulpo and is billed to your Pulpo account. Typing doesn't need an account."
        : "Dictation uses the same transcription as Pulpo and is billed to your Pulpo account.")
    }
    .sheet(isPresented: $signingIn) { SignInView() }
  }
}
