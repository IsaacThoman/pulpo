import SwiftUI

final class AgentModeMenuModel: ObservableObject {
  @Published var selection = AgentModeSelection()
  @Published var available = false
  @Published var hint = ""
  /// The "Changes to Files" choice (Files on, not a temporary chat), and "Files Access…" (a saved chat).
  @Published var filesVisible = false
  @Published var fileChangeMode = "suggest"
  @Published var filesAccessVisible = false

  func select(_ enabled: Bool) -> AgentModeSelection? {
    guard available else { return nil }
    var next = selection
    guard next.select(enabled) else { return nil }
    selection = next
    return next
  }
}

enum AgentFilesAction: Equatable {
  case changeMode(String)
  case openAccess
}

struct AgentModeMenuContent: View {
  @ObservedObject var model: AgentModeMenuModel
  let onSelection: (AgentModeSelection) -> Void
  var onFilesAction: (AgentFilesAction) -> Void = { _ in }
  @Environment(\.colorScheme) private var colorScheme

  private var enabled: Bool { model.available && model.selection.enabled }
  private var purple: Color {
    colorScheme == .dark
      ? Color(red: 191 / 255, green: 90 / 255, blue: 242 / 255)
      : Color(red: 175 / 255, green: 82 / 255, blue: 222 / 255)
  }

  var body: some View {
    Menu {
      Picker("Agent", selection: Binding(
        get: { enabled },
        set: { value in
          // Update the checkmark, icon and fill in this native transaction,
          // before notifying JavaScript or rendering the chat screen again.
          if let selection = model.select(value) { onSelection(selection) }
        }
      )) {
        option("Pulpo Agent", asset: "LucideBot").tag(true)
        option("Disabled", asset: "LucideBotOff").tag(false)
      }
      .pickerStyle(.inline)
      .tint(.primary)
      if model.filesVisible {
        Section("Changes to Files") {
          Picker("Changes to Files", selection: Binding(
            get: { model.fileChangeMode },
            set: { mode in
              guard mode != model.fileChangeMode else { return }
              // Checked here at once; JavaScript saves it and confirms through the configuration.
              model.fileChangeMode = mode
              onFilesAction(.changeMode(mode))
            }
          )) {
            Label("Read only", systemImage: "eye").tag("read")
            Label("Suggest changes", systemImage: "text.badge.checkmark").tag("suggest")
            Label("Edit directly", systemImage: "pencil").tag("write")
          }
          .pickerStyle(.inline)
          .tint(.primary)
        }
        if model.filesAccessVisible {
          Button {
            onFilesAction(.openAccess)
          } label: {
            Label("Files Access…", systemImage: "folder")
          }
        }
      }
    } label: {
      Image(enabled ? "LucideBot" : "LucideBotOff")
        .resizable()
        .frame(width: 13, height: 13)
        .frame(width: 16, height: 16)
        .foregroundStyle(enabled ? Color.white : Color.primary)
        // iOS 27 defers changes to the Menu's glass tint until after dismissal.
        // Draw the selected fill with the icon so they return in the same state.
        .background {
          Circle()
            .fill(purple.opacity(enabled ? 1 : 0))
            .frame(width: 32, height: 32)
        }
        .transaction { transaction in
          transaction.animation = nil
          transaction.disablesAnimations = true
        }
        // Decorative: VoiceOver otherwise names the button after the asset ("LucideBotOff").
        .accessibilityHidden(true)
    }
    // The native style and view identity remain fixed across both states.
    .modifier(AgentModeButtonStyle())
    .buttonBorderShape(.circle)
    .controlSize(.regular)
    .menuOrder(.fixed)
    .disabled(!model.available)
    .accessibilityLabel("Agent options, \(enabled ? "Pulpo Agent" : "Disabled")")
    .accessibilityInputLabels(["Agent", "Agent options"])
    .accessibilityHint(model.hint)
    .frame(width: 44, height: 44)
  }

  private func option(_ title: String, asset: String) -> some View {
    Label {
      Text(title)
    } icon: {
      Image(asset).resizable().frame(width: 20, height: 20).foregroundStyle(.primary)
    }
  }
}

/// Liquid Glass on iOS 26. Earlier versions use the same gray fill as the
/// other composer buttons (see `glassButtonStyle` in src/platform/glass.ts).
private struct AgentModeButtonStyle: ViewModifier {
  func body(content: Content) -> some View {
    if #available(iOS 26.0, *) {
      content.buttonStyle(.glassProminent).tint(.clear)
    } else {
      content.buttonStyle(.borderedProminent).tint(Color(uiColor: .systemGray5))
    }
  }
}
