import SafariServices
import UIKit
import WebKit

/*
 * Untrusted HTML attachments render here instead of Quick Look, which never runs scripts. The page gets an
 * ephemeral data store and no script message handlers. Its origin is opaque because the scheme handler serves
 * it with the sandbox CSP; WebKit honours the `sandbox` directive only as a response header, not in a <meta>.
 */

let maxWebPreviewBytes = 10 * 1024 * 1024
private let webPreviewScheme = "pulpo-preview"
private let maxSourceCharacters = 200_000

// Laid out at the device width like the web preview's iframe. Inserted before the page parses, so the page's
// own viewport tag, processed later, still wins.
private let viewportFallbackScript = """
var meta = document.createElement('meta');
meta.name = 'viewport';
meta.content = 'width=device-width, initial-scale=1';
document.documentElement.prepend(meta);
"""

private final class PulpoWebPreviewSchemeHandler: NSObject, WKURLSchemeHandler {
  // A fresh host per preview keeps documents from ever addressing each other.
  let host = UUID().uuidString.lowercased()
  private let document: Data
  private let contentSecurityPolicy: String

  init(document: Data, contentSecurityPolicy: String) {
    self.document = document
    self.contentSecurityPolicy = contentSecurityPolicy
  }

  var documentURL: URL { URL(string: "\(webPreviewScheme)://\(host)/")! }

  func isDocument(_ url: URL) -> Bool {
    url.scheme == webPreviewScheme && url.host == host && (url.path.isEmpty || url.path == "/")
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      urlSchemeTask.didFailWithError(URLError(.badURL))
      return
    }
    // Relative resources aren't part of the attachment, so only the document itself is served.
    let found = isDocument(url)
    let headers = [
      "Cache-Control": "no-store",
      "Content-Security-Policy": contentSecurityPolicy,
      "Content-Type": found ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    ]
    guard let response = HTTPURLResponse(
      url: url,
      statusCode: found ? 200 : 404,
      httpVersion: "HTTP/1.1",
      headerFields: headers
    ) else {
      urlSchemeTask.didFailWithError(URLError(.cannotParseResponse))
      return
    }
    urlSchemeTask.didReceive(response)
    if found { urlSchemeTask.didReceive(document) }
    urlSchemeTask.didFinish()
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

private final class PulpoWebPreviewSourceViewController: UIViewController {
  private let source: String

  init(source: String) {
    self.source = source
    super.init(nibName: nil, bundle: nil)
    title = "Source"
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  override func loadView() {
    let textView = UITextView()
    textView.isEditable = false
    textView.dataDetectorTypes = []
    textView.alwaysBounceVertical = true
    textView.font = .monospacedSystemFont(ofSize: 12, weight: .regular)
    textView.textContainerInset = UIEdgeInsets(top: 16, left: 12, bottom: 24, right: 12)
    textView.accessibilityIdentifier = "pulpo-web-preview-source"
    textView.text = source.count > maxSourceCharacters
      ? String(source.prefix(maxSourceCharacters)) + "\n\n…"
      : source
    view = textView
  }
}

final class PulpoWebPreviewViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
  var onDismiss: (() -> Void)?
  private let fileURL: URL
  private let source: String
  private let schemeHandler: PulpoWebPreviewSchemeHandler
  private lazy var webView = makeWebView()
  private var dialogCount = 0
  private var dialogsBlocked = false
  // WebKit requires every dialog completion handler to run exactly once, even if the preview closes first.
  private var finishPendingDialog: (() -> Void)?
  private var restartedAfterCrash = false
  private var dismissed = false

  init(document: Data, fileURL: URL, title: String, contentSecurityPolicy: String) {
    self.fileURL = fileURL
    source = String(decoding: document, as: UTF8.self)
    schemeHandler = PulpoWebPreviewSchemeHandler(document: document, contentSecurityPolicy: contentSecurityPolicy)
    super.init(nibName: nil, bundle: nil)
    self.title = title
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { nil }

  override func loadView() {
    view = UIView()
    view.backgroundColor = .systemBackground
    webView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(webView)
    // Below the navigation bar, but painted to the bottom edge behind the home indicator.
    NSLayoutConstraint.activate([
      webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .done,
      target: self,
      action: #selector(close)
    )
    let more = UIBarButtonItem(image: UIImage(systemName: "ellipsis.circle"), menu: nil)
    more.accessibilityLabel = "More"
    more.menu = UIMenu(children: [
      UIAction(title: "Share…", image: UIImage(systemName: "square.and.arrow.up")) { [weak self, weak more] _ in
        self?.share(from: more)
      },
      UIAction(title: "View Source", image: UIImage(systemName: "chevron.left.forwardslash.chevron.right")) { [weak self] _ in
        guard let self else { return }
        self.navigationController?.pushViewController(PulpoWebPreviewSourceViewController(source: self.source), animated: true)
      },
      UIAction(title: "Reload", image: UIImage(systemName: "arrow.clockwise")) { [weak self] _ in
        self?.reload()
      },
    ])
    navigationItem.rightBarButtonItem = more
    webView.load(URLRequest(url: schemeHandler.documentURL))
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if navigationController?.isBeingDismissed == true || isBeingDismissed { finishDismissal() }
  }

  private func makeWebView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: webPreviewScheme)
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.allowsInlineMediaPlayback = true
    configuration.mediaTypesRequiringUserActionForPlayback = .all
    configuration.dataDetectorTypes = []
    configuration.userContentController.addUserScript(WKUserScript(
      source: viewportFallbackScript,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: true,
      in: .defaultClient
    ))

    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsLinkPreview = false
    webView.allowsBackForwardNavigationGestures = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    webView.accessibilityIdentifier = "pulpo-web-preview"
    #if DEBUG
    webView.isInspectable = true
    #endif
    return webView
  }

  private func reload() {
    finishPendingDialog?()
    contentUnavailableConfiguration = nil
    webView.isHidden = false
    webView.load(URLRequest(url: schemeHandler.documentURL))
  }

  private func share(from item: UIBarButtonItem?) {
    guard presentedViewController == nil else { return }
    let controller = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
    controller.popoverPresentationController?.barButtonItem = item
    present(controller, animated: true)
  }

  private func openExternally(_ url: URL) {
    guard
      let scheme = url.scheme?.lowercased(),
      scheme == "https" || scheme == "http",
      url.host?.isEmpty == false,
      url.user == nil,
      url.password == nil,
      presentedViewController == nil
    else { return }
    let safari = SFSafariViewController(url: url)
    safari.dismissButtonStyle = .close
    present(safari, animated: true)
  }

  private func presentDialog(
    message: String,
    cancellable: Bool,
    defaultText: String? = nil,
    textField: Bool = false,
    completion: @escaping (_ accepted: Bool, _ text: String?) -> Void
  ) {
    guard !dialogsBlocked, !dismissed, viewIfLoaded?.window != nil, presentedViewController == nil else {
      completion(false, nil)
      return
    }
    dialogCount += 1
    var finished = false
    let finish: (Bool, String?) -> Void = { [weak self] accepted, text in
      guard !finished else { return }
      finished = true
      self?.finishPendingDialog = nil
      completion(accepted, text)
    }
    finishPendingDialog = { finish(false, nil) }

    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    if textField { alert.addTextField { $0.text = defaultText } }
    alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak alert] _ in
      finish(true, alert?.textFields?.first?.text ?? "")
    })
    if cancellable { alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in finish(false, nil) }) }
    // A page that loops on alert() would otherwise trap the user behind dialogs.
    if dialogCount > 2 {
      alert.addAction(UIAlertAction(title: "Block Dialogs", style: .destructive) { [weak self] _ in
        self?.dialogsBlocked = true
        finish(false, nil)
      })
    }
    present(alert, animated: true)
  }

  @objc private func close() {
    finishPendingDialog?()
    navigationController?.dismiss(animated: true) { [weak self] in self?.finishDismissal() }
  }

  private func finishDismissal() {
    guard !dismissed else { return }
    dismissed = true
    finishPendingDialog?()
    webView.stopLoading()
    onDismiss?()
  }

  // MARK: - WKNavigationDelegate

  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
  ) {
    guard let url = navigationAction.request.url else {
      decisionHandler(.cancel)
      return
    }
    // The document may reload itself or follow its own #fragments; everything else leaves the preview.
    if schemeHandler.isDocument(url) {
      decisionHandler(.allow)
      return
    }
    decisionHandler(.cancel)
    if navigationAction.navigationType == .linkActivated, navigationAction.targetFrame?.isMainFrame != false {
      openExternally(url)
    }
  }

  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    finishPendingDialog?()
    guard !restartedAfterCrash else {
      var configuration = UIContentUnavailableConfiguration.empty()
      configuration.image = UIImage(systemName: "exclamationmark.triangle")
      configuration.text = "Preview Stopped"
      configuration.secondaryText = "This page used too much memory or stopped responding."
      var button = UIButton.Configuration.borderedTinted()
      button.title = "Reload"
      configuration.button = button
      configuration.buttonProperties.primaryAction = UIAction { [weak self] _ in self?.reload() }
      webView.isHidden = true
      contentUnavailableConfiguration = configuration
      return
    }
    restartedAfterCrash = true
    reload()
  }

  // MARK: - WKUIDelegate

  func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    // window.open and target="_blank" links; WebKit only asks after a user gesture.
    if let url = navigationAction.request.url { openExternally(url) }
    return nil
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptAlertPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor @Sendable () -> Void
  ) {
    presentDialog(message: message, cancellable: false) { _, _ in completionHandler() }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptConfirmPanelWithMessage message: String,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor @Sendable (Bool) -> Void
  ) {
    presentDialog(message: message, cancellable: true) { accepted, _ in completionHandler(accepted) }
  }

  func webView(
    _ webView: WKWebView,
    runJavaScriptTextInputPanelWithPrompt prompt: String,
    defaultText: String?,
    initiatedByFrame frame: WKFrameInfo,
    completionHandler: @escaping @MainActor @Sendable (String?) -> Void
  ) {
    presentDialog(message: prompt, cancellable: true, defaultText: defaultText, textField: true) { accepted, text in
      completionHandler(accepted ? text : nil)
    }
  }

  func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }

  func webView(
    _ webView: WKWebView,
    requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    decisionHandler: @escaping @MainActor @Sendable (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }
}
