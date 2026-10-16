import KeyboardUI
import SwiftUI
import UIKit

/// Lets a text view in the app use Pulpo Keyboard as its input view, so the
/// keyboard can be tried (and UI-tested) before it is enabled in Settings.
final class PreviewHost: KeyboardHost {
  weak var textView: UITextView?
  let openURL: (URL) -> Void
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

  func openApp(_ url: URL) { openURL(url) }
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

/// A text view that types with the in-app keyboard.
struct PreviewTextView: UIViewRepresentable {
  @Binding var text: String
  var focused: Bool
  var keyboardType: UIKeyboardType = .default
  let openURL: (URL) -> Void

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> UITextView {
    let textView = UITextView()
    textView.font = .preferredFont(forTextStyle: .body)
    textView.backgroundColor = .secondarySystemGroupedBackground
    textView.layer.cornerRadius = 12
    textView.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
    textView.accessibilityIdentifier = "preview-text"
    textView.delegate = context.coordinator
    let host = PreviewHost(textView: textView, openURL: openURL)
    let controller = KeyboardController(host: host)
    let input = PreviewInputView(controller: controller)
    textView.inputView = input
    context.coordinator.host = host
    context.coordinator.controller = controller
    controller.hostWillAppear()
    return textView
  }

  func updateUIView(_ textView: UITextView, context: Context) {
    if textView.keyboardType != keyboardType {
      textView.keyboardType = keyboardType
      textView.autocapitalizationType = keyboardType == .default ? .sentences : .none
      textView.autocorrectionType = keyboardType == .default ? .default : .no
      context.coordinator.controller?.documentDidChange()
    }
    if textView.text != text {
      textView.text = text
      context.coordinator.controller?.documentDidChange()
    }
    if focused, !textView.isFirstResponder {
      DispatchQueue.main.async { textView.becomeFirstResponder() }
    }
  }

  final class Coordinator: NSObject, UITextViewDelegate {
    var parent: PreviewTextView
    var host: PreviewHost?
    var controller: KeyboardController?

    init(_ parent: PreviewTextView) {
      self.parent = parent
    }

    func textViewDidChange(_ textView: UITextView) {
      parent.text = textView.text
    }

    func textViewDidChangeSelection(_ textView: UITextView) {
      // Deferred so the keyboard's own multi-step edits finish first, as with the
      // asynchronous text proxy in the extension.
      DispatchQueue.main.async { [weak self] in self?.controller?.documentDidChange() }
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
