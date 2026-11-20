import ApplicationServices
import Foundation

/// The window's elements as the agent reads them: what a person could read or use, depth-first,
/// with boxes in the pixels of the snapshot image.
enum Outline {
  struct Result {
    var elements: [JSON] = []
    var axElements: [AXUIElement] = []
    var truncated = false
  }

  /// Browsers and big documents have enormous trees; the outline is cut here rather than make the
  /// agent wait.
  static let timeBudget: TimeInterval = 3
  static let maxTextLength = 160

  private static let attributes = [
    kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute,
    kAXPositionAttribute, kAXSizeAttribute, kAXFocusedAttribute, kAXEnabledAttribute, kAXChildrenAttribute,
    kAXPlaceholderValueAttribute, kAXVisibleRowsAttribute, kAXVisibleChildrenAttribute, kAXHelpAttribute,
  ]
  private enum Field: Int {
    case role, subrole, title, description, value, position, size, focused, enabled, children, placeholder, visibleRows, visibleChildren, help
  }

  /// The words protocol.ts shares between systems; other roles are their AX name without `AX`, in lower case.
  private static let roleNames: [String: String] = [
    "AXStaticText": "text", "AXTextField": "textfield", "AXTextArea": "textarea", "AXPopUpButton": "combobox",
    "AXComboBox": "combobox", "AXMenuButton": "menubutton", "AXCheckBox": "checkbox", "AXRadioButton": "radio",
    "AXLink": "link", "AXImage": "image", "AXScrollArea": "scrollarea", "AXButton": "button", "AXMenu": "menu",
    "AXMenuItem": "menuitem", "AXMenuBarItem": "menuitem", "AXList": "list", "AXTable": "table", "AXOutline": "tree",
    "AXRow": "row", "AXCell": "cell", "AXTabGroup": "tablist", "AXSlider": "slider", "AXIncrementor": "stepper",
    "AXToolbar": "toolbar", "AXGroup": "group", "AXWindow": "window", "AXSheet": "sheet", "AXHeading": "heading",
    "AXProgressIndicator": "progressbar", "AXBusyIndicator": "progressbar", "AXDisclosureTriangle": "disclosure",
    "AXColorWell": "colorwell", "AXWebArea": "document", "AXSplitter": "splitter", "AXDateField": "datefield",
    "AXRadioGroup": "radiogroup", "AXLevelIndicator": "slider", "AXDockItem": "button",
  ]
  private static let subroleNames: [String: String] = [
    "AXTabButton": "tab", "AXSearchField": "textfield", "AXSecureTextField": "textfield", "AXSwitch": "checkbox",
    "AXOutlineRow": "row", "AXTableRow": "row", "AXToggle": "button",
  ]
  /// A window's own buttons have no title; their subrole says which they are.
  private static let subroleLabels: [String: String] = [
    "AXCloseButton": "Close", "AXMinimizeButton": "Minimize", "AXZoomButton": "Zoom", "AXFullScreenButton": "Full screen",
  ]
  /// Things a person uses, listed even without a label: the agent can still see where they are.
  private static let interactiveRoles: Set<String> = [
    "button", "checkbox", "radio", "textfield", "textarea", "link", "menuitem", "menubutton", "combobox",
    "slider", "stepper", "tab", "disclosure", "colorwell", "datefield", "row",
  ]
  /// Neither listed nor walked: their content is noise (scroll bar parts) or repeated elsewhere
  /// (a table's columns hold the same cells as its rows; the app's menu bar is not the window's; a
  /// slider's knob says what the slider says).
  private static let skippedRoles: Set<String> = ["AXScrollBar", "AXColumn", "AXMenuBar", "AXGrowArea", "AXValueIndicator"]
  private static let checkableRoles: Set<String> = ["checkbox", "radio"]

  static func walk(window: AXUIElement, bounds: CGRect, factor: Double, maxElements: Int, context: RequestContext) -> Result {
    var result = Result()
    let deadline = min(Date().addingTimeInterval(timeBudget), context.deadline)

    struct Pending {
      let element: AXUIElement
      /// Depth of the nearest listed ancestor; -1 above the window's children.
      let parentDepth: Int
      /// What of the window an element can be seen through: the window, narrowed by every scroll
      /// area above it.
      let clip: CGRect
    }

    let windowChildren = AX.elements(window, kAXChildrenAttribute)
    var stack = windowChildren.reversed().map { Pending(element: $0, parentDepth: -1, clip: bounds) }
    // The same element can turn up twice (an app that lists a child under two parents); listing it
    // twice would waste the budget, and walking it twice can loop forever.
    var seen: [CFHashCode: [AXUIElement]] = [:]

    while let next = stack.popLast() {
      if result.elements.count >= maxElements || Date() >= deadline || context.expired {
        result.truncated = true
        break
      }
      let hash = CFHash(next.element)
      if seen[hash]?.contains(where: { CFEqual($0, next.element) }) == true { continue }
      seen[hash, default: []].append(next.element)
      // One round trip for all of them; an app that cannot answer that is asked one by one.
      guard let values = AX.values(next.element, attributes)
        ?? (AX.value(next.element, kAXRoleAttribute) == nil ? nil : attributes.map { AX.value(next.element, $0) }) else { continue }
      func value(_ field: Field) -> CFTypeRef? { values[field.rawValue] }

      guard let axRole = AX.asString(value(.role)) else { continue }
      if skippedRoles.contains(axRole) { continue }
      let subrole = AX.asString(value(.subrole))
      let role = subrole.flatMap { subroleNames[$0] } ?? roleNames[axRole] ?? String(axRole.hasPrefix("AX") ? axRole.dropFirst(2) : Substring(axRole)).lowercased()

      var frame: CGRect?
      if let origin = AX.asPoint(value(.position)), let size = AX.asSize(value(.size)), size.width > 0, size.height > 0 {
        frame = CGRect(origin: origin, size: size)
      }
      // Wholly out of sight: neither it nor what it holds can be seen or clicked.
      if let frame, !frame.intersects(next.clip) { continue }

      var label = clean(AX.asString(value(.title))) ?? clean(AX.asString(value(.description)))
      var text = describe(value(.value), role: role)
      if role == "text" && label == nil {
        // A static text's words are its value; to a reader they are its name.
        label = text
        text = nil
      }
      if label == nil, role == "textfield" || role == "textarea" || role == "combobox" {
        label = clean(AX.asString(value(.placeholder)))
      }
      if label == nil, interactiveRoles.contains(role) {
        // An icon-only button often says what it is only in its tooltip.
        label = subrole.flatMap { subroleLabels[$0] } ?? clean(AX.asString(value(.help)))
      }

      let visible = frame.map { $0.intersection(next.clip) }
      let listed = visible != nil && role != "unknown" && (interactiveRoles.contains(role) || label != nil || text != nil)
      var depth = next.parentDepth
      if listed, let visible {
        depth = next.parentDepth + 1
        var element: JSON = [
          "index": result.elements.count + 1,
          "depth": depth,
          "role": role,
          "x": Int(((visible.minX - bounds.minX) * factor).rounded()),
          "y": Int(((visible.minY - bounds.minY) * factor).rounded()),
          "width": max(1, Int((visible.width * factor).rounded())),
          "height": max(1, Int((visible.height * factor).rounded())),
        ]
        if let label { element["label"] = label }
        if let text, text != label { element["value"] = text }
        if AX.asBool(value(.focused)) == true { element["focused"] = true }
        if AX.asBool(value(.enabled)) == false { element["enabled"] = false }
        result.elements.append(element)
        result.axElements.append(next.element)
      }

      // Tables and lists can hold thousands of rows; the visible ones are what can be seen.
      var children = AX.asElements(value(.children))
      if axRole == "AXTable" || axRole == "AXOutline" {
        let rows = AX.asElements(value(.visibleRows))
        if !rows.isEmpty { children = rows }
      } else if axRole == "AXList" {
        let visibleChildren = AX.asElements(value(.visibleChildren))
        if !visibleChildren.isEmpty { children = visibleChildren }
      }
      var clip = next.clip
      if axRole == "AXScrollArea", let frame { clip = clip.intersection(frame) }
      for child in children.reversed() {
        stack.append(Pending(element: child, parentDepth: depth, clip: clip))
      }
    }
    return result
  }

  /// Trimmed, on one line, and at most 160 characters; nil when nothing is left.
  static func clean(_ text: String?) -> String? {
    guard let text else { return nil }
    let oneLine = text.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !oneLine.isEmpty else { return nil }
    return oneLine.count > maxTextLength ? String(oneLine.prefix(maxTextLength - 1)) + "…" : oneLine
  }

  /// What an element holds, as text: a field's words, a checkbox's state, a slider's number.
  private static func describe(_ value: CFTypeRef?, role: String) -> String? {
    guard let value else { return nil }
    if CFGetTypeID(value) == CFStringGetTypeID() {
      // Text areas keep their line breaks; the agent reads them as the document's.
      let string = (value as! CFString) as String
      if role == "textarea" {
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return trimmed.count > maxTextLength ? String(trimmed.prefix(maxTextLength - 1)) + "…" : trimmed
      }
      return clean(string)
    }
    if CFGetTypeID(value) == CFBooleanGetTypeID() {
      return CFBooleanGetValue((value as! CFBoolean)) ? "true" : "false"
    }
    if CFGetTypeID(value) == CFNumberGetTypeID() {
      let number = (value as! NSNumber).doubleValue
      if checkableRoles.contains(role) {
        switch Int(number) {
        case 0: return "unchecked"
        case 1: return "checked"
        default: return "mixed"
        }
      }
      if number.rounded() == number && abs(number) < 1e15 { return String(Int(number)) }
      return String(format: "%.4g", number)
    }
    return nil
  }
}
