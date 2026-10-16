import KeyboardUI
import SwiftUI
import UIKit

/// Lets a text view in the app use Pulpo Keyboard as its input view, so the
/// keyboard can be tried (and UI-tested) before it is enabled in Settings.
final class PreviewHost: KeyboardHost {
  weak var textView: UITextView?
  private var openURL: ((URL) -> Void)?
  private lazy var textDocument = TextViewDocument(host: self)

  init(textView: UITextView, openURL: @escaping (URL) -> Void) {
    self.textView = textView
    self.openURL = openURL
  }

  var document: TextDocument { textDocument }
  var inputTraits: InputTraits { textView.map { InputTraits($0) } ?? InputTraits() }
  var needsInputModeSwitchKey: Bool { false }
  var hasFullAccess: Bool { true }
  var isInsideApp: Bool { true }
  func advanceToNextInputMode() {}
  func handleInputModeList(from view: UIView, with event: UIEvent) {}

  func adjustTextPosition(byCharacterOffset offset: Int) {
    guard let textView, let range = textView.selectedTextRange,
          let position = textView.position(from: range.start, offset: offset) else { return }
    textView.selectedTextRange = textView.textRange(from: position, to: position)
  }

  func openApp(_ url: URL) {
    guard textView?.window != nil else { return }
    openURL?(url)
  }

  func invalidate() {
    textView = nil
    openURL = nil
  }
}

final class TextViewDocument: TextDocument {
  unowned let host: PreviewHost

  init(host: PreviewHost) {
    self.host = host
  }

  private var textView: UITextView? { host.textView }

  var documentContextBeforeInput: String? {
    guard let textView, let range = textView.selectedTextRange else { return nil }
    return textView.text(in: textView.textRange(from: textView.beginningOfDocument, to: range.start)!)
  }

  var documentContextAfterInput: String? {
    guard let textView, let range = textView.selectedTextRange else { return nil }
    return textView.text(in: textView.textRange(from: range.end, to: textView.endOfDocument)!)
  }

  var selectedText: String? {
    guard let textView, let range = textView.selectedTextRange, !range.isEmpty else { return nil }
    return textView.text(in: range)
  }

  var hasText: Bool { textView?.hasText ?? false }
  func insertText(_ text: String) { textView?.insertText(text) }
  func deleteBackward() { textView?.deleteBackward() }
}

/// One editor keeps the same UTF-16 selection with either keyboard input view.
struct PreviewTextView: UIViewRepresentable {
  @Binding var text: String
  @Binding var selection: NSRange
  @Binding var focused: Bool
  var keyboardType: UIKeyboardType = .default
  var usePreview = true
  let openURL: (URL) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> UITextView {
    let textView = UITextView()
    textView.font = .preferredFont(forTextStyle: .body)
    textView.backgroundColor = .secondarySystemGroupedBackground
    textView.layer.cornerRadius = 12
    textView.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
    textView.delegate = context.coordinator
    context.coordinator.textView = textView
    return textView
  }

  func updateUIView(_ textView: UITextView, context: Context) {
    // SwiftUI recreates the representable as text and focus change. Delegates
    // must write through the current bindings, including after dismissal.
    context.coordinator.parent = self
    let coordinator = context.coordinator
    // Assigning text may synchronously notify selection delegates. Those
    // intermediate ranges must not replace the range we are restoring.
    coordinator.restoring = true
    defer { coordinator.restoring = false }
    let traitsChanged = textView.keyboardType != keyboardType
    var documentChanged = traitsChanged
    if traitsChanged {
      textView.keyboardType = keyboardType
    }
    textView.autocapitalizationType = keyboardType == .default ? .sentences : .none
    textView.autocorrectionType = keyboardType == .default ? .default : .no
    if textView.text != text {
      textView.text = text
      documentChanged = true
    }
    let length = (text as NSString).length
    let start = min(max(0, selection.location), length)
    let range = NSRange(location: start, length: min(max(0, selection.length), length - start))
    if textView.selectedRange != range {
      textView.selectedRange = range
      documentChanged = true
    }
    textView.accessibilityIdentifier = usePreview ? "preview-text" : "system-text"
    textView.accessibilityLabel = "Type here"
    if usePreview, coordinator.controller == nil {
      let host = PreviewHost(textView: textView) { [weak coordinator] url in
        guard let coordinator, coordinator.active, coordinator.parent.usePreview,
              coordinator.textView?.window != nil else { return }
        coordinator.parent.openURL(url)
      }
      let controller = KeyboardController(host: host)
      coordinator.host = host
      coordinator.controller = controller
      textView.inputView = PreviewInputView(controller: controller)
      if textView.isFirstResponder { controller.hostWillAppear() }
      textView.reloadInputViews()
      documentChanged = true
    } else if !usePreview, coordinator.controller != nil {
      coordinator.removeKeyboard()
      textView.inputView = nil
      textView.reloadInputViews()
    } else if traitsChanged, textView.isFirstResponder {
      textView.reloadInputViews()
    }
    if documentChanged { coordinator.controller?.documentDidChange() }
    if focused, !textView.isFirstResponder {
      DispatchQueue.main.async { [weak textView, weak coordinator] in
        guard let coordinator, coordinator.active, coordinator.parent.focused,
              textView?.window != nil else { return }
        textView?.becomeFirstResponder()
      }
    } else if !focused, textView.isFirstResponder {
      textView.resignFirstResponder()
    }
  }

  static func dismantleUIView(_ textView: UITextView, coordinator: Coordinator) {
    // Invalidate before resigning/removing: UIKit and queued controller work
    // must not publish into a replacement editor's shared draft or focus.
    coordinator.active = false
    textView.delegate = nil
    coordinator.removeKeyboard()
    textView.resignFirstResponder()
    textView.inputView = nil
  }

  final class Coordinator: NSObject, UITextViewDelegate {
    var parent: PreviewTextView
    weak var textView: UITextView?
    var host: PreviewHost?
    var controller: KeyboardController?
    var active = true
    var restoring = false

    init(_ parent: PreviewTextView) {
      self.parent = parent
    }

    private func owns(_ textView: UITextView) -> Bool {
      active && self.textView === textView && textView.window != nil
    }

    func textViewDidBeginEditing(_ textView: UITextView) {
      guard owns(textView) else { return }
      if !restoring, !parent.focused { parent.focused = true }
      controller?.hostWillAppear()
    }

    func textViewDidEndEditing(_ textView: UITextView) {
      guard owns(textView) else { return }
      if !restoring, parent.focused { parent.focused = false }
      controller?.hostDidDisappear()
    }

    func textViewDidChange(_ textView: UITextView) {
      guard owns(textView), !restoring else { return }
      parent.text = textView.text
      parent.selection = textView.selectedRange
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      guard owns(textView), !restoring else { return }
      parent.selection = textView.selectedRange
      // Deferred so the keyboard's own multi-step edits finish first, as with the
      // asynchronous text proxy in the extension.
      DispatchQueue.main.async { [weak self] in
        guard let self, let textView = self.textView, self.owns(textView) else { return }
        self.controller?.documentDidChange()
      }
    }

    func removeKeyboard() {
      controller?.hostDidDisappear()
      host?.invalidate()
      controller = nil
      host = nil
    }
  }
}

/// Hosts the keyboard's root view as a text view's input view, at the keyboard's height
/// plus the home indicator area, which the system keyboard fills with its own bezel.
final class PreviewInputView: UIInputView, UIInputViewAudioFeedback {
  let controller: KeyboardController
  var enableInputClicksWhenVisible: Bool { true }

  /// The keyboard window reports no safe area, so this reads the app window's.
  static var bottomInset: CGFloat {
    let windows = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.windows }.joined()
    return windows.map(\.safeAreaInsets.bottom).max() ?? 0
  }

  init(controller: KeyboardController) {
    self.controller = controller
    super.init(frame: CGRect(x: 0, y: 0, width: 0, height: controller.preferredHeight + Self.bottomInset), inputViewStyle: .keyboard)
    allowsSelfSizing = true
    controller.rootView.paintsBackground = true
    addSubview(controller.rootView)
    controller.onHeightChange = { [weak self] _ in self?.invalidateIntrinsicContentSize() }
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override var intrinsicContentSize: CGSize {
    CGSize(width: UIView.noIntrinsicMetric, height: controller.preferredHeight + Self.bottomInset)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    backgroundColor = controller.rootView.backgroundColor
    // The caps and panels keep their normal height; the keys also receive
    // touches in the preview host's extra bottom bezel.
    let root = controller.rootView
    root.frame = CGRect(x: 0, y: 0, width: bounds.width, height: min(bounds.height, controller.preferredHeight))
    root.bottomTouchPadding = max(0, bounds.height - root.frame.maxY)
    controller.layoutChanged(dark: traitCollection.userInterfaceStyle == .dark)
  }
}
