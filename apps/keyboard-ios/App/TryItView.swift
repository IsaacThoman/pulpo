import SwiftUI

struct TryItDraft {
  var text = ""
  // UITextView ranges use UTF-16 offsets, including emoji and combining marks.
  var selection = NSRange(location: 0, length: 0)
  var usePreview = !ProcessInfo.processInfo.arguments.contains("-PKSystemKeyboard")
  var field = TryItView.FieldKind.text

  mutating func clear() {
    text = ""
    selection = NSRange(location: 0, length: 0)
  }
}

/// A place to type with Pulpo Keyboard. The in-app preview runs the same keyboard
/// inside this app, which works before it's enabled in Settings.
struct TryItView: View {
  @Environment(AppModel.self) private var model
  @Binding var draft: TryItDraft
  // Keyboard visibility is user intent, independent of restoring a draft.
  @Binding var focused: Bool
  @State private var showTips = false

  /// Field types to try the keyboard's layouts with.
  enum FieldKind: String, CaseIterable, Identifiable {
    case text = "Text", email = "Email", url = "Web", number = "Number", phone = "Phone"

    var id: String { rawValue }

    var keyboardType: UIKeyboardType {
      switch self {
      case .text: .default
      case .email: .emailAddress
      case .url: .URL
      case .number: .numberPad
      case .phone: .phonePad
      }
    }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 12) {
        Picker("Keyboard", selection: $draft.usePreview) {
          Text("In-App Preview").tag(true)
          Text("Installed Keyboard").tag(false)
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("keyboard-mode")

        Picker("Field", selection: $draft.field) {
          ForEach(FieldKind.allCases) { Text($0.rawValue).tag($0) }
        }
        .pickerStyle(.segmented)
        .accessibilityIdentifier("field-kind")

        PreviewTextView(text: $draft.text, selection: $draft.selection, focused: $focused,
          keyboardType: draft.field.keyboardType, usePreview: draft.usePreview) { model.handle($0) }
          .frame(minHeight: 140, maxHeight: 220)
        if !draft.usePreview {
          if model.keyboardEnabled {
            Text("If another keyboard shows up, touch and hold \u{1F310} and choose Pulpo Keyboard.")
              .font(.footnote)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          } else {
            VStack(alignment: .leading, spacing: 6) {
              Text("Pulpo Keyboard isn't turned on yet. The In-App Preview works without it.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
              Button {
                model.showSetupGuide = true
              } label: {
                Text("Continue Setup")
                  .font(.footnote.weight(.semibold))
                  .frame(minHeight: 44)
                  .contentShape(Rectangle())
              }
              .accessibilityIdentifier("try-it-setup")
            }
          }
        }
      }
      .padding()
    }
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Try It")
    .navigationBarTitleDisplayMode(.inline)
    .onDisappear { focused = false }
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Button {
          focused = false
        } label: {
          Label("Hide Keyboard", systemImage: "keyboard.chevron.compact.down")
        }
        .accessibilityIdentifier("hide-keyboard")
        .disabled(!focused)
        Button {
          showTips = true
        } label: {
          Label("Tips", systemImage: "lightbulb")
        }
        .accessibilityIdentifier("try-it-tips")
        Button("Clear") { draft.clear() }
          .disabled(draft.text.isEmpty)
      }
    }
    .sheet(isPresented: $showTips) {
      NavigationStack {
        TipsView()
          .toolbar {
            ToolbarItem(placement: .confirmationAction) {
              Button("Done") { showTips = false }
            }
          }
      }
      .presentationDetents([.medium, .large])
    }
  }
}
