import SwiftUI

/// A place to type with Pulpo Keyboard. The in-app preview runs the same keyboard
/// inside this app, which works before it's enabled in Settings.
struct TryItView: View {
  @Environment(AppModel.self) private var model
  @State private var text = ""
  @State private var usePreview = !ProcessInfo.processInfo.arguments.contains("-PKSystemKeyboard")
  @State private var field = FieldKind.text
  @State private var showTips = false
  @FocusState private var systemFocused: Bool

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
    VStack(alignment: .leading, spacing: 12) {
      Picker("Keyboard", selection: $usePreview) {
        Text("In-App Preview").tag(true)
        Text("Installed Keyboard").tag(false)
      }
      .pickerStyle(.segmented)
      .accessibilityIdentifier("keyboard-mode")

      Picker("Field", selection: $field) {
        ForEach(FieldKind.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      .accessibilityIdentifier("field-kind")

      if usePreview {
        PreviewTextView(text: $text, focused: true, keyboardType: field.keyboardType) { model.handle($0) }
          .frame(minHeight: 140, maxHeight: 220)
      } else {
        TextField("Type here", text: $text, axis: .vertical)
          .keyboardType(field.keyboardType)
          .textInputAutocapitalization(field == .text ? .sentences : .never)
          .autocorrectionDisabled(field != .text)
          .lineLimit(5...8)
          .padding(12)
          .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 12))
          .focused($systemFocused)
          .accessibilityIdentifier("system-text")
          .onAppear { systemFocused = true }
        if model.keyboardEnabled {
          Text("If another keyboard shows up, touch and hold \u{1F310} and choose Pulpo Keyboard.")
            .font(.footnote)
            .foregroundStyle(.secondary)
        } else {
          VStack(alignment: .leading, spacing: 6) {
            Text("Pulpo Keyboard isn't turned on yet. The In-App Preview works without it.")
              .font(.footnote)
              .foregroundStyle(.secondary)
            Button("Continue Setup") { model.showSetupGuide = true }
              .font(.footnote.weight(.semibold))
              .accessibilityIdentifier("try-it-setup")
          }
        }
      }
      Spacer(minLength: 0)
    }
    .padding()
    .background(Color(.systemGroupedBackground))
    .navigationTitle("Try It")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItemGroup(placement: .topBarTrailing) {
        Button {
          showTips = true
        } label: {
          Label("Tips", systemImage: "lightbulb")
        }
        .accessibilityIdentifier("try-it-tips")
        Button("Clear") { text = "" }
          .disabled(text.isEmpty)
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
