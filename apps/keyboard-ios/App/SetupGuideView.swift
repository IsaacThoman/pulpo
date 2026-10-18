import SwiftUI

/// Where one setup step stands. Each state has a word as well as a color and symbol.
enum StepStatus: Equatable {
  case done, toDo, unconfirmed, off

  var label: String {
    switch self {
    case .done: "Done"
    case .toDo: "To do"
    case .unconfirmed: "Not confirmed yet"
    case .off: "Off"
    }
  }

  var symbol: String {
    switch self {
    case .done: "checkmark.circle.fill"
    case .toDo: "circle"
    case .unconfirmed: "questionmark.circle.fill"
    case .off: "exclamationmark.circle.fill"
    }
  }

  var tint: Color {
    switch self {
    case .done: .green
    case .toDo: .secondary
    case .unconfirmed, .off: .orange
    }
  }
}

extension AppModel {
  var addKeyboardStatus: StepStatus { keyboardEnabled ? .done : .toDo }

  var fullAccessStatus: StepStatus {
    guard keyboardEnabled else { return .toDo }
    switch fullAccessState {
    case .on: return .done
    case .off: return .off
    case .unknown: return .unconfirmed
    }
  }

  var switchStatus: StepStatus { keyboardSeen ? .done : .toDo }
}

/// A status symbol with its word, for setup rows.
struct StatusBadge: View {
  let status: StepStatus

  var body: some View {
    // Not a Label: inside a List row, Labels get list icon alignment and separators.
    HStack(alignment: .firstTextBaseline, spacing: 6) {
      Image(systemName: status.symbol).foregroundStyle(status.tint)
      Text(status.label).foregroundStyle(.secondary)
    }
    .font(.subheadline.weight(.medium))
  }
}

/// First-launch setup: add the keyboard, allow Full Access, and switch to it, with
/// each step confirmed live. Reopened from the home screen and by the keyboard.
struct SetupGuideView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  @State private var text = ""
  @State private var showPrivacy = false
  @FocusState private var fieldFocused: Bool

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 16) {
          header
          notice
          StepCard(number: 1, title: "Add Pulpo Keyboard", status: model.addKeyboardStatus) {
            Text(model.keyboardEnabled
              ? "Pulpo Keyboard is in your keyboards."
              : "Tap Open Settings below, then Keyboards, and turn on Pulpo Keyboard. If Settings opens on its main page, go to Apps › Pulpo Keyboard › Keyboards.")
          }
          StepCard(number: 2, title: "Allow Full Access", status: model.fullAccessStatus) {
            Text(fullAccessDetail)
            Button {
              showPrivacy = true
            } label: {
              Text("What Full Access allows")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .accessibilityHint("Explains what Pulpo Keyboard does and doesn't send.")
            .accessibilityIdentifier("setup-privacy")
          }
          StepCard(number: 3, title: "Switch to Pulpo Keyboard", status: model.switchStatus) {
            Text(switchDetail)
            if model.keyboardEnabled {
              TextField("Tap here to try Pulpo Keyboard", text: $text, axis: .vertical)
                .lineLimit(2...4)
                .padding(12)
                .background(Color(.tertiarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 10))
                .focused($fieldFocused)
                .accessibilityIdentifier("setup-try-field")
            }
          }
          if model.setupComplete { ready }
        }
        .padding()
        .frame(maxWidth: 640)
        .frame(maxWidth: .infinity)
      }
      .scrollDismissesKeyboard(.interactively)
      .background(Color(.systemGroupedBackground))
      .safeAreaInset(edge: .bottom) { primaryAction }
      .navigationTitle("Setup")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          if !model.setupComplete {
            Button("Not Now") { dismiss() }
              .accessibilityIdentifier("setup-not-now")
          }
        }
      }
      .sheet(isPresented: $showPrivacy) {
        NavigationStack {
          PrivacyView()
            .toolbar {
              ToolbarItem(placement: .confirmationAction) {
                Button("Done") { showPrivacy = false }
              }
            }
        }
      }
      .onChange(of: model.setupComplete) { _, complete in
        guard complete else { return }
        AccessibilityNotification.Announcement("Pulpo Keyboard is set up").post()
      }
    }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 8) {
      Image("PulpoSmiley")
        .resizable()
        .interpolation(.high)
        .frame(width: 60, height: 60)
        .accessibilityHidden(true)
      Text("Set Up Pulpo Keyboard")
        .font(.largeTitle.bold())
        .accessibilityAddTraits(.isHeader)
      Text("Three steps, about a minute. Everything you type stays on this iPhone.")
        .foregroundStyle(.secondary)
    }
    .padding(.bottom, 4)
  }

  private var fullAccessDetail: String {
    switch model.fullAccessState {
    case .on:
      return "Full Access is on, so dictation, haptics, and the settings in this app work."
    case .off:
      return "Pulpo Keyboard is running without Full Access. In Settings › Apps › Pulpo Keyboard › Keyboards, turn on Allow Full Access."
    case .unknown where model.keyboardEnabled:
      return "In Settings › Apps › Pulpo Keyboard › Keyboards, turn on Allow Full Access. Switching to Pulpo Keyboard in step 3 confirms it's on."
    case .unknown:
      return "On the same Keyboards screen, turn on Allow Full Access and confirm. It's needed for dictation, haptics, and the settings in this app."
    }
  }

  /// Repeats a Full Access problem here, since the keyboard covers step 2 while it's up.
  private var switchDetail: String {
    if !model.keyboardSeen {
      return "Tap the box below, then touch and hold \u{1F310} at the bottom of the keyboard and choose Pulpo Keyboard."
    }
    if model.fullAccessState == .off {
      return "Pulpo Keyboard works, but Full Access is off. Turn it on in step 2 for dictation, haptics, and your settings."
    }
    return "Pulpo Keyboard has opened. Switch between keyboards any time with \u{1F310}."
  }

  /// What the person came back to from Settings, when it wasn't everything.
  /// The keyboard reporting no Full Access is shown whenever it's known.
  @ViewBuilder private var notice: some View {
    switch model.settingsReturn {
    case _ where model.keyboardEnabled && model.fullAccessState == .off:
      NoticeCard(symbol: "exclamationmark.triangle.fill", title: "Full Access is off",
                 detail: "Pulpo Keyboard types without it, but dictation, haptics, and your settings need it. Turn on Allow Full Access in Settings › Apps › Pulpo Keyboard › Keyboards.")
    case .keyboardMissing?:
      NoticeCard(symbol: "exclamationmark.triangle.fill", title: "Pulpo Keyboard isn't on yet",
                 detail: "In Settings, go to Apps › Pulpo Keyboard › Keyboards and turn on Pulpo Keyboard. General › Keyboard › Keyboards › Add New Keyboard works too.")
    case .fullAccessUnconfirmed? where !model.keyboardSeen:
      NoticeCard(symbol: "checkmark.circle.fill", title: "Pulpo Keyboard is added",
                 detail: "Now switch to it in step 3. That also confirms Full Access.")
    default:
      EmptyView()
    }
  }

  private var ready: some View {
    VStack(alignment: .leading, spacing: 12) {
      Label {
        Text("You're all set")
      } icon: {
        Image(systemName: "checkmark.seal.fill").foregroundStyle(.green)
      }
        .font(.title3.weight(.semibold))
        .accessibilityAddTraits(.isHeader)
      ForEach(KeyboardTip.highlights) { TipRow(tip: $0) }
      NavigationLink {
        TipsView()
      } label: {
        Text("All Tips & Gestures")
          .font(.body.weight(.semibold))
      }
      .accessibilityIdentifier("setup-all-tips")
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    .accessibilityIdentifier("setup-ready")
  }

  private var primaryAction: some View {
    VStack(spacing: 8) {
      if model.setupComplete {
        Button {
          dismiss()
        } label: {
          Text("Done").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("setup-done")
      } else {
        Button {
          fieldFocused = false
          model.openSystemSettings()
        } label: {
          Label("Open Settings", systemImage: "gear").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityHint("Opens the Settings app. Keyboards is under Apps, Pulpo Keyboard.")
        .accessibilityIdentifier("setup-open-settings")
      }
    }
    .controlSize(.large)
    .padding(.horizontal)
    .padding(.vertical, 10)
    .background(.bar)
  }
}

/// One numbered step: number, title, status, and what to do.
struct StepCard<Content: View>: View {
  let number: Int
  let title: String
  let status: StepStatus
  @ViewBuilder let content: Content
  @ScaledMetric(relativeTo: .headline) private var numberSize: CGFloat = 30
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10)) : AnyLayout(HStackLayout(alignment: .top, spacing: 14))
    layout {
      Text("\(number)")
        .font(.headline)
        .foregroundStyle(status == .done ? Color.white : Color.accentColor)
        .frame(width: numberSize, height: numberSize)
        .background(Circle().fill(status == .done ? Color.green : Color.accentColor.opacity(0.15)))
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 8) {
        VStack(alignment: .leading, spacing: 4) {
          Text(title)
            .font(.headline)
          StatusBadge(status: status)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(number) of 3: \(title)")
        .accessibilityValue(status.label)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("setup-step-\(number)")
        content
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding()
    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
  }
}

struct NoticeCard: View {
  let symbol: String
  let title: String
  let detail: String

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Label(title, systemImage: symbol)
        .font(.headline)
        .symbolRenderingMode(.multicolor)
      // Primary text: secondary gray loses contrast on the tinted background.
      Text(detail)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding()
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("setup-notice")
  }
}
