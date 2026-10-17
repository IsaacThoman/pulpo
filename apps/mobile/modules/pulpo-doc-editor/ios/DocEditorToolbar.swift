import SwiftUI
import UIKit

/** What the formatting bar shows; JavaScript sets it from what the editor reports. */
final class DocEditorToolbarModel: ObservableObject {
  @Published var active: Set<String> = []
  @Published var disabled: Set<String> = []
  @Published var tint: Color = .accentColor
}

private struct ToolbarButton: View {
  let command: String
  let label: String
  let systemImage: String
  @ObservedObject var model: DocEditorToolbarModel
  let action: (String) -> Void

  var body: some View {
    let active = model.active.contains(command)
    Button {
      UISelectionFeedbackGenerator().selectionChanged()
      action(command)
    } label: {
      Image(systemName: systemImage)
        .font(.system(size: 17, weight: .medium))
        .frame(width: 40, height: 36)
        .foregroundStyle(active ? model.tint : Color.primary)
        .background(active ? model.tint.opacity(0.16) : Color.clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .contentShape(Rectangle())
    }
    .buttonStyle(.plain)
    .disabled(model.disabled.contains(command))
    .opacity(model.disabled.contains(command) ? 0.35 : 1)
    .accessibilityLabel(label)
    .accessibilityAddTraits(active ? .isSelected : [])
    .accessibilityIdentifier("doc-toolbar-\(command)")
  }
}

private struct MenuOption: Identifiable {
  let command: String
  let label: String
  let systemImage: String
  var id: String { command }
}

private struct ToolbarMenu: View {
  let label: String
  let systemImage: String
  let identifier: String
  let options: [MenuOption]
  @ObservedObject var model: DocEditorToolbarModel
  let action: (String) -> Void

  var body: some View {
    // Body text is the default, not a format worth highlighting.
    let active = options.contains { $0.command != "paragraph" && model.active.contains($0.command) }
    Menu {
      ForEach(options) { option in
        Button {
          action(option.command)
        } label: {
          if model.active.contains(option.command) {
            Label(option.label, systemImage: "checkmark")
          } else {
            Label(option.label, systemImage: option.systemImage)
          }
        }
        .disabled(model.disabled.contains(option.command))
      }
    } label: {
      Image(systemName: systemImage)
        .font(.system(size: 17, weight: .medium))
        .frame(width: 40, height: 36)
        .foregroundStyle(active ? model.tint : Color.primary)
        .background(active ? model.tint.opacity(0.16) : Color.clear, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .contentShape(Rectangle())
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .accessibilityLabel(label)
    .accessibilityIdentifier("doc-toolbar-\(identifier)")
  }
}

private struct ToolbarSeparator: View {
  var body: some View {
    Rectangle().fill(Color.secondary.opacity(0.25)).frame(width: 1, height: 22).padding(.horizontal, 3)
  }
}

struct DocEditorToolbar: View {
  @ObservedObject var model: DocEditorToolbarModel
  let action: (String) -> Void

  var body: some View {
    HStack(spacing: 0) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 2) {
          ToolbarButton(command: "undo", label: "Undo", systemImage: "arrow.uturn.backward", model: model, action: action)
          ToolbarButton(command: "redo", label: "Redo", systemImage: "arrow.uturn.forward", model: model, action: action)
          ToolbarSeparator()
          ToolbarMenu(label: "Text style", systemImage: "textformat.size", identifier: "text-style", options: [
            MenuOption(command: "paragraph", label: "Body", systemImage: "text.alignleft"),
            MenuOption(command: "heading1", label: "Heading 1", systemImage: "textformat.size.larger"),
            MenuOption(command: "heading2", label: "Heading 2", systemImage: "textformat.size"),
            MenuOption(command: "heading3", label: "Heading 3", systemImage: "textformat.size.smaller"),
          ], model: model, action: action)
          ToolbarButton(command: "bold", label: "Bold", systemImage: "bold", model: model, action: action)
          ToolbarButton(command: "italic", label: "Italic", systemImage: "italic", model: model, action: action)
          ToolbarButton(command: "strike", label: "Strikethrough", systemImage: "strikethrough", model: model, action: action)
          ToolbarButton(command: "code", label: "Inline code", systemImage: "chevron.left.forwardslash.chevron.right", model: model, action: action)
          ToolbarButton(command: "link", label: "Link", systemImage: "link", model: model, action: action)
          ToolbarSeparator()
          ToolbarMenu(label: "Lists", systemImage: "list.bullet", identifier: "lists", options: [
            MenuOption(command: "bulletList", label: "Bulleted list", systemImage: "list.bullet"),
            MenuOption(command: "orderedList", label: "Numbered list", systemImage: "list.number"),
            MenuOption(command: "taskList", label: "Checklist", systemImage: "checklist"),
          ], model: model, action: action)
          ToolbarButton(command: "outdent", label: "Outdent", systemImage: "decrease.indent", model: model, action: action)
          ToolbarButton(command: "indent", label: "Indent", systemImage: "increase.indent", model: model, action: action)
          ToolbarSeparator()
          ToolbarButton(command: "blockquote", label: "Quote", systemImage: "text.quote", model: model, action: action)
          ToolbarButton(command: "codeBlock", label: "Code block", systemImage: "curlybraces.square", model: model, action: action)
          ToolbarButton(command: "table", label: "Table", systemImage: "tablecells", model: model, action: action)
          ToolbarButton(command: "divider", label: "Divider", systemImage: "minus", model: model, action: action)
        }
        .padding(.horizontal, 8)
      }
      ToolbarSeparator()
      Button {
        action("dismissKeyboard")
      } label: {
        Image(systemName: "keyboard.chevron.compact.down")
          .font(.system(size: 17, weight: .medium))
          .frame(width: 44, height: 36)
          .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Hide keyboard")
      .accessibilityIdentifier("doc-toolbar-dismiss")
      .padding(.trailing, 6)
    }
    .frame(height: 48)
    .tint(model.tint)
  }
}

/** The formatting bar as the keyboard's accessory: keyboard-colored, full width, 48 points tall. */
final class DocEditorAccessoryView: UIInputView {
  private let host: UIHostingController<DocEditorToolbar>

  init(model: DocEditorToolbarModel, action: @escaping (String) -> Void) {
    host = UIHostingController(rootView: DocEditorToolbar(model: model, action: action))
    super.init(frame: CGRect(x: 0, y: 0, width: UIScreen.main.bounds.width, height: 48), inputViewStyle: .keyboard)
    allowsSelfSizing = true
    autoresizingMask = [.flexibleWidth]
    host.view.backgroundColor = .clear
    host.view.translatesAutoresizingMaskIntoConstraints = false
    host.safeAreaRegions = []
    addSubview(host.view)
    NSLayoutConstraint.activate([
      host.view.leadingAnchor.constraint(equalTo: leadingAnchor),
      host.view.trailingAnchor.constraint(equalTo: trailingAnchor),
      host.view.topAnchor.constraint(equalTo: topAnchor),
      host.view.bottomAnchor.constraint(equalTo: bottomAnchor),
      host.view.heightAnchor.constraint(equalToConstant: 48),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: 48)
  }
}
