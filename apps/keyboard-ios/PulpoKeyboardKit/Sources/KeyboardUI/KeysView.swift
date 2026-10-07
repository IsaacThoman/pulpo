#if os(iOS)
import UIKit

protocol KeysViewDelegate: AnyObject {
  /// Every key press, on touch down: feedback, shift, first delete, page switches.
  func keysView(_ view: KeysView, touchDown key: Key)
  /// A completed tap, on touch up. `point` is in the keys view.
  func keysView(_ view: KeysView, activate key: Key, at point: CGPoint)
  func keysView(_ view: KeysView, insertAlternate text: String, for key: Key)
  /// A swipe. `start` is the key it began on, typed instead if no word fits.
  func keysView(_ view: KeysView, glide points: [CGPoint], start: Key)
  func keysViewRepeatDelete(_ view: KeysView, wholeWord: Bool)
  func keysView(_ view: KeysView, moveCursor offset: Int)
  func keysViewShiftUp(_ view: KeysView)
  func keysView(_ view: KeysView, inputModeListWith event: UIEvent)
  /// A key was picked by sliding off 123/ABC; the page should switch back.
  func keysViewFinishedPageSlide(_ view: KeysView)
  /// Key frames changed; spatial models need the new centers.
  func keysViewDidLayout(_ view: KeysView)
  var keysViewAllowsGlide: Bool { get }
  var keysViewShowsPopups: Bool { get }
}

/// The key grid. Handles all touches itself so typing is never delayed by gesture
/// recognizers, supports rolling multi-finger typing, swipes, accents, space-bar
/// cursor control and delete repeat.
final class KeysView: UIView {
  weak var delegate: KeysViewDelegate?
  weak var popupHost: UIView?
  private(set) var layout: KeyboardLayout
  private(set) var style: KeyboardStyle
  private(set) var keyViews: [KeyView] = []
  private var hitRects: [CGRect] = []
  private(set) var pitch: CGSize = CGSize(width: 1, height: 1)
  private let trail = GlideTrail()
  private var popup: KeyPopupView?
  private var trackings: [ObjectIdentifier: Tracking] = [:]

  var shift: ShiftState = .off { didSet { keyViews.forEach { $0.shift = shift } } }
  var returnEnabled = true { didSet { keyViews.filter { $0.key.action == .returnKey }.forEach { $0.isEnabled = returnEnabled } } }

  /// Touch counts for on-device diagnostics; no text is recorded.
  struct Stats: Codable {
    var touches = 0
    var cancelled = 0
    var cancelledTapsKept = 0
    var glides = 0
    var cursorSlides = 0
    var rolled = 0
    var activations = 0
    var retargets = 0
    var releaseRetargets = 0
    var functionDrifts = 0
    var maxTouchDelayMs = 0.0
    var slowTouches = 0
  }
  var stats = Stats()

  private final class Tracking {
    enum Mode { case tap, glide, alternates, cursor, delete, inputMode }
    let touch: UITouch
    let began = CACurrentMediaTime()
    var keyIndex: Int
    var key: Key
    let initialKey: Key
    var rejectedFunctionDrift = false
    let start: CGPoint
    var points: [CGPoint]
    var mode: Mode = .tap
    var timer: Timer?
    var cursorAnchor: CGFloat = 0
    var repeats = 0
    var committed = false
    var fromPageKey = false
    var cursorMoved = false
    /// How many points the trail has drawn.
    var trailed = 0

    init(touch: UITouch, keyIndex: Int, key: Key, start: CGPoint) {
      self.touch = touch
      self.keyIndex = keyIndex
      self.key = key
      initialKey = key
      self.start = start
      points = [start]
    }
  }

  init(layout: KeyboardLayout, style: KeyboardStyle) {
    self.layout = layout
    self.style = style
    super.init(frame: .zero)
    isMultipleTouchEnabled = true
    isExclusiveTouch = false
    layer.addSublayer(trail.layer)
    rebuild()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  func setLayout(_ layout: KeyboardLayout, style: KeyboardStyle) {
    let styleChanged = style != self.style
    self.style = style
    if layout != self.layout {
      self.layout = layout
      rebuild()
    } else if styleChanged {
      keyViews.forEach { $0.applyStyle(style) }
      setNeedsLayout()
    }
    trail.color = style.trail
  }

  private func rebuild() {
    layoutGeneration += 1
    keyViews.forEach { $0.removeFromSuperview() }
    keyViews = layout.rows.flatMap(\.keys).map { key in
      let view = KeyView(key: key, style: style)
      view.shift = shift
      if key.action == .returnKey { view.isEnabled = returnEnabled }
      insertSubview(view, at: 0)
      return view
    }
    trail.color = style.trail
    setNeedsLayout()
    layoutIfNeeded()
  }

  // MARK: Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    let width = bounds.width
    guard width > 0 else { return }
    let margin = style.sideMargin(width: width)
    let gap = style.keyGap
    let columns: CGFloat = layout.isNumberPad ? 3 : 10
    let unit = (width - 2 * margin + gap) / columns
    pitch = CGSize(width: unit, height: style.keyHeight + style.rowGap)
    var frames: [CGRect] = []
    for (rowIndex, row) in layout.rows.enumerated() {
      let y = style.topPadding + CGFloat(rowIndex) * pitch.height
      frames += rowFrames(row, y: y, width: width, margin: margin, unit: unit, gap: gap)
    }
    hitRects = []
    var index = 0
    for (rowIndex, row) in layout.rows.enumerated() {
      for column in row.keys.indices {
        var rect = frames[index].insetBy(dx: -gap / 2, dy: -style.rowGap / 2)
        if column == 0 { rect = CGRect(x: 0, y: rect.minY, width: rect.maxX, height: rect.height) }
        if column == row.keys.count - 1 { rect.size.width = width - rect.minX }
        if rowIndex == 0 { rect = CGRect(x: rect.minX, y: 0, width: rect.width, height: rect.maxY) }
        if rowIndex == layout.rows.count - 1 { rect.size.height = bounds.height - rect.minY }
        hitRects.append(rect)
        keyViews[index].frame = frames[index]
        index += 1
      }
    }
    trail.layer.frame = bounds
    if bounds.size != lastLaidOutSize || layoutGeneration != lastNotifiedGeneration {
      lastLaidOutSize = bounds.size
      lastNotifiedGeneration = layoutGeneration
      delegate?.keysViewDidLayout(self)
    }
  }

  private var lastLaidOutSize: CGSize = .zero
  private var layoutGeneration = 0
  private var lastNotifiedGeneration = -1

  private func rowFrames(_ row: KeyRow, y: CGFloat, width: CGFloat, margin: CGFloat, unit: CGFloat, gap: CGFloat) -> [CGRect] {
    let height = style.keyHeight
    let keys = row.keys
    if row.edgeGap > 0, keys.count >= 3 {
      // Shift and delete stand apart; the middle keys stay centered on the grid.
      let middle = keys[1..<(keys.count - 1)]
      let middleWidth = middle.reduce(0) { $0 + $1.width * unit } - gap
      var x = (width - middleWidth) / 2
      let edgeGap = gap + row.edgeGap * unit
      var frames = [CGRect(x: margin, y: y, width: x - edgeGap - margin, height: height)]
      for key in middle {
        frames.append(CGRect(x: x, y: y, width: key.width * unit - gap, height: height))
        x += key.width * unit
      }
      let rightX = x - gap + edgeGap
      frames.append(CGRect(x: rightX, y: y, width: width - margin - rightX, height: height))
      return frames
    }
    let content = width - 2 * margin - 2 * row.inset * unit
    let fixed = keys.filter { !$0.flexible }.reduce(0) { $0 + $1.width * unit - gap }
    let flexibleCount = CGFloat(keys.filter(\.flexible).count)
    let gaps = CGFloat(keys.count - 1) * gap
    let flexibleWidth = flexibleCount > 0 ? max(0, (content - fixed - gaps) / flexibleCount) : 0
    let used = fixed + gaps + flexibleWidth * flexibleCount
    var x = margin + row.inset * unit + max(0, (content - used) / 2)
    return keys.map { key in
      let keyWidth = key.flexible ? flexibleWidth : key.width * unit - gap
      defer { x += keyWidth + gap }
      return CGRect(x: x, y: y, width: keyWidth, height: height)
    }
  }

  /// Letter key centers, for the spatial models.
  var letterCenters: [Character: CGPoint] {
    var centers: [Character: CGPoint] = [:]
    for view in keyViews {
      if case .character(let text) = view.key.action, text.count == 1, let letter = text.first, letter.isLetter, letter.isASCII {
        centers[letter] = CGPoint(x: view.frame.midX, y: view.frame.midY)
      }
    }
    return centers
  }

  func keyIndex(at point: CGPoint) -> Int? {
    if let hit = hitRects.firstIndex(where: { $0.contains(point) }) { return hit }
    var best: (Int, CGFloat)?
    for (index, view) in keyViews.enumerated() {
      let dx = point.x - view.frame.midX
      let dy = point.y - view.frame.midY
      let distance = dx * dx + dy * dy
      if best == nil || distance < best!.1 { best = (index, distance) }
    }
    return best?.0
  }

  /// A thumb rolls as it lifts. Keep the pressed key inside a small margin around
  /// its hit area; deliberate slides and slides from 123 can still choose a new key.
  private func tapIndex(_ tracking: Tracking, at point: CGPoint) -> Int? {
    if !tracking.fromPageKey, hitRects.indices.contains(tracking.keyIndex),
       hitRects[tracking.keyIndex].insetBy(dx: -pitch.width * 0.2, dy: -pitch.height * 0.15).contains(point) {
      return tracking.keyIndex
    }
    guard let index = keyIndex(at: point) else { return nil }
    if index != tracking.keyIndex, !tracking.fromPageKey, !keyViews[index].key.isCharacter {
      // Shift/delete act on touch down. Moving a letter onto a control at lift
      // must not silently eat or replace that letter.
      if tracking.initialKey.isCharacter, !tracking.rejectedFunctionDrift {
        tracking.rejectedFunctionDrift = true
        stats.functionDrifts += 1
      }
      return tracking.keyIndex
    }
    return index
  }

  private func activate(_ key: Key, at point: CGPoint) {
    stats.activations += 1
    delegate?.keysView(self, activate: key, at: point)
  }

  // MARK: Touches

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches.sorted(by: { $0.timestamp < $1.timestamp }) { begin(touch, event: event) }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches {
      guard let tracking = trackings[ObjectIdentifier(touch)] else { continue }
      let samples = event?.coalescedTouches(for: touch) ?? [touch]
      for sample in samples { tracking.points.append(sample.location(in: self)) }
      move(tracking, to: touch.location(in: self), event: event)
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches.sorted(by: { (trackings[ObjectIdentifier($0)]?.began ?? 0) < (trackings[ObjectIdentifier($1)]?.began ?? 0) }) {
      guard let tracking = trackings.removeValue(forKey: ObjectIdentifier(touch)) else { continue }
      end(tracking, at: touch.location(in: self), event: event, cancelled: false)
    }
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    for touch in touches.sorted(by: { (trackings[ObjectIdentifier($0)]?.began ?? 0) < (trackings[ObjectIdentifier($1)]?.began ?? 0) }) {
      guard let tracking = trackings.removeValue(forKey: ObjectIdentifier(touch)) else { continue }
      end(tracking, at: touch.location(in: self), event: event, cancelled: true)
    }
  }

  private func begin(_ touch: UITouch, event: UIEvent?) {
    stats.touches += 1
    // How long the system held the touch before delivering it.
    let delay = (ProcessInfo.processInfo.systemUptime - touch.timestamp) * 1000
    stats.maxTouchDelayMs = max(stats.maxTouchDelayMs, delay)
    if delay > 50 { stats.slowTouches += 1 }
    // A second finger during a swipe is a stray palm; ignore it.
    if trackings.values.contains(where: { $0.mode == .glide }) { return }
    let point = touch.location(in: self)
    // Commit earlier text before handling the new key, including spaces and before
    // touch-down actions such as delete/page. A committed finger is inert until lift.
    for other in trackings.values.sorted(by: { $0.began < $1.began }) where other.mode == .tap && !other.committed {
      switch other.key.action {
      case .character, .space, .returnKey, .text:
        stats.rolled += 1
        commitTap(other, at: other.points.last ?? other.start)
      default:
        break
      }
    }
    // Committing a space can return from symbols to letters; hit-test that layout.
    guard let index = keyIndex(at: point) else { return }
    let key = keyViews[index].key
    let tracking = Tracking(touch: touch, keyIndex: index, key: key, start: point)
    trackings[ObjectIdentifier(touch)] = tracking
    switch key.action {
    case .nextKeyboard:
      tracking.mode = .inputMode
      keyViews[index].isPressed = true
      if let event { delegate?.keysView(self, inputModeListWith: event) }
      return
    case .delete:
      tracking.mode = .delete
      keyViews[index].isPressed = true
      delegate?.keysView(self, touchDown: key)
      tracking.timer = schedule(after: 0.45) { [weak self] in self?.repeatDelete(tracking) }
      return
    case .page:
      delegate?.keysView(self, touchDown: key)
      tracking.fromPageKey = true
      tracking.keyIndex = keyIndex(at: point) ?? index
      keyViews[tracking.keyIndex].isPressed = true
      return
    case .space:
      keyViews[index].isPressed = true
      delegate?.keysView(self, touchDown: key)
      tracking.timer = schedule(after: 0.5) { [weak self] in self?.enterCursorMode(tracking) }
      return
    default:
      break
    }
    keyViews[index].isPressed = true
    delegate?.keysView(self, touchDown: key)
    showPreview(for: index)
    scheduleAlternates(tracking)
  }

  private func move(_ tracking: Tracking, to point: CGPoint, event: UIEvent?) {
    guard !tracking.committed else { return }
    switch tracking.mode {
    case .inputMode:
      if let event { delegate?.keysView(self, inputModeListWith: event) }
    case .alternates:
      if let popup, let host = popupHost { popup.track(x: convert(point, to: host).x) }
    case .cursor:
      let step: CGFloat = 9
      let offset = Int(((point.x - tracking.cursorAnchor) / step).rounded(.towardZero))
      if offset != 0 {
        tracking.cursorAnchor += CGFloat(offset) * step
        tracking.cursorMoved = true
        delegate?.keysView(self, moveCursor: offset)
      }
    case .delete:
      break
    case .glide:
      trail.add(tracking.points[tracking.trailed...])
      tracking.trailed = tracking.points.count
    case .tap:
      let key = tracking.key
      let dx = point.x - tracking.start.x
      let dy = point.y - tracking.start.y
      if key.action == .space {
        // A thumb tap drifts; only a deliberate slide moves the cursor.
        if abs(dx) > 30 { enterCursorMode(tracking) }
        return
      }
      let distance = (dx * dx + dy * dy).squareRoot()
      // Fast taps roll a few points; a swipe has to clearly leave the key.
      if isLetter(key), !tracking.fromPageKey, !trackings.values.contains(where: { $0 !== tracking && !$0.committed }), delegate?.keysViewAllowsGlide == true, distance > pitch.width * 0.7 {
        startGlide(tracking)
        return
      }
      // Without a swipe, sliding moves the press to the key under the finger.
      guard let index = tapIndex(tracking, at: point), index != tracking.keyIndex else { return }
      let next = keyViews[index].key
      guard next.isCharacter || tracking.fromPageKey || key.isCharacter else { return }
      keyViews[tracking.keyIndex].isPressed = false
      tracking.timer?.invalidate()
      tracking.keyIndex = index
      tracking.key = next
      stats.retargets += 1
      keyViews[index].isPressed = true
      if next.isCharacter {
        showPreview(for: index)
        scheduleAlternates(tracking)
      } else {
        popup?.hide()
      }
    }
  }

  private func end(_ tracking: Tracking, at point: CGPoint, event: UIEvent?, cancelled: Bool) {
    tracking.timer?.invalidate()
    guard !tracking.committed else { return }
    let view = keyViews.indices.contains(tracking.keyIndex) ? keyViews[tracking.keyIndex] : nil
    view?.isPressed = false
    let key = tracking.key
    switch tracking.mode {
    case .inputMode:
      if let event { delegate?.keysView(self, inputModeListWith: event) }
    case .alternates:
      if !cancelled, let text = popup?.selectedOption { delegate?.keysView(self, insertAlternate: text, for: key) }
      popup?.hide()
    case .cursor:
      keyViews.forEach { $0.isDimmed = false }
      // A long press on space that never moved the cursor still types the space.
      if !cancelled, !tracking.cursorMoved, key.action == .space {
        activate(key, at: point)
      }
    case .delete:
      break
    case .glide:
      trail.finish()
      if !cancelled {
        let length = zip(tracking.points, tracking.points.dropFirst()).reduce(0) { $0 + hypot($1.1.x - $1.0.x, $1.1.y - $1.0.y) }
        if length > pitch.width * 1.2 {
          delegate?.keysView(self, glide: tracking.points, start: key)
        } else {
          activate(key, at: tracking.start)
        }
      }
    case .tap:
      popup?.hide()
      var key = key
      // Apply the same tap margin when no move event arrived before release.
      if !cancelled, let index = tapIndex(tracking, at: point), index != tracking.keyIndex, keyViews[index].key.isCharacter,
         tracking.fromPageKey || key.isCharacter {
        key = keyViews[index].key
        stats.releaseRetargets += 1
      }
      if key.action == .shift {
        delegate?.keysViewShiftUp(self)
        return
      }
      if cancelled {
        stats.cancelled += 1
        // A short, still tap the system took over was still meant as a keystroke.
        let still = hypot(point.x - tracking.start.x, point.y - tracking.start.y) < 12
        guard key.isCharacter, still, CACurrentMediaTime() - tracking.began < 0.35 else { return }
        stats.cancelledTapsKept += 1
      }
      if case .page = key.action, tracking.fromPageKey { return }
      let tapPoint = !tracking.fromPageKey && key == tracking.initialKey ? tracking.start : point
      activate(key, at: tapPoint)
      if tracking.fromPageKey, key.isCharacter { delegate?.keysViewFinishedPageSlide(self) }
    }
  }

  private func commitTap(_ tracking: Tracking, at point: CGPoint) {
    tracking.committed = true
    tracking.timer?.invalidate()
    keyViews[tracking.keyIndex].isPressed = false
    popup?.hide()
    let tapPoint = !tracking.fromPageKey && tracking.key == tracking.initialKey ? tracking.start : point
    activate(tracking.key, at: tapPoint)
  }

  private func isLetter(_ key: Key) -> Bool {
    if case .character(let text) = key.action, text.count == 1, let first = text.first { return first.isLetter && first.isASCII }
    return false
  }

  private func startGlide(_ tracking: Tracking) {
    stats.glides += 1
    tracking.mode = .glide
    tracking.timer?.invalidate()
    keyViews[tracking.keyIndex].isPressed = false
    popup?.hide()
    trail.begin()
    trail.add(tracking.points[...])
    tracking.trailed = tracking.points.count
  }

  private func enterCursorMode(_ tracking: Tracking) {
    guard tracking.mode == .tap else { return }
    stats.cursorSlides += 1
    tracking.mode = .cursor
    tracking.timer?.invalidate()
    tracking.cursorAnchor = tracking.points.last?.x ?? tracking.start.x
    keyViews.forEach { $0.isDimmed = true }
    KeyboardFeedback.current?.emphasis()
  }

  private func repeatDelete(_ tracking: Tracking) {
    guard trackings[ObjectIdentifier(tracking.touch)] != nil else { return }
    tracking.repeats += 1
    // After a short run of characters, delete whole words, like the system keyboard.
    let wholeWord = tracking.repeats > 14
    delegate?.keysViewRepeatDelete(self, wholeWord: wholeWord)
    tracking.timer = schedule(after: wholeWord ? 0.24 : 0.085) { [weak self] in self?.repeatDelete(tracking) }
  }

  private func scheduleAlternates(_ tracking: Tracking) {
    let key = keyViews[tracking.keyIndex].key
    guard !key.alternates.isEmpty else { return }
    tracking.timer?.invalidate()
    tracking.timer = schedule(after: 0.42) { [weak self] in
      guard let self, tracking.mode == .tap, !tracking.committed else { return }
      self.showAlternates(for: tracking)
    }
  }

  private func showAlternates(for tracking: Tracking) {
    guard let host = popupHost else { return }
    let view = keyViews[tracking.keyIndex]
    let upper = shift.isActive
    var options = view.key.alternates
    if case .character(let base) = view.key.action, view.key.hint == nil { options.insert(base, at: 0) }
    if case .text(let base) = view.key.action { options.insert(base, at: 0) }
    options = options.map { upper && $0.first?.isLetter == true ? $0.uppercased() : $0 }
    tracking.mode = .alternates
    let popup = ensurePopup(in: host)
    popup.showAlternates(options, keyRect: convert(view.frame, to: host), in: host.bounds, style: style)
    if let point = tracking.points.last { popup.track(x: convert(point, to: host).x) }
    KeyboardFeedback.current?.emphasis()
  }

  private func showPreview(for index: Int) {
    guard delegate?.keysViewShowsPopups == true, !style.landscape, let host = popupHost else { return }
    let view = keyViews[index]
    guard case .character(let text) = view.key.action, !layout.isNumberPad else {
      popup?.hide()
      return
    }
    let shown = shift.isActive && text.first?.isLetter == true ? text.uppercased() : text
    ensurePopup(in: host).showPreview(shown, keyRect: convert(view.frame, to: host), in: host.bounds, style: style)
  }

  private func ensurePopup(in host: UIView) -> KeyPopupView {
    if let popup, popup.superview === host { return popup }
    let created = KeyPopupView(style: style)
    host.addSubview(created)
    popup = created
    return created
  }

  func cancelAllTouches() {
    for tracking in trackings.values { tracking.timer?.invalidate() }
    trackings = [:]
    keyViews.forEach { $0.isPressed = false; $0.isDimmed = false }
    popup?.hide()
    trail.finish()
  }

  private func schedule(after delay: TimeInterval, _ action: @escaping @MainActor () -> Void) -> Timer {
    let timer = Timer(timeInterval: delay, repeats: false) { _ in MainActor.assumeIsolated { action() } }
    RunLoop.main.add(timer, forMode: .common)
    return timer
  }

  #if DEBUG
  /// Shows a key's balloon without a touch, for screenshot tests.
  func debugShowPreview(_ identifier: String) {
    guard let index = keyViews.firstIndex(where: { $0.key.identifier == identifier }) else { return }
    keyViews[index].isPressed = true
    showPreview(for: index)
  }
  #endif

  func activateForAccessibility(_ view: KeyView) {
    delegate?.keysView(self, touchDown: view.key)
    if view.key.action == .shift { delegate?.keysViewShiftUp(self); return }
    if case .page = view.key.action { return }
    if view.key.action == .delete { return }
    delegate?.keysView(self, activate: view.key, at: CGPoint(x: view.frame.midX, y: view.frame.midY))
  }
}

/// The fading line drawn under a swipe.
final class GlideTrail {
  let layer = CAShapeLayer()
  private var points: [(CGPoint, CFTimeInterval)] = []
  private var link: CADisplayLink?
  var color: UIColor = .systemBlue { didSet { layer.strokeColor = color.cgColor } }
  static let lifetime: CFTimeInterval = 0.32

  init() {
    layer.fillColor = nil
    layer.lineWidth = 6
    layer.lineCap = .round
    layer.lineJoin = .round
    layer.strokeColor = color.cgColor
    layer.zPosition = 10
  }

  func begin() {
    points = []
    layer.removeAllAnimations()
    layer.opacity = 1
    if link == nil {
      let target = DisplayLinkTarget { [weak self] in self?.redraw() }
      let link = CADisplayLink(target: target, selector: #selector(DisplayLinkTarget.tick))
      link.add(to: .main, forMode: .common)
      self.link = link
    }
  }

  func add(_ new: ArraySlice<CGPoint>) {
    let now = CACurrentMediaTime()
    for point in new { points.append((point, now)) }
    redraw()
  }

  private func redraw() {
    let now = CACurrentMediaTime()
    points.removeAll { now - $0.1 > Self.lifetime }
    let path = UIBezierPath()
    if let first = points.first {
      path.move(to: first.0)
      for point in points.dropFirst() { path.addLine(to: point.0) }
    }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    layer.path = path.cgPath
    CATransaction.commit()
  }

  func finish() {
    link?.invalidate()
    link = nil
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1
    fade.toValue = 0
    fade.duration = 0.18
    layer.opacity = 0
    layer.add(fade, forKey: "fade")
    points = []
  }
}

private final class DisplayLinkTarget: NSObject {
  let action: @MainActor () -> Void

  init(_ action: @escaping @MainActor () -> Void) {
    self.action = action
  }

  @objc func tick() {
    MainActor.assumeIsolated { action() }
  }
}
#endif
