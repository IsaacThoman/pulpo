#if os(iOS)
import UIKit

/// Finds the bundled dictionary and emoji data, in the extension or (for the app's
/// preview) inside the embedded extension bundle.
public enum KeyboardResources {
  public static func url(_ name: String, _ ext: String) -> URL? {
    if let url = Bundle.main.url(forResource: name, withExtension: ext) { return url }
    if let plugins = Bundle.main.builtInPlugInsURL,
       let bundle = Bundle(url: plugins.appendingPathComponent("PulpoKeyboardExtension.appex")) {
      return bundle.url(forResource: name, withExtension: ext)
    }
    return nil
  }
}

/// The keyboard's root view: suggestion bar over the key grid, or a full-height
/// emoji or dictation panel.
public final class KeyboardRootView: UIView {
  let bar: SuggestionBarView
  let keys: KeysView
  var emoji: EmojiPanelView?
  let dictation: DictationPanelView
  var style: KeyboardStyle
  /// Paint gaps as well as caps so remote keyboard hit testing receives them.
  public var paintsBackground = false { didSet { backgroundColor = paintsBackground ? style.background : .clear } }

  /// Extra bottom bezel owned by a preview host. Keep its touches in the grid
  /// without moving the caps or the emoji/dictation panel controls.
  public var bottomTouchPadding: CGFloat = 0

  public override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    if mode == .keys, bottomTouchPadding > 0 {
      var area = bounds
      area.size.height += bottomTouchPadding
      return area.contains(point)
    }
    return super.point(inside: point, with: event)
  }

  enum Mode { case keys, emoji, dictation }
  var mode: Mode = .keys { didSet { if mode != oldValue { applyMode() } } }

  init(style: KeyboardStyle, layout: KeyboardLayout) {
    self.style = style
    bar = SuggestionBarView(style: style)
    keys = KeysView(layout: layout, style: style)
    dictation = DictationPanelView(style: style)
    super.init(frame: .zero)
    accessibilityIdentifier = "pulpo-keyboard"
    addSubview(bar)
    addSubview(keys)
    dictation.isHidden = true
    addSubview(dictation)
    keys.popupHost = self
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func apply(_ style: KeyboardStyle) {
    guard style != self.style else { return }
    self.style = style
    bar.applyStyle(style)
    dictation.applyStyle(style)
    emoji?.applyStyle(style)
    if paintsBackground { backgroundColor = style.background }
    setNeedsLayout()
  }

  private func applyMode() {
    keys.cancelAllTouches()
    bar.isHidden = mode != .keys
    keys.isHidden = mode != .keys
    emoji?.isHidden = mode != .emoji
    dictation.isHidden = mode != .dictation
  }

  /// Keep the lower bar edge forgiving for the top row, and forward unused bar
  /// background or empty suggestion slots rather than letting them swallow taps.
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let target = super.hitTest(point, with: event)
    guard target != nil, mode == .keys, !bar.isShowingNotice else { return target }
    if point.y >= bar.frame.maxY - 7, point.y < bar.frame.maxY { return keys }
    if let target, target === bar || target === self { return keys }
    if let slot = target as? SlotControl, !slot.isEnabled { return keys }
    return target
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    bar.frame = CGRect(x: 0, y: 0, width: bounds.width, height: style.barHeight)
    keys.frame = CGRect(x: 0, y: style.barHeight, width: bounds.width, height: bounds.height - style.barHeight)
    emoji?.frame = bounds
    dictation.frame = bounds
  }
}

/// Connects the engine, the views, and the host. One per keyboard instance.
public final class KeyboardController: NSObject {
  public let rootView: KeyboardRootView
  public let engine: KeyboardEngine
  let stack: LanguageStack?
  private weak var host: KeyboardHost?
  private var settings: KeyboardSettings
  private let settingsStore = SettingsStore()
  private var account = AccountSnapshot.signedOut
  private let bridge = DictationBridge()
  private var dictationObserver: DarwinNotifications.Observation?
  private var levelLink: CADisplayLink?
  private var connectTimeout: Timer?
  private var layoutKey: String?
  private var lastWidth: CGFloat = 0
  /// iOS can keep an earlier keyboard instance alive after an app switch; only the one on
  /// screen acts on dictation updates, so a transcript lands in the field being edited.
  private var isVisible = false
  let haptics: KeyboardFeedback
  private var barUpdateScheduled = false
  private var glideFallbacks = 0
  public var onHeightChange: ((CGFloat) -> Void)?

  public init(host: KeyboardHost) {
    self.host = host
    settings = SettingsStore().load()
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    stack = KeyboardResources.url("en_US", "pkdict").flatMap {
      try? LanguageStack(dictionaryURL: $0, personalURL: AppGroup.personalDictionaryURL(fallback: support))
    }
    engine = KeyboardEngine(document: host.document, suggester: stack?.suggester, glide: stack?.glide, settings: settings)
    engine.traits = host.inputTraits
    let style = KeyboardStyle.current(dark: host.inputTraits.prefersDarkAppearance == true, landscape: false, inset: !host.isInsideApp)
    rootView = KeyboardRootView(style: style, layout: KeyboardLayout.make(page: .letters, traits: host.inputTraits, needsGlobe: host.needsInputModeSwitchKey, digitHints: settings.digitHints))
    haptics = KeyboardFeedback(view: rootView)
    super.init()
    haptics.enabled = settings.haptics && host.hasFullAccess
    KeyboardFeedback.current = haptics
    rootView.keys.delegate = self
    rootView.bar.onSelect = { [weak self] in self?.select($0) }
    rootView.bar.onForget = { [weak self] in self?.forget($0) }
    rootView.bar.onMicrophone = { [weak self] in self?.startDictation() }
    rootView.bar.onSettings = { [weak self] in self?.host?.openApp(URL(string: "\(AppGroup.urlScheme)://settings")!) }
    rootView.dictation.onStop = { [weak self] in self?.stopDictation() }
    rootView.dictation.onCancel = { [weak self] in self?.cancelDictation() }
    dictationObserver = DarwinNotifications.observe(DictationBridge.stateNotification) { [weak self] in
      MainActor.assumeIsolated { self?.dictationStateChanged() }
    }
    engine.documentDidChange()
    sync()
  }

  // MARK: Host events

  public func hostWillAppear() {
    isVisible = true
    settings = settingsStore.load()
    engine.settings = settings
    KeyboardFeedback.current = haptics
    haptics.enabled = settings.haptics && host?.hasFullAccess == true
    account = AccountSnapshot.load()
    if host?.hasFullAccess == true { KeyboardHeartbeat.record(hasFullAccess: true) }
    engine.traits = host?.inputTraits ?? InputTraits()
    engine.page = engine.traits.keyboard == .numbersAndPunctuation ? .numbers : .letters
    rootView.mode = .keys
    engine.documentDidChange()
    sync()
    resumeDictationIfNeeded()
    #if DEBUG
    if let key = AppGroup.defaults?.string(forKey: "debugPopupKey") {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) { [weak self] in self?.rootView.keys.debugShowPreview(key) }
    }
    #endif
  }

  public func hostDidDisappear() {
    isVisible = false
    engine.save()
    recordDiagnostics()
    stopLevelUpdates()
    rootView.keys.cancelAllTouches()
  }

  public func documentDidChange() {
    let traits = host?.inputTraits ?? InputTraits()
    if traits != engine.traits {
      engine.traits = traits
      engine.page = traits.keyboard == .numbersAndPunctuation ? .numbers : .letters
    }
    engine.documentDidChange()
    sync()
  }

  /// Contacts' names and the person's text replacements, from `UILexicon`.
  public func applySupplementaryLexicon(_ entries: [(userInput: String, documentText: String)]) {
    guard let stack else { return }
    var names: [String] = []
    var replacements: [String: String] = [:]
    for entry in entries {
      if entry.userInput == entry.documentText {
        names.append(contentsOf: entry.documentText.split(separator: " ").map(String.init))
      } else if !entry.userInput.isEmpty {
        replacements[entry.userInput.lowercased()] = entry.documentText
      }
    }
    stack.personal.setTransientWords(names)
    stack.suggester.textReplacements = replacements
  }

  /// Recomputes style and size when the width or appearance changes.
  public func layoutChanged(dark: Bool) {
    let width = rootView.bounds.width
    let landscape = width > 500
    let style = KeyboardStyle.current(dark: dark || host?.inputTraits.prefersDarkAppearance == true, landscape: landscape, inset: host?.isInsideApp == false)
    let styleChanged = style != rootView.style
    rootView.apply(style)
    if styleChanged || width != lastWidth {
      lastWidth = width
      layoutKey = nil
      onHeightChange?(style.totalHeight)
      sync()
    }
  }

  public var preferredHeight: CGFloat { rootView.style.totalHeight }

  // MARK: Rendering

  private func sync() {
    let traits = engine.traits
    let needsGlobe = host?.needsInputModeSwitchKey ?? false
    let key = "\(engine.page)|\(traits.keyboard)|\(traits.returnKey)|\(needsGlobe)|\(settings.digitHints)"
    if key != layoutKey {
      layoutKey = key
      let layout = KeyboardLayout.make(page: engine.page, traits: traits, needsGlobe: needsGlobe, digitHints: settings.digitHints)
      rootView.keys.setLayout(layout, style: rootView.style)
    } else if rootView.keys.style != rootView.style {
      rootView.keys.setLayout(rootView.keys.layout, style: rootView.style)
    }
    rootView.keys.shift = engine.shift
    rootView.keys.returnEnabled = engine.returnKeyEnabled
    rootView.bar.microphoneVisible = !traits.isPrivate && !traits.isNumeric
    scheduleBarUpdate()
  }

  /// Suggestions are refreshed after the current touches are handled, once per run
  /// loop pass, so fast typing never waits on them.
  private func scheduleBarUpdate() {
    guard !barUpdateScheduled else { return }
    barUpdateScheduled = true
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      self.barUpdateScheduled = false
      self.rootView.bar.setSuggestions(self.engine.suggestions.slots)
    }
  }

  private func recordDiagnostics() {
    let stats = rootView.keys.stats
    guard stats.touches > 0, AppGroup.isWritable else { return }
    Diagnostics.record("keyboard", "session", [
      "touches": stats.touches, "cancelled": stats.cancelled, "cancelledTapsKept": stats.cancelledTapsKept,
      "glides": stats.glides, "glideFallbacks": glideFallbacks, "cursorSlides": stats.cursorSlides,
      "rolled": stats.rolled, "slowTouches": stats.slowTouches, "maxTouchDelayMs": Int(stats.maxTouchDelayMs),
      "activations": stats.activations, "retargets": stats.retargets,
      "releaseRetargets": stats.releaseRetargets, "functionDrifts": stats.functionDrifts,
      "laggingContext": engine.laggingContextUpdates, "externalContext": engine.externalContextChanges,
    ])
    rootView.keys.stats = KeysView.Stats()
  }

  private func updateGeometry() {
    guard engine.page == .letters, let stack, rootView.keys.bounds.width > 0 else { return }
    let pitch = rootView.keys.pitch
    let centers = rootView.keys.letterCenters
    guard centers.count == 26, pitch.width > 1 else { return }
    stack.setGeometry(LetterGeometry(centers: centers.mapValues { KeyPoint(x: $0.x / pitch.width, y: $0.y / pitch.height) }))
  }

  private func normalized(_ point: CGPoint) -> KeyPoint {
    let pitch = rootView.keys.pitch
    return KeyPoint(x: point.x / pitch.width, y: point.y / pitch.height)
  }

  private func feedback(for key: Key) {
    haptics.key(function: key.style != .input)
    if settings.sounds { UIDevice.current.playInputClick() }
  }

  // MARK: Suggestions

  private func select(_ suggestion: Suggestion) {
    engine.select(suggestion)
    sync()
  }

  private func forget(_ suggestion: Suggestion) {
    stack?.personal.forget(suggestion.text)
    stack?.personal.save()
    engine.refreshSuggestions()
    sync()
  }

  // MARK: Emoji

  private func showEmoji() {
    if rootView.emoji == nil {
      guard let url = KeyboardResources.url("emoji", "json"), let catalog = try? EmojiCatalog.load(url: url) else { return }
      let defaults = AppGroup.isWritable ? (AppGroup.defaults ?? .standard) : .standard
      let panel = EmojiPanelView(style: rootView.style, catalog: catalog, history: EmojiHistory(defaults: defaults))
      panel.delegate = self
      rootView.insertSubview(panel, belowSubview: rootView.dictation)
      rootView.emoji = panel
      rootView.setNeedsLayout()
    }
    rootView.mode = .emoji
  }

  // MARK: Dictation

  private func startDictation() {
    rootView.mode = .dictation
    account = AccountSnapshot.load()
    guard host?.hasFullAccess == true, let bridge else {
      showDictationRequirement(
        "Allow Full Access to dictate",
        detail: "In Settings, open General › Keyboard › Keyboards › Pulpo Keyboard and turn on Allow Full Access.",
        action: "Open Pulpo Keyboard", path: "setup")
      return
    }
    guard account.signedIn else {
      showDictationRequirement("Sign in to dictate", detail: "Dictation uses your Pulpo account.", action: "Sign In", path: "account")
      return
    }
    guard account.dictationAvailable else {
      showDictationRequirement("Dictation is off", detail: "Dictation isn't enabled on \(account.instanceHost ?? "your Pulpo instance").", action: nil, path: nil)
      return
    }
    let request = UUID()
    bridge.pendingRequest = request
    rootView.dictation.set(.connecting)
    rootView.bar.setMicrophoneActive(true)
    if host?.isInsideApp == true || bridge.readState().isStandingBy() {
      bridge.send(DictationCommand(kind: .start, requestID: request))
      connectTimeout?.invalidate()
      let timer = Timer(timeInterval: 2.5, repeats: false) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self, case .connecting = self.rootView.dictation.state, self.bridge?.pendingRequest == request else { return }
          self.openAppForDictation(request)
        }
      }
      RunLoop.main.add(timer, forMode: .common)
      connectTimeout = timer
    } else {
      openAppForDictation(request)
    }
  }

  private func openAppForDictation(_ request: UUID) {
    var components = URLComponents()
    components.scheme = AppGroup.urlScheme
    components.host = "dictate"
    components.queryItems = [URLQueryItem(name: "request", value: request.uuidString)]
    if let bundle = host?.hostBundleIdentifier { components.queryItems?.append(URLQueryItem(name: "host", value: bundle)) }
    if let url = components.url { host?.openApp(url) }
  }

  private func showDictationRequirement(_ title: String, detail: String, action: String?, path: String?) {
    rootView.dictation.set(.message(title: title, detail: detail, action: action))
    rootView.dictation.onAction = { [weak self] in
      guard let path else { return }
      self?.host?.openApp(URL(string: "\(AppGroup.urlScheme)://\(path)")!)
    }
  }

  private func stopDictation() {
    guard let bridge, let request = bridge.pendingRequest else { return finishDictation() }
    bridge.send(DictationCommand(kind: .stop, requestID: request))
    rootView.dictation.set(.transcribing)
    stopLevelUpdates()
  }

  private func cancelDictation() {
    if let bridge, let request = bridge.pendingRequest {
      bridge.send(DictationCommand(kind: .cancel, requestID: request))
      bridge.pendingRequest = nil
    }
    finishDictation()
  }

  private func finishDictation() {
    connectTimeout?.invalidate()
    stopLevelUpdates()
    rootView.bar.setMicrophoneActive(false)
    rootView.mode = .keys
    sync()
  }

  private func resumeDictationIfNeeded() {
    guard let bridge, bridge.pendingRequest != nil else { return }
    let state = bridge.readState()
    guard state.requestID == bridge.pendingRequest else { return }
    rootView.mode = .dictation
    dictationStateChanged()
  }

  private func dictationStateChanged() {
    guard isVisible, let bridge else { return }
    guard let request = bridge.pendingRequest else {
      // Nothing pending: never leave the panel waiting on a request that's gone.
      if rootView.mode == .dictation, rootView.dictation.state == .transcribing || rootView.dictation.state == .connecting {
        finishDictation()
      }
      return
    }
    let state = bridge.readState()
    guard state.requestID == request else { return }
    connectTimeout?.invalidate()
    switch state.phase {
    case .recording:
      rootView.mode = .dictation
      rootView.dictation.set(.recording(startedAt: state.startedAt ?? Date()))
      startLevelUpdates()
    case .transcribing:
      rootView.mode = .dictation
      rootView.dictation.set(.transcribing)
      stopLevelUpdates()
    case .finished:
      if !bridge.wasDelivered(request), let text = state.transcript {
        bridge.markDelivered(request)
        engine.insertTranscript(text)
      }
      bridge.pendingRequest = nil
      finishDictation()
    case .failed:
      stopLevelUpdates()
      bridge.pendingRequest = nil
      rootView.dictation.set(.message(title: "Couldn't transcribe", detail: state.errorMessage, action: "Try Again"))
      rootView.dictation.onAction = { [weak self] in self?.startDictation() }
    case .idle:
      bridge.pendingRequest = nil
      finishDictation()
    }
  }

  private func startLevelUpdates() {
    guard levelLink == nil else { return }
    let link = CADisplayLink(target: self, selector: #selector(readLevels))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 15, maximum: 30, preferred: 24)
    link.add(to: .main, forMode: .common)
    levelLink = link
  }

  private func stopLevelUpdates() {
    levelLink?.invalidate()
    levelLink = nil
  }

  @objc private func readLevels() {
    rootView.dictation.setLevels(bridge?.readLevels() ?? [])
  }
}

extension KeyboardController: KeysViewDelegate {
  func keysView(_ view: KeysView, touchDown key: Key) {
    feedback(for: key)
    switch key.action {
    case .shift:
      engine.shiftDown()
    case .delete:
      engine.deleteBackward()
    case .page(let page):
      engine.page = page
    default:
      return
    }
    sync()
  }

  func keysView(_ view: KeysView, activate key: Key, at point: CGPoint) {
    switch key.action {
    case .character(let text):
      let isLetter = text.count == 1 && text.first?.isLetter == true
      engine.insertCharacter(text, tap: isLetter && engine.page == .letters ? normalized(point) : nil)
    case .space:
      engine.insertSpace()
    case .returnKey:
      guard engine.returnKeyEnabled else { return }
      engine.insertReturn()
    case .emoji:
      showEmoji()
      return
    case .text(let text):
      guard !text.isEmpty else { return }
      engine.insertText(text)
    case .nextKeyboard:
      host?.advanceToNextInputMode()
      return
    case .shift, .delete, .page:
      return
    }
    sync()
  }

  func keysView(_ view: KeysView, insertAlternate text: String, for key: Key) {
    if case .text = key.action {
      engine.insertText(text)
    } else {
      engine.insertCharacter(text)
    }
    sync()
  }

  func keysView(_ view: KeysView, glide points: [CGPoint], start: Key) {
    if engine.insertGlide(points.map(normalized)).isEmpty, case .character(let text) = start.action {
      // No word fits the path: it was a sloppy tap, so type the key it started on.
      glideFallbacks += 1
      engine.insertCharacter(text, tap: points.first.map(normalized))
    }
    sync()
  }

  func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool) {
    if settings.sounds { UIDevice.current.playInputClick() }
    if wholeWord { engine.deleteWordBackward() } else { engine.deleteBackward() }
    sync()
  }

  func keysView(_ view: KeysView, moveCursor offset: Int) {
    host?.adjustTextPosition(byCharacterOffset: offset)
    haptics.tick()
  }

  func keysViewShiftUp(_ view: KeysView) {
    engine.shiftUp()
    sync()
  }

  func keysView(_ view: KeysView, inputModeListWith event: UIEvent) {
    host?.handleInputModeList(from: view, with: event)
  }

  func keysViewDidLayout(_ view: KeysView) {
    updateGeometry()
  }

  func keysViewFinishedPageSlide(_ view: KeysView) {
    engine.page = .letters
    sync()
  }

  var keysViewAllowsGlide: Bool { stack != nil && engine.policy.allowsGlide && engine.page == .letters }
  var keysViewShowsPopups: Bool { settings.keyPopups }
}

extension KeyboardController: EmojiPanelDelegate {
  func emojiPanel(_ panel: EmojiPanelView, insert emoji: String) {
    engine.insertText(emoji)
    sync()
  }

  func emojiPanelDelete(_ panel: EmojiPanelView, wholeWord: Bool) {
    if wholeWord { engine.deleteWordBackward() } else { engine.deleteBackward() }
    sync()
  }

  func emojiPanelClose(_ panel: EmojiPanelView) {
    rootView.mode = .keys
    sync()
  }
}
#endif
