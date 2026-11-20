import ApplicationServices
import CoreGraphics
import Foundation

/// Input delivered to one app in the background: every event is posted to the app's process
/// (`postToPid`), never into the system's event stream, so the user's pointer does not move, their
/// keyboard keeps going where it was going, and the app is not brought forward.
enum Input {
  /// A private source keeps the user's own held modifier keys out of the agent's events.
  private static let source = CGEventSource(stateID: .privateState)

  static var canTargetWindows: Bool { Private.setWindowLocation != nil }

  // MARK: Mouse

  enum Button {
    case left, right, middle

    var cgButton: CGMouseButton {
      switch self {
      case .left: .left
      case .right: .right
      case .middle: .center
      }
    }

    var down: CGEventType {
      switch self {
      case .left: .leftMouseDown
      case .right: .rightMouseDown
      case .middle: .otherMouseDown
      }
    }

    var up: CGEventType {
      switch self {
      case .left: .leftMouseUp
      case .right: .rightMouseUp
      case .middle: .otherMouseUp
      }
    }

    var dragged: CGEventType {
      switch self {
      case .left: .leftMouseDragged
      case .right: .rightMouseDragged
      case .middle: .otherMouseDragged
      }
    }
  }

  /// A mouse event aimed at one window. AppKit routes a mouse event by the window number in field 51
  /// and reads `locationInWindow` from what `CGEventSetWindowLocation` sets; the two public
  /// window-under-pointer fields are set as well for apps that read those.
  private static func mouseEvent(_ type: CGEventType, at point: CGPoint, in window: CGWindow, button: CGMouseButton, clickState: Int64) -> CGEvent? {
    guard let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: button) else { return nil }
    let id = Int64(window.id)
    event.setIntegerValueField(eventTargetWindowField, value: id)
    event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: id)
    event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: id)
    if type != .mouseMoved { event.setIntegerValueField(.mouseEventClickState, value: clickState) }
    if button == .center { event.setIntegerValueField(.mouseEventButtonNumber, value: 2) }
    event.flags = []
    Private.setWindowLocation?(event, CGPoint(x: point.x - window.bounds.minX, y: point.y - window.bounds.minY))
    return event
  }

  private static func post(_ event: CGEvent?, to pid: pid_t) {
    event?.postToPid(pid)
  }

  static func requireWindowTargeting() throws {
    guard canTargetWindows else {
      throw ControlError.unsupported("This macOS does not let Pulpo click at a point in a background window; use an element's own action instead.")
    }
  }

  static func move(to point: CGPoint, in target: Target) {
    post(mouseEvent(.mouseMoved, at: point, in: target.window, button: .left, clickState: 0), to: target.pid)
  }

  /// `count` presses at one point, with the click-state values a real double or triple click has.
  static func click(at point: CGPoint, in target: Target, button: Button, count: Int) throws {
    try requireWindowTargeting()
    move(to: point, in: target)
    Thread.sleep(forTimeInterval: 0.03)
    for press in 1...max(1, count) {
      post(mouseEvent(button.down, at: point, in: target.window, button: button.cgButton, clickState: Int64(press)), to: target.pid)
      Thread.sleep(forTimeInterval: 0.03)
      post(mouseEvent(button.up, at: point, in: target.window, button: button.cgButton, clickState: Int64(press)), to: target.pid)
      if press < count { Thread.sleep(forTimeInterval: 0.06) }
    }
  }

  /// Presses at `from`, moves to `to` over `duration` and lets go. `moved` is told each point, for
  /// the agent's pointer to follow.
  static func drag(from: CGPoint, to: CGPoint, in target: Target, duration: TimeInterval = 0.3, moved: (CGPoint) -> Void) throws {
    try requireWindowTargeting()
    move(to: from, in: target)
    Thread.sleep(forTimeInterval: 0.03)
    post(mouseEvent(.leftMouseDown, at: from, in: target.window, button: .left, clickState: 1), to: target.pid)
    let steps = 20
    for step in 1...steps {
      Thread.sleep(forTimeInterval: duration / Double(steps))
      let t = Double(step) / Double(steps)
      let point = CGPoint(x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t)
      post(mouseEvent(.leftMouseDragged, at: point, in: target.window, button: .left, clickState: 1), to: target.pid)
      moved(point)
    }
    Thread.sleep(forTimeInterval: 0.03)
    post(mouseEvent(.leftMouseUp, at: to, in: target.window, button: .left, clickState: 1), to: target.pid)
  }

  /// Scrolls by lines; positive `dy` moves down the page and positive `dx` to the right, which is a
  /// negative wheel delta. Big amounts go in a few steps, as a wheel would, so apps that animate
  /// scrolling follow.
  static func scroll(at point: CGPoint, in target: Target, dx: Int, dy: Int) throws {
    try requireWindowTargeting()
    move(to: point, in: target)
    var remainingX = dx
    var remainingY = dy
    while remainingX != 0 || remainingY != 0 {
      let stepX = max(-5, min(5, remainingX))
      let stepY = max(-5, min(5, remainingY))
      remainingX -= stepX
      remainingY -= stepY
      guard let event = CGEvent(scrollWheelEvent2Source: source, units: .line, wheelCount: 2, wheel1: Int32(-stepY), wheel2: Int32(-stepX), wheel3: 0) else { break }
      event.location = point
      let id = Int64(target.window.id)
      event.setIntegerValueField(eventTargetWindowField, value: id)
      event.setIntegerValueField(.mouseEventWindowUnderMousePointer, value: id)
      event.setIntegerValueField(.mouseEventWindowUnderMousePointerThatCanHandleThisEvent, value: id)
      event.flags = []
      Private.setWindowLocation?(event, CGPoint(x: point.x - target.window.bounds.minX, y: point.y - target.window.bounds.minY))
      post(event, to: target.pid)
      Thread.sleep(forTimeInterval: 0.02)
    }
  }

  // MARK: Keyboard

  private static func keyEvent(_ code: CGKeyCode, down: Bool, flags: CGEventFlags, text: String? = nil) -> CGEvent? {
    guard let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: down) else { return nil }
    event.flags = flags
    if let text {
      let units = Array(text.utf16)
      event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
    }
    return event
  }

  /// One key or chord, with the modifier keys pressed around it as a keyboard would, since some apps
  /// follow modifier state through their own key events rather than each event's flags.
  static func press(_ chord: Keys.Chord, pid: pid_t) {
    var held: CGEventFlags = []
    for (flag, code) in Keys.modifierCodes where chord.flags.contains(flag) {
      held.insert(flag)
      let event = keyEvent(code, down: true, flags: held)
      event?.type = .flagsChanged
      post(event, to: pid)
    }
    post(keyEvent(chord.code, down: true, flags: chord.flags, text: chord.text), to: pid)
    Thread.sleep(forTimeInterval: 0.01)
    post(keyEvent(chord.code, down: false, flags: chord.flags, text: chord.text), to: pid)
    for (flag, code) in Keys.modifierCodes.reversed() where chord.flags.contains(flag) {
      held.remove(flag)
      let event = keyEvent(code, down: false, flags: held)
      event?.type = .flagsChanged
      post(event, to: pid)
    }
  }

  /// Types text as text: each event carries its characters, so the keyboard layout does not matter.
  /// Line breaks and tabs are pressed as their keys, which is what apps expect of them. A few
  /// characters go in one event and there is a pause between events, so apps that handle key events
  /// slowly (web views) do not drop or reorder any.
  static func type(_ text: String, pid: pid_t, context: RequestContext) throws {
    let charactersPerEvent = 8
    var pending = ""
    func flush() {
      guard !pending.isEmpty else { return }
      post(keyEvent(0, down: true, flags: [], text: pending), to: pid)
      post(keyEvent(0, down: false, flags: [], text: pending), to: pid)
      pending = ""
      Thread.sleep(forTimeInterval: 0.008)
    }
    for character in text {
      try context.check()
      if character == "\n" || character == "\r\n" || character == "\r" {
        flush()
        press(Keys.Chord(code: Keys.returnKey, flags: [], text: nil), pid: pid)
        Thread.sleep(forTimeInterval: 0.008)
      } else if character == "\t" {
        flush()
        press(Keys.Chord(code: Keys.tabKey, flags: [], text: nil), pid: pid)
        Thread.sleep(forTimeInterval: 0.008)
      } else {
        // An event carries at most 20 UTF-16 units; emoji can take several each.
        if pending.utf16.count + character.utf16.count > 20 { flush() }
        pending.append(character)
        if pending.count >= charactersPerEvent { flush() }
      }
    }
    flush()
  }
}
