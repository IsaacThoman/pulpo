#if os(iOS)
import UIKit

/// Finds the bundled dictionary and emoji data, in the extension or (for the app's
/// preview) inside the embedded extension bundle.
public enum KeyboardResources {
  /// A language data directory to read instead of the bundles, for tests that
  /// run the controller outside the app.
  public static var directory: URL?

  public static func url(_ name: String, _ ext: String) -> URL? {
    if let directory {
      let url = directory.appendingPathComponent(name).appendingPathExtension(ext)
      return FileManager.default.fileExists(atPath: url.path) ? url : nil
    }
    if let url = Bundle.main.url(forResource: name, withExtension: ext) { return url }
    if let plugins = Bundle.main.builtInPlugInsURL,
       let bundle = Bundle(url: plugins.appendingPathComponent("PulpoKeyboardExtension.appex")) {
      return bundle.url(forResource: name, withExtension: ext)
    }
    return nil
  }
}

/// The keyboard's root view: suggestion bar over the key grid, or a full-height
/// emoji or dictation panel. Emoji search puts its search row over the keys.
/// A one-handed layout narrows the bar and keys against one edge, with side
/// controls in the space left over.
public final class KeyboardRootView: UIView {
  let bar: SuggestionBarView
  let keys: KeysView
  /// The picker, while it shows.
  var emoji: EmojiPanelView?
  /// Where the last picker was scrolled, for the next one.
  var emojiOffset: CGFloat = 0
  let dictation: DictationPanelView
  let search: EmojiSearchBarView
  let sidePanel: OneHandedPanelView
  var style: KeyboardStyle
  /// Paint gaps as well as caps so remote keyboard hit testing receives them.
  public var paintsBackground = false { didSet { backgroundColor = paintsBackground ? style.background : .clear } }

  /// Extra bottom bezel owned by a preview host. Keep its touches in the grid
  /// without moving the caps or the emoji/dictation panel controls.
  public var bottomTouchPadding: CGFloat = 0

  public override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    if showsKeys, bottomTouchPadding > 0 {
      var area = bounds
      area.size.height += bottomTouchPadding
      return area.contains(point)
    }
    return super.point(inside: point, with: event)
  }

  enum Mode { case keys, emoji, dictation, emojiSearch }
  var mode: Mode = .keys { didSet { if mode != oldValue { applyMode() } } }
  /// The key grid is showing, for typing or for the emoji search field.
  var showsKeys: Bool { mode == .keys || mode == .emojiSearch }

  /// The chosen one-handed layout. It applies only where the keyboard can dock.
  var oneHanded: OneHandedMode = .off {
    didSet {
      guard oneHanded != oldValue else { return }
      setNeedsLayout()
      layoutIfNeeded()
    }
  }

  /// Whether this width and orientation leave room to dock the keys.
  var canDock: Bool { !style.landscape && OneHandedMode.right.keysWidth(in: Double(bounds.width)) < bounds.width }

  /// The key area's width: narrower when docked.
  var keysWidth: CGFloat {
    style.landscape ? bounds.width : CGFloat(oneHanded.keysWidth(in: Double(bounds.width)))
  }

  init(style: KeyboardStyle, layout: KeyboardLayout) {
    self.style = style
    bar = SuggestionBarView(style: style)
    keys = KeysView(layout: layout, style: style)
    dictation = DictationPanelView(style: style)
    search = EmojiSearchBarView(style: style)
    sidePanel = OneHandedPanelView(style: style)
    super.init(frame: .zero)
    accessibilityIdentifier = "pulpo-keyboard"
    addSubview(bar)
    addSubview(keys)
    search.isHidden = true
    addSubview(search)
    sidePanel.isHidden = true
    addSubview(sidePanel)
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
    search.applyStyle(style)
    sidePanel.applyStyle(style)
    if paintsBackground { backgroundColor = style.background }
    setNeedsLayout()
  }

  private func applyMode() {
    keys.cancelAllTouches()
    bar.isHidden = mode != .keys
    search.isHidden = mode != .emojiSearch
    keys.isHidden = !showsKeys
    emoji?.isHidden = mode != .emoji
    dictation.isHidden = mode != .dictation
    sidePanel.isHidden = !showsKeys || keysWidth >= bounds.width
    if mode != .emoji { releaseEmoji() }
    if mode != .emojiSearch { search.clear() }
  }

  /// Lets go of the picker, with its cells and their emoji images; the next one
  /// opens where this one was left.
  func releaseEmoji() {
    guard let panel = emoji else { return }
    emojiOffset = panel.scrollOffset
    panel.removeFromSuperview()
    emoji = nil
    EmojiFont.releaseCurrent()
  }

  /// Forward unused bar background or empty suggestion slots to the top row.
  /// Enabled controls keep their whole touch area, including the lower bar edge.
  /// The one-handed side controls keep their own strip.
  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let target = super.hitTest(point, with: event)
    guard target != nil, showsKeys, mode == .emojiSearch || !bar.isShowingNotice else { return target }
    if !sidePanel.isHidden, sidePanel.frame.contains(point) { return target }
    var ancestor = target
    while let view = ancestor, view !== self {
      if let control = view as? UIControl, control.isEnabled { return target }
      ancestor = view.superview
    }
    let row: UIView = mode == .keys ? bar : search
    if point.y >= row.frame.maxY - 7, point.y < row.frame.maxY { return keys }
    if let target, target === bar || target === self { return keys }
    if let slot = target as? SlotControl, !slot.isEnabled { return keys }
    return target
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    let width = keysWidth
    let panelWidth = bounds.width - width
    let x = oneHanded == .right ? panelWidth : 0
    bar.frame = CGRect(x: x, y: 0, width: width, height: style.barHeight)
    search.frame = bar.frame
    keys.frame = CGRect(x: x, y: style.barHeight, width: width, height: bounds.height - style.barHeight)
    sidePanel.side = oneHanded
    sidePanel.frame = CGRect(x: oneHanded == .right ? 0 : width, y: 0, width: panelWidth, height: bounds.height)
    sidePanel.isHidden = !showsKeys || panelWidth <= 0
    emoji?.frame = bounds
    dictation.frame = bounds
  }
}

/// Connects the engine, the views, and the host. One per keyboard instance.
public final class KeyboardController: NSObject {
  public let rootView: KeyboardRootView
  public let engine: KeyboardEngine
  private(set) var stack: LanguageStack?
  private weak var host: KeyboardHost?
  private var settings: KeyboardSettings
  private let settingsStore = SettingsStore()
  private var loadedLanguage: KeyboardLanguage
  private var reportedLanguage: KeyboardLanguage?
  private var account = AccountSnapshot.signedOut
  private let bridge: DictationBridge?
  private var dictationInsertionGuard: DictationInsertionGuard?
  private var dictationOriginRequest: UUID?
  private var dictationPanelRequest: UUID?
  private var dictationDestinationRevision: UInt64 = 0
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
  private let emojiHistory: EmojiHistory
  private var emojiCatalog: EmojiCatalog?
  private var emojiSuggester: EmojiSuggester?
  private var pendingEmojiPresentation = false
  /// The emoji search field's text, while searching from the picker.
  private var emojiSearch: EmojiSearchQuery?
  /// Shift for the search field, apart from the document's shift state.
  private var searchShift: ShiftState = .off
  /// The document a search started in; another field ends the search.
  private var searchDocument: UUID?
  private let oneHandedStore: OneHandedStore
  /// A delete press that would undo an autocorrection or swiped word waits for
  /// lift (or repeat), so a word swipe that follows never teaches the typo.
  private var deferredDelete = false
  /// The text before the cursor when delete went down, so undo restores it all.
  private var deleteStartContext: String?
  private struct DeleteGestureOrigin {
    let documentID: UUID?
    let isPrivate: Bool
    var externalChanges: Int
  }
  private var deleteGestureOrigin: DeleteGestureOrigin?
  /// Words a delete swipe would remove, shown in the bar until the finger lifts.
  private var deletionPreview: (text: String, words: Int)?
  /// The last delete swipe, offered as Undo until the next edit.
  private var wordDeletionUndo: KeyboardEngine.WordDeletion?

  /// Catalog decoding, glyph checks and keyword indexing stay off the first-key
  /// path. Preview controllers share this work for the lifetime of the process.
  private static let emojiResources: Task<(catalog: EmojiCatalog, suggester: EmojiSuggester)?, Never> = {
    guard let url = KeyboardResources.url("emoji", "json") else { return Task { nil } }
    let unsupportedKey = "emojiUnsupported2-\(UIDevice.current.systemVersion)"
    return Task.detached(priority: .utility) {
      guard let catalog = try? EmojiCatalog.load(url: url) else { return nil }
      let unsupported: Set<String>
      if let cached = UserDefaults.standard.stringArray(forKey: unsupportedKey) {
        unsupported = Set(cached)
      } else {
        unsupported = Set(catalog.categories.flatMap(\.emoji).map(\.value).filter { !EmojiPanelView.drawsAsOneGlyph($0) })
        UserDefaults.standard.set(Array(unsupported), forKey: unsupportedKey)
      }
      let supported = catalog.filtered { !unsupported.contains($0.value) }
      return (supported, EmojiSuggester(catalog: supported))
    }
  }()
  public var onHeightChange: ((CGFloat) -> Void)?

  /// One language stack per process. iOS builds a new controller for every
  /// presentation; sharing keeps the parsed learned words and warmed caches, and
  /// gives overlapping instances one set of learned words to save.
  private static var sharedStack: (stack: LanguageStack, personalURL: URL?, language: KeyboardLanguage)?

  private static func languageStack(language: KeyboardLanguage, personalURL: URL?, touchURL: URL?) -> LanguageStack? {
    if let shared = sharedStack, shared.personalURL == personalURL {
      shared.stack.personal.reloadIfChangedOnDisk()
      shared.stack.touch.reloadIfChangedOnDisk()
      if shared.language == language { return shared.stack }
    }
    guard let url = KeyboardResources.url(language.rawValue, "pkdict") else { return nil }
    let stack: LanguageStack
    do {
      if let previous = sharedStack, previous.personalURL == personalURL {
        stack = try LanguageStack(dictionaryURL: url, sharing: previous.stack)
      } else {
        stack = try LanguageStack(dictionaryURL: url, personalURL: personalURL, touchURL: touchURL)
      }
    } catch { return nil }
    sharedStack = (stack, personalURL, language)
    return stack
  }

  /// Diagnostics rewrite a small file; keep that off the typing thread, in order.
  private static let diagnosticsQueue = DispatchQueue(label: "com.isaacthoman.pulpo.keyboard.diagnostics", qos: .utility)

  public init(host: KeyboardHost, dictationBridge: DictationBridge? = DictationBridge()) {
    let initStart = PerfLog.begin()
    self.host = host
    bridge = dictationBridge
    settings = settingsStore.load()
    loadedLanguage = settings.language
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
    // Probing the App Group writes a file; do it once.
    let writable = AppGroup.isWritable
    let stackStart = PerfLog.begin()
    stack = Self.languageStack(language: settings.language, personalURL: AppGroup.personalDictionaryURL(fallback: support, writable: writable),
                               touchURL: AppGroup.touchModelURL(fallback: support, writable: writable))
    if stack == nil, settings.language != .english {
      settings.language = .english
      loadedLanguage = .english
      stack = Self.languageStack(language: .english, personalURL: AppGroup.personalDictionaryURL(fallback: support, writable: writable),
                                 touchURL: AppGroup.touchModelURL(fallback: support, writable: writable))
    }
    PerfLog.end("init.stack", stackStart)
    engine = KeyboardEngine(document: host.document, suggester: stack?.suggester, glide: stack?.glide, settings: settings)
    let emojiDefaults = writable ? (AppGroup.defaults ?? .standard) : .standard
    emojiHistory = EmojiHistory(defaults: emojiDefaults)
    oneHandedStore = OneHandedStore(defaults: emojiDefaults)
    engine.emojiHistory = emojiHistory
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
    rootView.bar.onUndo = { [weak self] in self?.undoWordDeletion() }
    rootView.search.onBack = { [weak self] in self?.endEmojiSearch(showingPanel: true) }
    rootView.search.onSelect = { [weak self] in self?.insertSearchResult($0) }
    rootView.sidePanel.onExpand = { [weak self] in self?.chooseOneHanded(.off) }
    rootView.sidePanel.onMove = { [weak self] in
      guard let self else { return }
      self.chooseOneHanded(self.rootView.oneHanded.flipped)
    }
    rootView.oneHanded = oneHandedStore.load()
    rootView.dictation.onCancel = { [weak self] in self?.finishDictation() }
    dictationObserver = DarwinNotifications.observe(DictationBridge.stateNotification) { [weak self] in
      MainActor.assumeIsolated { self?.dictationStateChanged() }
    }
    engine.documentDidChange()
    sync()
    PerfLog.end("init.total", initStart)
    let resources = Self.emojiResources
    Task { [weak self] in
      guard let prepared = await resources.value, let self else { return }
      self.emojiResourcesLoaded(catalog: prepared.catalog, suggester: prepared.suggester)
    }
  }

  /// The emoji index arrives off the typing path, at any point between touches.
  func emojiResourcesLoaded(catalog: EmojiCatalog, suggester: EmojiSuggester) {
    PerfLog.event("emojiReady")
    emojiCatalog = catalog
    emojiSuggester = suggester
    engine.emojiSuggester = suggester
    engine.refreshSuggestions()
    sync()
    if pendingEmojiPresentation {
      pendingEmojiPresentation = false
      if isVisible, rootView.mode == .keys { showEmoji() }
    }
  }

  // MARK: Host events

  public func hostWillAppear() {
    isVisible = true
    pendingEmojiPresentation = false
    resetDeleteGesture()
    // The app can clear learned words while this process stays alive.
    stack?.personal.reloadIfChangedOnDisk()
    stack?.touch.reloadIfChangedOnDisk()
    settings = settingsStore.load()
    if settings.language != loadedLanguage { replaceLanguage(settings.language) }
    engine.settings = settings
    KeyboardFeedback.current = haptics
    haptics.enabled = settings.haptics && host?.hasFullAccess == true
    account = AccountSnapshot.load()
    // Only the installed keyboard reports setup; the app's in-app preview always
    // has "Full Access" and would otherwise mark setup done before it is.
    if let host, !host.isInsideApp {
      if host.hasFullAccess { KeyboardHeartbeat.record(hasFullAccess: true) }
      DarwinNotifications.post(KeyboardHeartbeat.appearedNotification(fullAccess: host.hasFullAccess))
    }
    engine.traits = host?.inputTraits ?? InputTraits()
    engine.page = engine.traits.keyboard == .numbersAndPunctuation ? .numbers : .letters
    emojiSearch = nil
    searchShift = .off
    rootView.oneHanded = oneHandedStore.load()
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

  @discardableResult
  private func replaceLanguage(_ language: KeyboardLanguage) -> Bool {
    guard let previous = stack, let url = KeyboardResources.url(language.rawValue, "pkdict"),
          let replacement = try? LanguageStack(dictionaryURL: url, sharing: previous) else {
      settings.language = loadedLanguage
      return false
    }
    engine.useLanguageStack(replacement)
    stack = replacement
    loadedLanguage = language
    if let shared = Self.sharedStack, shared.stack.personal === previous.personal {
      Self.sharedStack = (replacement, shared.personalURL, language)
    }
    updateGeometry()
    return true
  }

  public func hostDidDisappear() {
    let start = PerfLog.begin()
    isVisible = false
    documentWillChange()
    pendingEmojiPresentation = false
    // An offer to forget a word belongs to what was on screen.
    rootView.bar.hideNotice()
    resetDeleteGesture()
    engine.save(inBackground: true)
    recordDiagnostics()
    stopLevelUpdates()
    rootView.keys.cancelAllTouches()
    rootView.emoji?.cancelInteractions()
    // The keyboard reappears on the letters.
    rootView.releaseEmoji()
    PerfLog.end("disappear", start)
    PerfLog.flush("disappear")
  }

  /// Frees what the keyboard can draw again: the emoji images the picker and
  /// the search strip keep for scrolling back, and the font copy that drew them.
  public func didReceiveMemoryWarning() {
    PerfLog.event("memoryWarning")
    rootView.emoji?.releaseCachedImages()
    rootView.search.releaseCachedImages()
    EmojiFont.releaseCurrent()
  }

  public func documentDidChange() {
    let start = PerfLog.begin()
    defer { PerfLog.end("documentDidChange", start) }
    let traits = host?.inputTraits ?? InputTraits()
    // Even a did-change callback can carry the previous proxy snapshot. Any
    // reported host edit ends continuous observation of the original caret.
    documentWillChange()
    let identifier = host?.document.documentIdentifier
    let otherDocument = identifier != nil && searchDocument != nil && identifier != searchDocument
    if isSearching, traits != engine.traits || otherDocument {
      // Another field: its keyboard starts over, as after reappearing.
      emojiSearch = nil
      rootView.mode = .keys
    }
    if traits != engine.traits {
      engine.traits = traits
      engine.page = traits.keyboard == .numbersAndPunctuation ? .numbers : .letters
    }
    engine.documentDidChange()
    if deleteGestureOrigin != nil { validateDeleteGesture(reconcile: false) }
    sync()
    refreshTranscriptRecoveryIfNeeded()
  }

  /// A host callback can precede its updated proxy snapshot. Matching stale text
  /// must not authorize asynchronous insertion while the host is changing.
  public func documentWillChange() {
    dictationDestinationRevision &+= 1
    dictationInsertionGuard?.invalidate()
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
    if reportedLanguage != loadedLanguage {
      host?.setTypingLanguage(loadedLanguage.primaryLanguage)
      reportedLanguage = loadedLanguage
    }
    if isSearching {
      if layoutKey != "emojiSearch" {
        layoutKey = "emojiSearch"
        rootView.keys.setLayout(KeyboardLayout.emojiSearch(), style: rootView.style)
      } else if rootView.keys.style != rootView.style {
        rootView.keys.setLayout(rootView.keys.layout, style: rootView.style)
      }
      rootView.keys.shift = searchShift
      rootView.keys.returnEnabled = true
      return
    }
    let traits = engine.traits
    let needsGlobe = host?.needsInputModeSwitchKey ?? false
    // Resolve at each actual refresh so a live region change can invalidate the
    // decimal layout even when the host's input traits remain identical.
    let decimalSeparator = traits.keyboard == .decimalPad
      ? KeyboardLayout.resolvedDecimalSeparator(Locale.autoupdatingCurrent.decimalSeparator) : ""
    let key = "\(engine.page)|\(traits.keyboard)|\(traits.returnKey)|\(needsGlobe)|\(settings.digitHints)|\(decimalSeparator)"
    if key != layoutKey {
      layoutKey = key
      let layout = KeyboardLayout.make(page: engine.page, traits: traits, needsGlobe: needsGlobe, digitHints: settings.digitHints,
                                       decimalSeparator: decimalSeparator)
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
      let start = PerfLog.begin()
      self.barUpdateScheduled = false
      self.renderBar()
      PerfLog.end("bar", start)
      PerfLog.firstEvent("firstBar")
    }
  }

  /// The bar shows a delete swipe's preview, then Undo until the next edit,
  /// and otherwise suggestions.
  private func renderBar() {
    if let preview = deletionPreview {
      rootView.bar.showDeletionPreview(engine.traits.isPrivate ? nil : preview.text, words: preview.words)
      return
    }
    if let undo = wordDeletionUndo, engine.canUndo(undo) {
      rootView.bar.showUndo()
      return
    }
    wordDeletionUndo = nil
    rootView.bar.setSuggestions(engine.suggestions.slots)
  }

  private func recordDiagnostics() {
    let stats = rootView.keys.stats
    guard stats.touches > 0 else { return }
    let fields: [String: Int] = [
      "touches": stats.touches, "cancelled": stats.cancelled, "cancelledTapsKept": stats.cancelledTapsKept,
      "glides": stats.glides, "glideFallbacks": glideFallbacks, "cursorSlides": stats.cursorSlides,
      "deleteSwipes": stats.deleteSwipes,
      "rolled": stats.rolled, "slowTouches": stats.slowTouches, "maxTouchDelayMs": Int(stats.maxTouchDelayMs),
      "activations": stats.activations, "retargets": stats.retargets,
      "releaseRetargets": stats.releaseRetargets, "functionDrifts": stats.functionDrifts,
      "laggingContext": engine.laggingContextUpdates, "externalContext": engine.externalContextChanges,
    ]
    rootView.keys.stats = KeysView.Stats()
    Self.diagnosticsQueue.async {
      guard AppGroup.isWritable else { return }
      Diagnostics.record("keyboard", "session", fields)
    }
  }

  /// Letter centers in key pitches, from the key frames on screen. A docked
  /// one-handed grid has narrower pitches, so the same layout normalizes to the
  /// same geometry and taps and swipes keep their meaning.
  var letterGeometry: LetterGeometry? {
    let pitch = rootView.keys.pitch
    let centers = rootView.keys.letterCenters
    guard centers.count == 26, pitch.width > 1, rootView.keys.bounds.width > 0 else { return nil }
    return LetterGeometry(centers: centers.mapValues { KeyPoint(x: $0.x / pitch.width, y: $0.y / pitch.height) })
  }

  private func updateGeometry() {
    guard engine.page == .letters, !isSearching, let stack, let geometry = letterGeometry else { return }
    stack.setGeometry(geometry)
  }

  /// A point in the key grid, in key pitches.
  func normalized(_ point: CGPoint) -> KeyPoint {
    let pitch = rootView.keys.pitch
    return KeyPoint(x: point.x / pitch.width, y: point.y / pitch.height)
  }

  private func feedback(for key: Key) {
    haptics.key(function: key.style != .input)
    if settings.sounds { UIDevice.current.playInputClick() }
  }

  // MARK: Suggestions

  private func select(_ suggestion: Suggestion) {
    pendingEmojiPresentation = false
    flushDeferredDelete()
    wordDeletionUndo = nil
    engine.select(suggestion)
    sync()
  }

  private func forget(_ suggestion: Suggestion) {
    guard stack?.personal.forget(suggestion.text) == true else {
      // An uncertain persistence result may already have committed. Report
      // the missing confirmation without claiming that removal did not occur.
      let message = "Couldn't confirm removal. Try again."
      rootView.bar.showNotice(message)
      UIAccessibility.post(notification: .announcement, argument: message)
      return
    }
    stack?.personal.saveInBackground()
    engine.refreshSuggestions()
    sync()
  }

  // MARK: Delete gestures

  private func flushDeferredDelete() {
    guard deferredDelete else { return }
    guard validateDeleteGesture() else { return }
    deferredDelete = false
    engine.deleteBackward()
  }

  /// A held press belongs to its original field and privacy context. The engine
  /// distinguishes accepted host changes from its own delayed acknowledgments.
  @discardableResult
  private func validateDeleteGesture(reconcile: Bool = true) -> Bool {
    guard var origin = deleteGestureOrigin else { return false }
    guard isVisible, let host,
          host.document.documentIdentifier == origin.documentID,
          host.inputTraits.isPrivate == origin.isPrivate else {
      resetDeleteGesture()
      return false
    }
    if reconcile { engine.reconcileHostChanges() }
    if engine.externalContextChanges != origin.externalChanges {
      // A fresh same-field selection deliberately targets just that range.
      // A cursor move or external edit without a selection cancels the swipe.
      guard host.document.selectedText?.isEmpty == false else {
        resetDeleteGesture()
        return false
      }
      origin.externalChanges = engine.externalContextChanges
      deleteGestureOrigin = origin
    }
    return true
  }

  private func resetDeleteGesture() {
    rootView.keys.cancelDeleteTouches()
    deferredDelete = false
    deleteStartContext = nil
    deleteGestureOrigin = nil
    deletionPreview = nil
    wordDeletionUndo = nil
  }

  private func undoWordDeletion() {
    guard let undo = wordDeletionUndo else { return }
    wordDeletionUndo = nil
    engine.undo(undo)
    sync()
  }

  // MARK: Emoji

  private func showEmoji() {
    flushDeferredDelete()
    wordDeletionUndo = nil
    if rootView.emoji == nil {
      guard let catalog = emojiCatalog else {
        pendingEmojiPresentation = true
        return
      }
      let panel = EmojiPanelView(style: rootView.style, catalog: catalog, history: emojiHistory)
      panel.delegate = self
      if rootView.emojiOffset > 0 { panel.scrollOffset = rootView.emojiOffset }
      rootView.insertSubview(panel, belowSubview: rootView.dictation)
      rootView.emoji = panel
      rootView.setNeedsLayout()
      PerfLog.event("emojiPanelCreated")
    }
    rootView.mode = .emoji
    PerfLog.event("emojiPanelShown", after: 1)
  }

  // MARK: Emoji search

  /// The search row and its letter keys are showing.
  private var isSearching: Bool { emojiSearch != nil && rootView.mode == .emojiSearch }

  private func beginEmojiSearch() {
    guard emojiSuggester != nil else { return }
    emojiSearch = EmojiSearchQuery()
    searchShift = .off
    searchDocument = host?.document.documentIdentifier
    rootView.mode = .emojiSearch
    sync()
    refreshSearchResults()
  }

  /// Leaves search for the picker, or for the letters.
  private func endEmojiSearch(showingPanel: Bool) {
    guard emojiSearch != nil else { return }
    PerfLog.event("emojiSearchEnded")
    emojiSearch = nil
    searchShift = .off
    if showingPanel {
      showEmoji()
      // The picker is built again; place its grid before asking what it shows.
      rootView.layoutIfNeeded()
      rootView.emoji?.searchEnded()
    } else {
      engine.page = .letters
      rootView.mode = .keys
    }
    sync()
  }

  private func editSearch(_ edit: (inout EmojiSearchQuery) -> Void) {
    guard var query = emojiSearch else { return }
    edit(&query)
    guard query != emojiSearch else { return }
    emojiSearch = query
    refreshSearchResults()
  }

  private func typeInSearch(_ text: String) {
    let typed = searchShift.isActive ? text.uppercased() : text
    if case .once = searchShift {
      searchShift = .off
      rootView.keys.shift = .off
    }
    editSearch { $0.append(typed) }
  }

  private func refreshSearchResults() {
    guard let query = emojiSearch, let suggester = emojiSuggester else { return }
    rootView.search.show(query: query.text, results: EmojiSearch.results(for: query, suggester: suggester, history: emojiHistory))
  }

  /// A picked result goes into the document. Search stays open with its query,
  /// so several emoji can be added; the strip keeps its order meanwhile.
  private func insertSearchResult(_ result: EmojiSearchResult) {
    emojiHistory.use(result.value)
    engine.insertText(result.value)
    sync()
  }

  /// Search keys edit the query; ABC leaves for the letters.
  private func searchTouchDown(_ key: Key) {
    feedback(for: key)
    switch key.action {
    case .shift:
      searchShift = searchShift.isActive ? .off : .once(automatic: false)
      rootView.keys.shift = searchShift
    case .delete:
      editSearch { $0.deleteBackward() }
    case .page:
      endEmojiSearch(showingPanel: false)
    default:
      break
    }
  }

  private func searchActivate(_ key: Key) {
    switch key.action {
    case .character(let text), .text(let text):
      typeInSearch(text)
    case .space:
      editSearch { $0.append(" ") }
    case .emoji:
      endEmojiSearch(showingPanel: true)
    default:
      break
    }
  }

  // MARK: One-handed

  /// Docks the keys, switches sides or expands, and remembers the choice.
  private func chooseOneHanded(_ mode: OneHandedMode) {
    guard mode != rootView.oneHanded else { return }
    oneHandedStore.save(mode)
    rootView.oneHanded = mode
  }

  // MARK: Dictation

  private func startDictation() {
    pendingEmojiPresentation = false
    flushDeferredDelete()
    wordDeletionUndo = nil
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
    guard !dictationDestination.isPrivate else {
      showDictationRequirement("Choose a non-private field", detail: "Dictation can't insert into a private field.", action: nil, path: nil)
      return
    }
    let request = UUID()
    dictationOriginRequest = request
    dictationInsertionGuard = DictationInsertionGuard(origin: dictationDestination)
    bridge.pendingRequest = request
    bindDictationControls(to: request)
    rootView.dictation.onAction = nil
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
    dictationPanelRequest = nil
    rootView.dictation.onStop = nil
    rootView.dictation.onCancel = { [weak self] in self?.finishDictation() }
    rootView.dictation.set(.message(title: title, detail: detail, action: action))
    rootView.dictation.onAction = { [weak self] in
      guard let path else { return }
      self?.host?.openApp(URL(string: "\(AppGroup.urlScheme)://\(path)")!)
    }
  }

  private func bindDictationControls(to request: UUID) {
    dictationPanelRequest = request
    rootView.dictation.onStop = { [weak self] in self?.stopDictation(request: request) }
    rootView.dictation.onCancel = { [weak self] in self?.cancelDictation(request: request) }
  }

  private func stopDictation(request: UUID) {
    guard isVisible, let bridge, bridge.pendingRequest == request else { return }
    let state = bridge.readState()
    guard state.requestID == request, state.phase == .recording else { return }
    bridge.send(DictationCommand(kind: .stop, requestID: request))
    rootView.dictation.set(.transcribing)
    stopLevelUpdates()
  }

  private func cancelDictation(request: UUID) {
    guard isVisible else { return }
    guard let bridge, bridge.pendingRequest == request else {
      if dictationPanelRequest == request { finishDictation() }
      return
    }
    bridge.send(DictationCommand(kind: .cancel, requestID: request))
    bridge.pendingRequest = nil
    finishDictation()
  }

  private func finishDictation() {
    dictationInsertionGuard = nil
    dictationOriginRequest = nil
    dictationPanelRequest = nil
    rootView.dictation.onStop = nil
    rootView.dictation.onCancel = { [weak self] in self?.finishDictation() }
    rootView.dictation.onAction = nil
    emojiSearch = nil
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
      if rootView.mode == .dictation, dictationPanelRequest != nil || rootView.dictation.state == .transcribing || rootView.dictation.state == .connecting {
        finishDictation()
      }
      return
    }
    let state = bridge.readState()
    guard state.requestID == request else { return }
    bindDictationControls(to: request)
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
        guard dictationOriginRequest == request,
              dictationInsertionGuard?.allowsAutomaticInsertion(at: dictationDestination) == true,
              host?.hasFullAccess == true else {
          showTranscriptRecovery(request: request, updatedAt: state.updatedAt)
          return
        }
        bridge.markDelivered(request)
        engine.traits = host?.inputTraits ?? InputTraits()
        engine.insertTranscript(text)
      }
      bridge.pendingRequest = nil
      finishDictation()
    case .failed:
      stopLevelUpdates()
      bridge.pendingRequest = nil
      dictationInsertionGuard = nil
      dictationOriginRequest = nil
      dictationPanelRequest = nil
      rootView.mode = .dictation
      rootView.dictation.onStop = nil
      rootView.dictation.onCancel = { [weak self] in self?.finishDictation() }
      rootView.dictation.set(.message(title: "Couldn't transcribe", detail: state.errorMessage, action: "Try Again"))
      rootView.dictation.onAction = { [weak self] in self?.startDictation() }
    case .idle:
      bridge.pendingRequest = nil
      finishDictation()
    }
  }

  private var dictationDestination: DictationDestination {
    DictationDestination(document: engine.document, traits: host?.inputTraits ?? InputTraits())
  }

  private func refreshTranscriptRecoveryIfNeeded() {
    guard isVisible, let bridge, let request = bridge.pendingRequest else { return }
    let state = bridge.readState()
    guard state.requestID == request, state.phase == .finished,
          state.transcript != nil, !bridge.wasDelivered(request) else { return }
    showTranscriptRecovery(request: request, updatedAt: state.updatedAt)
  }

  private func showTranscriptRecovery(request: UUID, updatedAt: Date) {
    dictationInsertionGuard?.invalidate()
    stopLevelUpdates()
    rootView.mode = .dictation
    bindDictationControls(to: request)
    rootView.bar.setMicrophoneActive(false)
    let destination = dictationDestination
    let revision = dictationDestinationRevision
    let detail: String
    if host?.hasFullAccess != true {
      detail = "Your transcript is waiting. Allow Full Access to insert it. Cancel discards it."
    } else if destination.isPrivate {
      detail = "Your transcript is waiting. Choose a non-private field to insert it. Cancel discards it."
    } else if destination.hasSelection {
      detail = "Your transcript is waiting. Place the cursor without selecting text, then insert it. Cancel discards it."
    } else {
      detail = "Check the field and cursor, then insert your transcript here. Cancel discards it."
    }
    let canInsert = destination.allowsConfirmation && host?.hasFullAccess == true
    rootView.dictation.set(.message(title: "Transcript ready", detail: detail, action: canInsert ? "Insert Here" : nil))
    rootView.dictation.onAction = canInsert ? { [weak self] in
      self?.confirmTranscriptInsertion(request: request, updatedAt: updatedAt, destination: destination, revision: revision)
    } : nil
  }

  private func confirmTranscriptInsertion(request: UUID, updatedAt: Date, destination: DictationDestination, revision: UInt64) {
    guard isVisible, let bridge, bridge.pendingRequest == request else { return }
    let state = bridge.readState()
    guard state.requestID == request, state.phase == .finished,
          state.updatedAt == updatedAt, let text = state.transcript,
          !bridge.wasDelivered(request) else {
      dictationStateChanged()
      return
    }
    guard revision == dictationDestinationRevision, destination == dictationDestination,
          destination.allowsConfirmation, host?.hasFullAccess == true else {
      showTranscriptRecovery(request: request, updatedAt: state.updatedAt)
      return
    }
    bridge.markDelivered(request)
    bridge.pendingRequest = nil
    engine.traits = host?.inputTraits ?? InputTraits()
    engine.insertTranscript(text)
    finishDictation()
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
    if isSearching { return searchTouchDown(key) }
    let start = PerfLog.begin()
    defer { PerfLog.end("touchDown", start) }
    switch key.action {
    case .emoji: break
    default: pendingEmojiPresentation = false
    }
    // Keep edits in touch order: a held delete's pending action lands first.
    if key.action != .delete { flushDeferredDelete() }
    wordDeletionUndo = nil
    feedback(for: key)
    switch key.action {
    case .shift:
      engine.shiftDown()
    case .delete:
      deferredDelete = false
      engine.reconcileHostChanges()
      deleteStartContext = engine.contextBeforeCursor
      deleteGestureOrigin = DeleteGestureOrigin(
        documentID: host?.document.documentIdentifier,
        isPrivate: host?.inputTraits.isPrivate ?? engine.traits.isPrivate,
        externalChanges: engine.externalContextChanges)
      if engine.deleteUndoesLastEdit {
        deferredDelete = true
        return
      }
      engine.deleteBackward()
    case .page(let page):
      engine.page = page
    default:
      return
    }
    sync()
  }

  func keysView(_ view: KeysView, activate key: Key, at point: CGPoint) {
    if isSearching { return searchActivate(key) }
    let start = PerfLog.begin()
    defer { PerfLog.end(key.action == .space ? "activate.space" : "activate", start) }
    switch key.action {
    case .character(let text) where engine.traits.keyboard == .phonePad && engine.page != .letters:
      // One symbol at a time on the phone pad, then back to the digits.
      engine.insertCharacter(text)
      engine.page = .letters
    case .character(let text):
      let isLetter = text.count == 1 && text.first?.isLetter == true
      engine.insertCharacter(text, tap: isLetter && engine.page == .letters ? normalized(point) : nil)
    case .space:
      // A touch at the top of the space bar may have been a bottom-row letter.
      engine.insertSpace(tap: engine.page == .letters ? normalized(point) : nil)
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
    if isSearching { return typeInSearch(text) }
    if case .text = key.action {
      engine.insertText(text)
    } else {
      engine.insertCharacter(text)
    }
    sync()
  }

  func keysView(_ view: KeysView, glide points: [CGPoint], times: [TimeInterval], start: Key) {
    guard !isSearching else { return }
    let begin = PerfLog.begin()
    defer { PerfLog.end("glide", begin) }
    if engine.insertGlide(points.map(normalized), times: times).isEmpty, case .character(let text) = start.action {
      // No word fits the path: it was a sloppy tap, so type the key it started on.
      glideFallbacks += 1
      engine.insertCharacter(text, tap: points.first.map(normalized))
    }
    sync()
  }

  func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool) {
    if settings.sounds { UIDevice.current.playInputClick() }
    if isSearching { return editSearch { wholeWord ? $0.deleteWordsBackward(1) : $0.deleteBackward() } }
    guard validateDeleteGesture() else { return sync() }
    if deferredDelete {
      // The held press acts now; repeat continues from here.
      flushDeferredDelete()
      sync()
      return
    }
    if wholeWord { engine.deleteWordBackward() } else { engine.deleteBackward() }
    sync()
  }

  func keysView(_ view: KeysView, moveCursor offset: Int) {
    // The search field has no cursor; the document's must not move behind it.
    guard !isSearching else { return }
    host?.adjustTextPosition(byCharacterOffset: offset)
    haptics.tick()
  }

  func keysViewShiftUp(_ view: KeysView) {
    guard !isSearching else { return }
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

  func keysViewDeleteEnded(_ view: KeysView) {
    guard !isSearching else { return }
    let needsSync = deferredDelete
    if deferredDelete { flushDeferredDelete() }
    deleteGestureOrigin = nil
    deleteStartContext = nil
    if needsSync { sync() }
  }

  func keysView(_ view: KeysView, previewWordDeletion words: Int) {
    if isSearching { return }
    guard validateDeleteGesture() else { return renderBar() }
    // A swipe replaces the press's own action, including undoing a correction.
    deferredDelete = false
    let text = words > 0 ? engine.wordDeletionPreview(words: words) : ""
    deletionPreview = text.isEmpty ? nil : (text, words)
    if words > 0 { haptics.tick() }
    renderBar()
  }

  func keysView(_ view: KeysView, commitWordDeletion words: Int) {
    if isSearching { return editSearch { $0.deleteWordsBackward(words) } }
    guard validateDeleteGesture() else { return sync() }
    deferredDelete = false
    deletionPreview = nil
    deleteGestureOrigin = nil
    wordDeletionUndo = engine.deleteWordsBackward(words, originalContext: deleteStartContext)
    deleteStartContext = nil
    sync()
  }

  var keysViewAllowsGlide: Bool { !isSearching && stack != nil && engine.policy.allowsGlide && engine.page == .letters }
  var keysViewAllowsCursorMovement: Bool { !isSearching }
  var keysViewShowsPopups: Bool { settings.keyPopups }
  var keysViewOneHandedMode: OneHandedMode? { rootView.canDock ? rootView.oneHanded : nil }

  func keysView(_ view: KeysView, chooseOneHanded mode: OneHandedMode) {
    chooseOneHanded(mode)
  }
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

  func emojiPanelSearch(_ panel: EmojiPanelView) {
    beginEmojiSearch()
  }

  func emojiPanelClose(_ panel: EmojiPanelView) {
    PerfLog.event("emojiClosed")
    rootView.mode = .keys
    sync()
    PerfLog.event("emojiClosedSettled", after: 1)
  }
}
#endif
