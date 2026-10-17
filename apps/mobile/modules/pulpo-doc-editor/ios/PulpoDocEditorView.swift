import ExpoModulesCore
import ObjectiveC
import SwiftUI
import UIKit
import WebKit

/*
 * Hosts the document editor page (built from apps/mobile/editor). The page is served from memory by a
 * custom scheme, has a non-persistent data store and a CSP that loads nothing from anywhere, and talks to
 * the app only through the `pulpoEditor` message handler. The app owns the document; the page is a
 * replica, so this view can reload it whenever WebKit ends its content process.
 */

private let editorScheme = "pulpo-editor"
private let editorURL = URL(string: "\(editorScheme)://editor/index.html")!
private let messageHandlerName = "pulpoEditor"

private final class EditorSchemeHandler: NSObject, WKURLSchemeHandler {
  var document = Data()

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      urlSchemeTask.didFailWithError(URLError(.badURL))
      return
    }
    let found = url.host == editorURL.host && url.path == editorURL.path
    let headers = [
      "Cache-Control": "no-store",
      "Content-Type": found ? "text/html; charset=utf-8" : "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    ]
    guard let response = HTTPURLResponse(url: url, statusCode: found ? 200 : 404, httpVersion: "HTTP/1.1", headerFields: headers) else {
      urlSchemeTask.didFailWithError(URLError(.cannotParseResponse))
      return
    }
    urlSchemeTask.didReceive(response)
    if found { urlSchemeTask.didReceive(document) }
    urlSchemeTask.didFinish()
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

/** Breaks the retain cycle between the content controller and the view. */
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
  weak var target: PulpoDocEditorView?

  init(_ target: PulpoDocEditorView) {
    self.target = target
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    target?.receive(message)
  }
}

private var accessoryKey: UInt8 = 0

/**
 * Gives the web view's content view (the first responder while editing) our formatting bar as its input
 * accessory, in place of WebKit's form bar. WebKit then keeps the caret above it as it would for its own.
 * Done with a subclass made at runtime, as WebKit has no API for it; the content view is found by name, and
 * if it is ever missing, editing simply keeps WebKit's own bar.
 */
private func installInputAccessory(_ accessory: UIView?, in webView: WKWebView) {
  guard let content = webView.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }) else { return }
  objc_setAssociatedObject(content, &accessoryKey, accessory, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
  // The iPad keyboard's shortcuts bar would repeat our bar's formatting, and offer underline, which
  // documents do not have; its leading group (undo, redo, paste) stays.
  if accessory != nil {
    for item in [webView.inputAssistantItem, content.inputAssistantItem] { item.trailingBarButtonGroups = [] }
  }
  let base: AnyClass = type(of: content)
  // Already ours: the associated accessory above is all that changes.
  if NSStringFromClass(base).hasPrefix("PulpoDocEditor_") { return }
  let name = "PulpoDocEditor_\(NSStringFromClass(base))"
  var subclass: AnyClass? = NSClassFromString(name)
  if subclass == nil, let created = objc_allocateClassPair(base, name, 0) {
    let selector = #selector(getter: UIResponder.inputAccessoryView)
    let block: @convention(block) (AnyObject) -> UIView? = { object in
      objc_getAssociatedObject(object, &accessoryKey) as? UIView
    }
    if let method = class_getInstanceMethod(base, selector) {
      class_addMethod(created, selector, imp_implementationWithBlock(block), method_getTypeEncoding(method))
    }
    objc_registerClassPair(created)
    subclass = created
  }
  if let subclass { object_setClass(content, subclass) }
}

public final class PulpoDocEditorView: ExpoView, WKNavigationDelegate, WKUIDelegate {
  let onMessage = EventDispatcher()
  let onTerminate = EventDispatcher()
  let onToolbarAction = EventDispatcher()

  var instanceId = ""
  private let schemeHandler = EditorSchemeHandler()
  private var html: String?
  private var loadedHTML: String?
  private lazy var webView = makeWebView()
  private let toolbarModel = DocEditorToolbarModel()
  private lazy var accessory = DocEditorAccessoryView(model: toolbarModel) { [weak self] command in
    self?.toolbarAction(command)
  }
  private var accessoryInstalled = false
  private var finalStateSent = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    webView.frame = bounds
    webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(webView)
  }

  deinit {
    webView.configuration.userContentController.removeScriptMessageHandler(forName: messageHandlerName)
  }

  private func makeWebView() -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(schemeHandler, forURLScheme: editorScheme)
    configuration.userContentController.add(WeakMessageHandler(self), name: messageHandlerName)
    configuration.dataDetectorTypes = []
    configuration.allowsInlineMediaPlayback = false
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    let webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.isOpaque = false
    webView.backgroundColor = .clear
    webView.scrollView.backgroundColor = .clear
    webView.scrollView.keyboardDismissMode = .interactive
    webView.scrollView.contentInsetAdjustmentBehavior = .automatic
    webView.allowsLinkPreview = false
    webView.isFindInteractionEnabled = true
    webView.accessibilityIdentifier = "pulpo-doc-editor"
#if DEBUG
    webView.isInspectable = true
#endif
    return webView
  }

  func load(html: String) {
    self.html = html
    guard html != loadedHTML else { return }
    loadedHTML = html
    schemeHandler.document = Data(html.utf8)
    webView.load(URLRequest(url: editorURL))
  }

  func setPageBackground(hex: String) {
    guard let color = UIColor(hexString: hex) else { return }
    backgroundColor = color
    webView.underPageBackgroundColor = color
  }

  func configureToolbar(_ state: DocEditorToolbarState) {
    toolbarModel.active = Set(state.active)
    toolbarModel.disabled = Set(state.disabled)
    toolbarModel.tint = UIColor(hexString: state.tint).map { Color(uiColor: $0) } ?? .accentColor
    let visible = state.visible
    if visible != accessoryInstalled {
      accessoryInstalled = visible
      installInputAccessory(visible ? accessory : nil, in: webView)
      webView.scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") })?.reloadInputViews()
    }
  }

  func post(_ message: String) {
    // A JSON string is a JavaScript string literal once encoded again.
    guard let data = try? JSONSerialization.data(withJSONObject: [message], options: [.fragmentsAllowed]),
          let array = String(data: data, encoding: .utf8) else { return }
    webView.evaluateJavaScript("window.pulpoEditor && window.pulpoEditor.receive(\(array)[0])", completionHandler: nil)
  }

  func showFind() {
    webView.findInteraction?.presentFindNavigator(showingReplace: false)
  }

  func dismissKeyboard() {
    webView.endEditing(true)
  }

  fileprivate func receive(_ message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == editorScheme,
          let data = message.body as? String else { return }
    onMessage(["data": data])
  }

  private func toolbarAction(_ command: String) {
    if command == "dismissKeyboard" {
      dismissKeyboard()
      return
    }
    onToolbarAction(["command": command])
  }

  /*
   * Leaving the screen: the page may hold an edit whose message is still on its way, so its whole state is
   * pulled one last time and handed to the app, which merges it (merges are idempotent). The completion
   * handler keeps the web view alive until then.
   */
  public override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if newWindow == nil { sendFinalState() }
    else { finalStateSent = false }
  }

  private func sendFinalState() {
    guard !finalStateSent, loadedHTML != nil else { return }
    finalStateSent = true
    let id = instanceId
    let webView = self.webView
    webView.evaluateJavaScript("window.pulpoEditorState ? window.pulpoEditorState() : null") { result, _ in
      _ = webView
      PulpoDocEditorModule.current?.sendFinalState(instanceId: id, state: result as? String)
    }
  }

  // MARK: WKNavigationDelegate

  public func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    // The page itself; links are opened by the app (the editor reports taps on them).
    let url = navigationAction.request.url
    decisionHandler(url?.scheme == editorScheme && url?.host == editorURL.host && navigationAction.targetFrame?.isMainFrame == true ? .allow : .cancel)
  }

  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    onTerminate([:])
    // The app keeps the document; a reloaded page gets it again through `init`.
    if let html {
      loadedHTML = nil
      load(html: html)
    }
  }

  // MARK: WKUIDelegate

  public func webView(
    _ webView: WKWebView,
    createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction,
    windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    nil
  }

  public func webView(
    _ webView: WKWebView,
    requestMediaCapturePermissionFor origin: WKSecurityOrigin,
    initiatedByFrame frame: WKFrameInfo,
    type: WKMediaCaptureType,
    decisionHandler: @escaping (WKPermissionDecision) -> Void
  ) {
    decisionHandler(.deny)
  }
}

extension UIColor {
  convenience init?(hexString: String) {
    var value = hexString.trimmingCharacters(in: .whitespacesAndNewlines)
    if value.hasPrefix("#") { value.removeFirst() }
    guard value.count == 6 || value.count == 8, let number = UInt64(value, radix: 16) else { return nil }
    let hasAlpha = value.count == 8
    let red = CGFloat((number >> (hasAlpha ? 24 : 16)) & 0xff) / 255
    let green = CGFloat((number >> (hasAlpha ? 16 : 8)) & 0xff) / 255
    let blue = CGFloat((number >> (hasAlpha ? 8 : 0)) & 0xff) / 255
    let alpha = hasAlpha ? CGFloat(number & 0xff) / 255 : 1
    self.init(red: red, green: green, blue: blue, alpha: alpha)
  }
}
