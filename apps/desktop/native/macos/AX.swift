import ApplicationServices
import Foundation

// Small, defensive wrappers around the Accessibility API. AX answers come from the target app, so
// any of them can be missing, of an unexpected type, or late; every reader here checks the type and
// treats anything odd as absent.

enum AX {
  /// How long one AX call may wait for an app before giving up. A hung app must not hang the helper.
  static let messagingTimeout: Float = 2

  static func setUp() {
    // On the system-wide element this sets the default for every element the helper creates.
    AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), messagingTimeout)
  }

  static func application(_ pid: pid_t, timeout: Float = messagingTimeout) -> AXUIElement {
    let element = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(element, timeout)
    return element
  }

  static func raw(_ element: AXUIElement, _ attribute: String) -> (AXError, CFTypeRef?) {
    var value: CFTypeRef?
    let error = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
    return (error, value)
  }

  static func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    let (error, value) = raw(element, attribute)
    return error == .success ? value : nil
  }

  static func string(_ element: AXUIElement, _ attribute: String) -> String? {
    guard let value = value(element, attribute), CFGetTypeID(value) == CFStringGetTypeID() else { return nil }
    return (value as! CFString) as String
  }

  static func bool(_ element: AXUIElement, _ attribute: String) -> Bool? { asBool(value(element, attribute)) }

  static func element(_ element: AXUIElement, _ attribute: String) -> AXUIElement? { asElement(value(element, attribute)) }

  static func elements(_ element: AXUIElement, _ attribute: String) -> [AXUIElement] { asElements(value(element, attribute)) }

  static func frame(_ element: AXUIElement) -> CGRect? {
    guard let origin = asPoint(value(element, kAXPositionAttribute)), let size = asSize(value(element, kAXSizeAttribute)) else { return nil }
    return CGRect(origin: origin, size: size)
  }

  static func actions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success, let names = names as? [Any] else { return [] }
    return names.compactMap { $0 as? String }
  }

  @discardableResult
  static func perform(_ element: AXUIElement, _ action: String) -> AXError {
    AXUIElementPerformAction(element, action as CFString)
  }

  @discardableResult
  static func set(_ element: AXUIElement, _ attribute: String, _ value: CFTypeRef) -> AXError {
    AXUIElementSetAttributeValue(element, attribute as CFString, value)
  }

  static func isSettable(_ element: AXUIElement, _ attribute: String) -> Bool {
    var settable: DarwinBoolean = false
    return AXUIElementIsAttributeSettable(element, attribute as CFString, &settable) == .success && settable.boolValue
  }

  /// Whether the element still exists in its app. A destroyed element answers every question with
  /// `invalidUIElement`; one that is merely slow answers with `cannotComplete`, which counts as alive.
  static func isAlive(_ element: AXUIElement) -> Bool {
    let (error, _) = raw(element, kAXRoleAttribute)
    return error != .invalidUIElement
  }

  static func pid(_ element: AXUIElement) -> pid_t? {
    var pid: pid_t = 0
    return AXUIElementGetPid(element, &pid) == .success ? pid : nil
  }

  /// The CGWindowID behind an AX window, through the private `_AXUIElementGetWindow`.
  static func windowID(_ element: AXUIElement) -> CGWindowID? {
    guard let getWindow = Private.axGetWindow else { return nil }
    var id: CGWindowID = 0
    return getWindow(element, &id) == .success && id != 0 ? id : nil
  }

  // MARK: Reading values that came back from an app

  static func asBool(_ value: CFTypeRef?) -> Bool? {
    guard let value else { return nil }
    if CFGetTypeID(value) == CFBooleanGetTypeID() { return CFBooleanGetValue((value as! CFBoolean)) }
    if CFGetTypeID(value) == CFNumberGetTypeID() { return (value as! NSNumber).intValue != 0 }
    return nil
  }

  static func asElement(_ value: CFTypeRef?) -> AXUIElement? {
    guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
    return (value as! AXUIElement)
  }

  static func asElements(_ value: CFTypeRef?) -> [AXUIElement] {
    guard let value, CFGetTypeID(value) == CFArrayGetTypeID() else { return [] }
    let array = value as! CFArray
    var result: [AXUIElement] = []
    result.reserveCapacity(CFArrayGetCount(array))
    for index in 0..<CFArrayGetCount(array) {
      guard let item = CFArrayGetValueAtIndex(array, index) else { continue }
      let object = Unmanaged<CFTypeRef>.fromOpaque(item).takeUnretainedValue()
      if CFGetTypeID(object) == AXUIElementGetTypeID() { result.append(object as! AXUIElement) }
    }
    return result
  }

  static func asString(_ value: CFTypeRef?) -> String? {
    guard let value, CFGetTypeID(value) == CFStringGetTypeID() else { return nil }
    return (value as! CFString) as String
  }

  static func asPoint(_ value: CFTypeRef?) -> CGPoint? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(value as! AXValue, .cgPoint, &point) ? point : nil
  }

  static func asSize(_ value: CFTypeRef?) -> CGSize? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var size = CGSize.zero
    return AXValueGetValue(value as! AXValue, .cgSize, &size) ? size : nil
  }

  /// Several attributes in one round trip to the app. Missing ones come back as nil.
  static func values(_ element: AXUIElement, _ attributes: [String]) -> [CFTypeRef?]? {
    var values: CFArray?
    guard AXUIElementCopyMultipleAttributeValues(element, attributes as CFArray, AXCopyMultipleAttributeOptions(rawValue: 0), &values) == .success,
          let values, CFArrayGetCount(values) == attributes.count else { return nil }
    return (0..<attributes.count).map { index in
      guard let item = CFArrayGetValueAtIndex(values, index) else { return nil }
      let object = Unmanaged<CFTypeRef>.fromOpaque(item).takeUnretainedValue()
      // A missing attribute comes back as an AXValue holding an AXError.
      if CFGetTypeID(object) == AXValueGetTypeID(), AXValueGetType(object as! AXValue) == .axError { return nil }
      return object
    }
  }
}
