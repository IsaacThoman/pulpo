import AppKit
import ApplicationServices
import Foundation

/// `act`: one thing done in a window, through the element's own accessibility action where it has
/// one and otherwise through input posted to the app.
enum Act {
  private static let textRoles: Set<String> = [kAXTextFieldRole, kAXTextAreaRole, kAXComboBoxRole, "AXSearchField"]

  static func run(params: JSON, context: RequestContext) throws -> JSON {
    try Permissions.require(screenRecording: false)
    let target = try Target.resolve(pid: try params.requireInt("pid"), windowId: try params.requireInt("windowId"))
    guard let action = params.object("action"), let type = action.string("type") else {
      throw ControlError.invalidRequest("`action` must be an object with a `type`.")
    }
    let note: String?
    switch type {
    case "click": note = try click(action, target: target, context: context)
    case "type": note = try typeText(action, target: target, context: context)
    case "key": note = try key(action, target: target)
    case "scroll": note = try scroll(action, target: target)
    case "drag": note = try drag(action, target: target)
    case "set_value": note = try setValue(action, target: target)
    default: throw ControlError.invalidRequest("`\(type)` is not an action.")
    }
    var result: JSON = [:]
    if let note { result["note"] = note }
    return result
  }

  // MARK: Coordinates and elements

  private static func snapshot(_ target: Target) throws -> State.WindowSnapshot {
    guard let snapshot = State.shared.snapshot(of: target.window.id), snapshot.pid == target.pid else {
      throw ControlError.invalidRequest("Take a snapshot of the window first; coordinates are pixels of its image.")
    }
    return snapshot
  }

  /// A pixel of the latest snapshot as a global point, from the window's current position.
  private static func point(x: Double, y: Double, in target: Target) throws -> CGPoint {
    let snapshot = try snapshot(target)
    guard x >= 0, y >= 0, x <= Double(snapshot.imageWidth), y <= Double(snapshot.imageHeight) else {
      throw ControlError.invalidRequest("(\(Int(x)), \(Int(y))) is outside the window's \(snapshot.imageWidth)×\(snapshot.imageHeight) image.")
    }
    return CGPoint(x: target.window.bounds.minX + x / snapshot.factor, y: target.window.bounds.minY + y / snapshot.factor)
  }

  private static func element(_ index: Int, in target: Target) throws -> AXUIElement {
    let snapshot = try snapshot(target)
    guard index >= 1, index <= snapshot.elements.count else {
      throw ControlError.staleElement("Element \(index) is not in the window's latest snapshot.")
    }
    let element = snapshot.elements[index - 1]
    guard AX.isAlive(element) else { throw ControlError.staleElement("Element \(index) is gone; take a new snapshot.") }
    return element
  }

  /// The visible middle of an element, as a global point.
  private static func middle(of element: AXUIElement, in target: Target) throws -> CGPoint {
    guard let frame = AX.frame(element), frame.width > 0, frame.height > 0 else {
      throw ControlError.unsupported("The element has no place on screen to act at.")
    }
    let visible = frame.intersection(target.window.bounds)
    guard !visible.isNull, visible.width > 0, visible.height > 0 else {
      throw ControlError.unsupported("The element is outside the window; scroll it into view first.")
    }
    return CGPoint(x: visible.midX, y: visible.midY)
  }

  private static func name(of element: AXUIElement) -> String {
    let label = Outline.clean(AX.string(element, kAXTitleAttribute)) ?? Outline.clean(AX.string(element, kAXDescriptionAttribute))
    let role = AX.string(element, kAXRoleDescriptionAttribute) ?? "element"
    return label.map { "the \"\($0)\" \(role)" } ?? "the \(role)"
  }

  // MARK: Actions

  private static func click(_ action: JSON, target: Target, context: RequestContext) throws -> String? {
    let button: Input.Button
    switch action.string("button") ?? "left" {
    case "left": button = .left
    case "right": button = .right
    case "middle": button = .middle
    default: throw ControlError.invalidRequest("`button` must be left, right or middle.")
    }
    let count = action.int("count") ?? 1
    guard (1...3).contains(count) else { throw ControlError.invalidRequest("`count` must be 1, 2 or 3.") }

    if let index = action.int("element") {
      let element = try element(index, in: target)
      let actions = AX.actions(element)
      let role = AX.string(element, kAXRoleAttribute) ?? ""
      // The element's own action needs no point and works however the window is covered; the
      // pointer still goes there so the user sees what was pressed.
      if count == 1 && button == .left && !textRoles.contains(role) {
        for actionName in [kAXPressAction, kAXPickAction] where actions.contains(actionName) {
          let point = try? middle(of: element, in: target)
          if let point { AgentPointer.shared.move(to: point, above: target.window) }
          let error = AX.perform(element, actionName)
          if error == .success {
            if point != nil { AgentPointer.shared.pulse() }
            return "Pressed \(name(of: element))."
          }
          if error == .invalidUIElement { throw ControlError.staleElement("Element \(index) is gone; take a new snapshot.") }
        }
      }
      if count == 1 && button == .right && actions.contains(kAXShowMenuAction) {
        let point = try? middle(of: element, in: target)
        if let point { AgentPointer.shared.move(to: point, above: target.window) }
        if AX.perform(element, kAXShowMenuAction) == .success {
          if point != nil { AgentPointer.shared.pulse() }
          return "Opened the menu of \(name(of: element))."
        }
      }
      let point = try middle(of: element, in: target)
      if textRoles.contains(role) {
        // A click in a field is for putting the keyboard focus there; AX does that even when the
        // window refuses a first click, and the click below still places the insertion point.
        AX.set(element, kAXFocusedAttribute, kCFBooleanTrue)
      }
      try pointerClick(at: point, target: target, button: button, count: count)
      return nil
    }

    guard let x = action.double("x"), let y = action.double("y") else {
      throw ControlError.invalidRequest("A click needs `element` or `x` and `y`.")
    }
    try pointerClick(at: try point(x: x, y: y, in: target), target: target, button: button, count: count)
    return nil
  }

  /// A posted click. A left click is made while the app believes its window is key, so views that
  /// ignore the first click on an inactive window take it too (see Focus.swift). Right and middle
  /// clicks reach such views anyway.
  private static func pointerClick(at point: CGPoint, target: Target, button: Input.Button, count: Int) throws {
    try Input.requireWindowTargeting()
    AgentPointer.shared.move(to: point, above: target.window)
    let current = try target.refreshed()
    AgentPointer.shared.pulse()
    if button == .left {
      try Focus.simulated(pid: current.pid, window: current.window.id) {
        try Input.click(at: point, in: current, button: button, count: count)
      }
    } else {
      try Input.click(at: point, in: current, button: button, count: count)
    }
  }

  private static func typeText(_ action: JSON, target: Target, context: RequestContext) throws -> String? {
    let text = try action.requireString("text")
    guard !text.isEmpty else { return nil }
    AgentPointer.shared.touch()
    try withKeyboard(in: target) {
      try Input.type(text, pid: target.pid, context: context)
    }
    return nil
  }

  private static func key(_ action: JSON, target: Target) throws -> String? {
    let chord = try Keys.parse(try action.requireString("keys"))
    AgentPointer.shared.touch()
    try withKeyboard(in: target) {
      Input.press(chord, pid: target.pid)
    }
    return nil
  }

  /// Runs `body`, which posts keys to the app, so that they land in the target window.
  ///
  /// Keys posted to a process go to whichever of its windows the app takes for key, and an app with
  /// several documents open has one the agent may not be looking at. While the app believes it is
  /// active with this window key (see Focus.swift), the keys go here; an inactive app also has no
  /// main window without that, so a shortcut that acts on the current document (Save, Close, Find)
  /// would find none.
  ///
  /// When the user is working in the app themselves, nothing is simulated: the keyboard is where
  /// they have it. Keys for another of its windows would land in theirs, and moving the keyboard
  /// would take it from them, so that is refused.
  private static func withKeyboard<T>(in target: Target, _ body: () throws -> T) throws -> T {
    let userIsInApp = onMain { NSWorkspace.shared.frontmostApplication?.processIdentifier } == target.pid
    if userIsInApp || !Focus.isAvailable {
      if let focused = keyWindow(of: target.pid), focused != target.window.id {
        throw ControlError.unsupported(userIsInApp
          ? "The user is working in this app and has the keyboard in another of its windows. Keys sent now would land there, not in the window you were shown. Wait until they have left the app, or ask them to switch to that window."
          : "The app has the keyboard in another of its windows, and this macOS does not let Pulpo move it without bringing the app forward. Click in the window first, or ask the user to switch to it.")
      }
      return try body()
    }
    return try Focus.simulated(pid: target.pid, window: target.window.id, body)
  }

  /// The window the app has the keyboard in, when accessibility says (it does not while the screen is locked).
  private static func keyWindow(of pid: pid_t) -> CGWindowID? {
    let app = AX.application(pid)
    guard let window = AX.element(app, kAXFocusedWindowAttribute) ?? AX.element(app, kAXMainWindowAttribute),
          AX.string(window, kAXRoleAttribute) == kAXWindowRole else { return nil }
    return AX.windowID(window)
  }

  private static func scroll(_ action: JSON, target: Target) throws -> String? {
    let dx = action.int("dx") ?? 0
    let dy = action.int("dy") ?? 0
    guard abs(dx) <= 200, abs(dy) <= 200 else { throw ControlError.invalidRequest("`dx` and `dy` are lines, at most 200.") }
    let point: CGPoint
    if let index = action.int("element") {
      point = try middle(of: try element(index, in: target), in: target)
    } else if let x = action.double("x"), let y = action.double("y") {
      point = try self.point(x: x, y: y, in: target)
    } else {
      point = CGPoint(x: target.window.bounds.midX, y: target.window.bounds.midY)
    }
    try Input.requireWindowTargeting()
    AgentPointer.shared.move(to: point, above: target.window)
    try Input.scroll(at: point, in: try target.refreshed(), dx: dx, dy: dy)
    return nil
  }

  private static func drag(_ action: JSON, target: Target) throws -> String? {
    let from = try point(x: try action.requireDouble("fromX"), y: try action.requireDouble("fromY"), in: target)
    let to = try point(x: try action.requireDouble("toX"), y: try action.requireDouble("toY"), in: target)
    try Input.requireWindowTargeting()
    AgentPointer.shared.move(to: from, above: target.window)
    let current = try target.refreshed()
    try Focus.simulated(pid: current.pid, window: current.window.id) {
      try Input.drag(from: from, to: to, in: current) { AgentPointer.shared.follow($0) }
    }
    return nil
  }

  private static func setValue(_ action: JSON, target: Target) throws -> String? {
    let index = try action.requireInt("element")
    let text = try action.requireString("value")
    let element = try element(index, in: target)
    guard AX.isSettable(element, kAXValueAttribute) else {
      throw ControlError.unsupported("Element \(index)'s value cannot be set; click it and type instead.")
    }
    let role = AX.string(element, kAXRoleAttribute) ?? ""
    let current = AX.value(element, kAXValueAttribute)
    let value: CFTypeRef
    if role == kAXSliderRole || role == kAXIncrementorRole || role == "AXLevelIndicator" || current.map({ CFGetTypeID($0) == CFNumberGetTypeID() }) == true {
      guard let number = Double(text.trimmingCharacters(in: .whitespaces)) else {
        throw ControlError.invalidRequest("Element \(index) holds a number; `\(text)` is not one.")
      }
      value = number as NSNumber
    } else if current.map({ CFGetTypeID($0) == CFBooleanGetTypeID() }) == true {
      value = (["true", "1", "on", "yes", "checked"].contains(text.lowercased()) ? kCFBooleanTrue : kCFBooleanFalse)!
    } else {
      value = text as CFString
    }
    if let point = try? middle(of: element, in: target) { AgentPointer.shared.move(to: point, above: target.window) }
    switch AX.set(element, kAXValueAttribute, value) {
    case .success: return "Set \(name(of: element)) to \"\(Outline.clean(text) ?? "")\"."
    case .invalidUIElement: throw ControlError.staleElement("Element \(index) is gone; take a new snapshot.")
    case .illegalArgument: throw ControlError.invalidRequest("Element \(index) does not take `\(text)`.")
    default: throw ControlError.failed("The app did not accept the new value.")
    }
  }
}
