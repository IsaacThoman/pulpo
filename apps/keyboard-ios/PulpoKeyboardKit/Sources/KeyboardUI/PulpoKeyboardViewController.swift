#if os(iOS)
import UIKit

/// The input view adopts audio feedback so `playInputClick()` follows the person's
/// Keyboard Clicks setting.
final class KeyboardInputView: UIInputView, UIInputViewAudioFeedback {
  var enableInputClicksWhenVisible: Bool { true }
}

/// The keyboard extension's principal class. The extension target subclasses it so
/// `NSExtensionPrincipalClass` resolves inside the extension module.
open class PulpoKeyboardViewController: UIInputViewController, KeyboardHost {
  private var controller: KeyboardController?
  private var proxyDocument: ProxyDocument?
  private var heightConstraint: NSLayoutConstraint?

  open override func loadView() {
    let input = KeyboardInputView(frame: .zero, inputViewStyle: .keyboard)
    input.allowsSelfSizing = true
    inputView = input
  }

  open override func viewDidLoad() {
    super.viewDidLoad()
    proxyDocument = ProxyDocument(proxy: textDocumentProxy)
    let controller = KeyboardController(host: self)
    self.controller = controller
    let root = controller.rootView
    root.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(root)
    let height = view.heightAnchor.constraint(equalToConstant: controller.preferredHeight)
    height.priority = UILayoutPriority(999)
    NSLayoutConstraint.activate([
      root.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      root.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      root.topAnchor.constraint(equalTo: view.topAnchor),
      root.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      height,
    ])
    heightConstraint = height
    controller.onHeightChange = { [weak self] value in
      guard let constraint = self?.heightConstraint, constraint.constant != value else { return }
      constraint.constant = value
    }
    // The lexicon arrives on a background queue.
    requestSupplementaryLexicon { @Sendable [weak self] lexicon in
      let entries = lexicon.entries.map { (userInput: $0.userInput, documentText: $0.documentText) }
      DispatchQueue.main.async { self?.controller?.applySupplementaryLexicon(entries) }
    }
  }

  open override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    controller?.hostWillAppear()
  }

  open override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    controller?.layoutChanged(dark: traitCollection.userInterfaceStyle == .dark)
    removeSystemTouchDelays()
  }

  open override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    removeSystemTouchDelays()
  }

  /// The system's edge-gesture recognizers hold back touches near the screen edges
  /// (q, a, z, p, l, shift, delete, the bottom row) until they rule out a system swipe,
  /// which makes fast typing lag and drop keys. Keys must get touches immediately.
  private func removeSystemTouchDelays() {
    var current: UIView? = view
    while let view = current {
      view.gestureRecognizers?.forEach { $0.delaysTouchesBegan = false }
      current = view.superview
    }
    view.window?.gestureRecognizers?.forEach { $0.delaysTouchesBegan = false }
  }

  open override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    controller?.hostDidDisappear()
  }

  open override func textDidChange(_ textInput: UITextInput?) {
    super.textDidChange(textInput)
    controller?.documentDidChange()
  }

  open override func selectionDidChange(_ textInput: UITextInput?) {
    super.selectionDidChange(textInput)
    controller?.documentDidChange()
  }

  open override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    controller?.layoutChanged(dark: traitCollection.userInterfaceStyle == .dark)
  }

  // MARK: KeyboardHost

  public var document: TextDocument { proxyDocument ?? ProxyDocument(proxy: textDocumentProxy) }
  public var inputTraits: InputTraits { InputTraits(textDocumentProxy) }
  public var isInsideApp: Bool { false }

  /// Private and gone since iOS 26.4; only read when the object still answers to it.
  public var hostBundleIdentifier: String? {
    for object in [parent as NSObject?, self as NSObject?].compactMap({ $0 }) {
      for key in ["_hostBundleID", "_hostApplicationBundleIdentifier"] where object.responds(to: NSSelectorFromString(key)) {
        if let value = object.value(forKey: key) as? String, !value.isEmpty { return value }
      }
    }
    return nil
  }

  public func adjustTextPosition(byCharacterOffset offset: Int) {
    textDocumentProxy.adjustTextPosition(byCharacterOffset: offset)
  }

  /// Keyboard extensions have no supported way to open their app, so this walks the
  /// responder chain to the hosting `UIApplication` and calls `open(_:options:completionHandler:)`
  /// through the runtime, the approach other dictation keyboards ship.
  public func openApp(_ url: URL) {
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    var responder: UIResponder? = self
    while let current = responder {
      if NSStringFromClass(type(of: current)).contains("Application"), current.responds(to: selector) {
        typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
        let function = unsafeBitCast(current.method(for: selector), to: OpenURL.self)
        function(current, selector, url as NSURL, NSDictionary(), nil)
        return
      }
      responder = current.next
    }
    extensionContext?.open(url, completionHandler: nil)
  }
}
#endif
