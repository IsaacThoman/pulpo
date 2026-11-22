import AppKit
import QuartzCore

/// The agent's own pointer: a yellow arrow drawn in a small window of the helper's that glides to
/// wherever an action lands. It never takes clicks or the keyboard.
///
/// It is ordered just above the window being worked on, at that window's level, so that a window
/// the user brings in front covers the pointer along with the window it belongs to.
final class AgentPointer {
  static let shared = AgentPointer()

  /// The hot spot (the arrow's tip) sits at the middle of the panel, which leaves room for the
  /// click ring around it.
  private static let panelSize: CGFloat = 72
  private static let glideDuration: TimeInterval = 0.2
  private static let hideDelay: TimeInterval = 4

  private var panel: NSPanel?
  private var view: PointerView?
  private var hideTimer: Timer?
  private var glideTimer: Timer?
  /// Where the hot spot is, in window-server coordinates (y down). Main thread only.
  private var position: CGPoint?
  private var visible = false

  private final class Panel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
  }

  // MARK: Called from request threads; each hops to the main thread.

  /// Glides to `point` (window-server coordinates) above `window` and returns once it is there.
  func move(to point: CGPoint, above window: CGWindow) {
    let duration = onMain { () -> TimeInterval in
      let panel = makePanel()
      let from = visible ? position : nil
      order(panel, above: window)
      if let from, from != point {
        glide(panel, from: from, to: point)
      } else {
        stopGlide()
        place(panel, at: point)
      }
      show(panel)
      scheduleHide()
      return from == nil || from == point ? 0 : Self.glideDuration
    }
    if duration > 0 { Thread.sleep(forTimeInterval: duration + 0.02) }
  }

  /// Follows a drag without animating; the drag itself is the motion.
  func follow(_ point: CGPoint) {
    DispatchQueue.main.async { [self] in
      guard let panel else { return }
      stopGlide()
      place(panel, at: point)
    }
  }

  func pulse() {
    DispatchQueue.main.async { [self] in view?.pulse() }
  }

  /// Keeps it on screen while the agent works with the keyboard; it does not move.
  func touch() {
    DispatchQueue.main.async { [self] in if visible { scheduleHide() } }
  }

  func release() {
    onMain {
      hideTimer?.invalidate()
      hideTimer = nil
      stopGlide()
      visible = false
      panel?.orderOut(nil)
      panel?.alphaValue = 1
    }
  }

  /// The panel's window number and frame, for checks.
  var debugState: (number: Int, frame: CGRect, visible: Bool)? {
    onMain { panel.map { ($0.windowNumber, $0.frame, visible) } }
  }

  // MARK: Main thread

  private func makePanel() -> NSPanel {
    if let panel { return panel }
    let size = Self.panelSize
    let panel = Panel(contentRect: CGRect(x: 0, y: 0, width: size, height: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.ignoresMouseEvents = true
    panel.isReleasedWhenClosed = false
    panel.hidesOnDeactivate = false
    panel.becomesKeyOnlyIfNeeded = true
    panel.animationBehavior = .none
    panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenAuxiliary]
    // The helper's own snapshots are of one window alone, so they never show the panel. The user's
    // screenshots, recordings and screen sharing do: whoever watches should see what the agent does.
    panel.sharingType = .readOnly
    let view = PointerView(frame: CGRect(x: 0, y: 0, width: size, height: size))
    panel.contentView = view
    self.panel = panel
    self.view = view
    return panel
  }

  private func place(_ panel: NSPanel, at point: CGPoint) {
    position = point
    panel.setFrameOrigin(origin(for: point))
  }

  /// Moves the panel itself, frame by frame, with an ease-out curve. AppKit's own window-frame
  /// animation follows the display's refresh and does not move at all while the display is asleep
  /// or locked; a timer does, so the pointer is always where the action lands when it lands.
  private func glide(_ panel: NSPanel, from: CGPoint, to: CGPoint) {
    stopGlide()
    let start = CACurrentMediaTime()
    let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] timer in
      guard let self else { return timer.invalidate() }
      let progress = min(1, (CACurrentMediaTime() - start) / Self.glideDuration)
      let eased = 1 - pow(1 - progress, 3)
      self.place(panel, at: CGPoint(x: from.x + (to.x - from.x) * eased, y: from.y + (to.y - from.y) * eased))
      if progress >= 1 { self.stopGlide() }
    }
    glideTimer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func stopGlide() {
    glideTimer?.invalidate()
    glideTimer = nil
  }

  /// The panel's AppKit origin (y up) that puts the hot spot at `point` (y down).
  private func origin(for point: CGPoint) -> CGPoint {
    let half = Self.panelSize / 2
    return CGPoint(x: point.x - half, y: Screens.mainHeight - point.y - half)
  }

  /// Just above the target window and at its level. The window server orders a window relative to
  /// another process's window when asked by number; a window number it does not know leaves the
  /// panel where it was, so then it floats above everything instead of disappearing.
  private func order(_ panel: NSPanel, above window: CGWindow) {
    let level = NSWindow.Level(rawValue: window.layer)
    if panel.level != level { panel.level = level }
    panel.order(.above, relativeTo: Int(window.id))
    // The window list shows the new order only once this turn of the main loop is over.
    let id = window.id
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self, self.visible, let panel = self.panel, panel.level == level, !self.isOrdered(panel, above: id) else { return }
      log("the pointer could not be ordered above window \(id); it floats above all windows instead")
      panel.level = .floating
      panel.orderFrontRegardless()
    }
  }

  private func isOrdered(_ panel: NSPanel, above window: CGWindowID) -> Bool {
    let onScreen = Windows.list(.optionOnScreenOnly).map(\.id)
    guard let own = onScreen.firstIndex(of: CGWindowID(panel.windowNumber)) else { return false }
    // A target that is not on screen (another Space) has nothing to be above.
    guard let target = onScreen.firstIndex(of: window) else { return true }
    return own < target
  }

  private func show(_ panel: NSPanel) {
    if !visible || panel.alphaValue < 1 {
      // A zero-length animation replaces a fade that may still be running.
      NSAnimationContext.runAnimationGroup { context in
        context.duration = 0
        panel.animator().alphaValue = 1
      }
      panel.alphaValue = 1
    }
    visible = true
  }

  private func scheduleHide() {
    hideTimer?.invalidate()
    hideTimer = Timer.scheduledTimer(withTimeInterval: Self.hideDelay, repeats: false) { [weak self] _ in
      guard let self, let panel = self.panel else { return }
      self.visible = false
      NSAnimationContext.runAnimationGroup({ context in
        context.duration = 0.3
        panel.animator().alphaValue = 0
      }, completionHandler: { [weak self] in
        // An action may have shown it again while it faded.
        guard let self, !self.visible else { return }
        self.panel?.orderOut(nil)
        self.panel?.alphaValue = 1
      })
    }
  }
}

/// Draws the arrow with Core Animation layers so the click ring can animate on its own.
private final class PointerView: NSView {
  private let arrow = CAShapeLayer()
  private let ring = CAShapeLayer()

  /// A system-style arrow, about 1.3 times the size of the standard one, tip at (0, 0), y down.
  private static let arrowPoints: [CGPoint] = [
    CGPoint(x: 0, y: 0), CGPoint(x: 0, y: 21.5), CGPoint(x: 5.2, y: 16.6), CGPoint(x: 8.6, y: 24.4),
    CGPoint(x: 12.0, y: 22.9), CGPoint(x: 8.7, y: 15.3), CGPoint(x: 15.6, y: 15.3),
  ]

  override init(frame: CGRect) {
    super.init(frame: frame)
    wantsLayer = true
    layer?.masksToBounds = false
    let center = CGPoint(x: bounds.midX, y: bounds.midY)

    ring.path = CGPath(ellipseIn: CGRect(x: -14, y: -14, width: 28, height: 28), transform: nil)
    ring.position = center
    ring.fillColor = NSColor(srgbRed: 0.949, green: 0.827, blue: 0.106, alpha: 0.25).cgColor
    ring.strokeColor = NSColor(srgbRed: 0.949, green: 0.827, blue: 0.106, alpha: 0.95).cgColor
    ring.lineWidth = 2.5
    ring.opacity = 0
    layer?.addSublayer(ring)

    // The layer's y axis points up; the arrow is drawn downward from the tip at the middle.
    let path = CGMutablePath()
    path.addLines(between: Self.arrowPoints.map { CGPoint(x: $0.x, y: -$0.y) })
    path.closeSubpath()
    arrow.path = path
    arrow.position = center
    arrow.fillColor = NSColor(srgbRed: 0.949, green: 0.827, blue: 0.106, alpha: 1).cgColor // #F2D31B
    arrow.strokeColor = NSColor(srgbRed: 0.102, green: 0.102, blue: 0.102, alpha: 1).cgColor // #1A1A1A
    arrow.lineWidth = 1.5
    arrow.lineJoin = .round
    arrow.shadowColor = NSColor.black.cgColor
    arrow.shadowOpacity = 0.35
    arrow.shadowRadius = 2.5
    arrow.shadowOffset = CGSize(width: 0, height: -1.5)
    arrow.shadowPath = path
    layer?.addSublayer(arrow)
  }

  required init?(coder: NSCoder) { fatalError("Not used.") }

  func pulse() {
    let scale = CABasicAnimation(keyPath: "transform.scale")
    scale.fromValue = 0.35
    scale.toValue = 1.25
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 0.95
    fade.toValue = 0
    let group = CAAnimationGroup()
    group.animations = [scale, fade]
    group.duration = 0.45
    group.timingFunction = CAMediaTimingFunction(name: .easeOut)
    ring.add(group, forKey: "pulse")
  }
}
