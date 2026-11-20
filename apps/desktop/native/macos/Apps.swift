import AppKit
import ApplicationServices

/// One window as the window server lists it. `bounds` is in points, global, from the top-left corner
/// of the main display with y down: the space CGEvent locations and AX positions use too.
struct CGWindow {
  let id: CGWindowID
  let pid: pid_t
  let bounds: CGRect
  let layer: Int
  let title: String
  let onScreen: Bool
}

enum Windows {
  /// Smaller than this is a palette, a tooltip or a helper window, not something a person works in.
  static let minimumSize = CGSize(width: 60, height: 40)

  /// Front to back for windows on screen; windows that are not (minimized, hidden, on another
  /// Space) follow.
  static func list(_ options: CGWindowListOption, relativeTo window: CGWindowID = kCGNullWindowID) -> [CGWindow] {
    guard let infos = CGWindowListCopyWindowInfo(options, window) as? [[String: Any]] else { return [] }
    return infos.compactMap(parse)
  }

  static func info(_ id: CGWindowID) -> CGWindow? {
    // Asking for the one window answers nothing for a window that is off screen (minimized, say),
    // although the full list has it.
    list(.optionIncludingWindow, relativeTo: id).first { $0.id == id } ?? list(.optionAll).first { $0.id == id }
  }

  private static func parse(_ info: [String: Any]) -> CGWindow? {
    guard let id = (info[kCGWindowNumber as String] as? NSNumber)?.uint32Value,
          let pid = (info[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value,
          let boundsInfo = info[kCGWindowBounds as String],
          let bounds = CGRect(dictionaryRepresentation: boundsInfo as! CFDictionary) else { return nil }
    return CGWindow(
      id: id,
      pid: pid,
      bounds: bounds,
      layer: (info[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0,
      // Window names are only given to processes with Screen Recording; AX fills in otherwise.
      title: info[kCGWindowName as String] as? String ?? "",
      onScreen: (info[kCGWindowIsOnscreen as String] as? NSNumber)?.boolValue ?? false,
    )
  }

  static func isOrdinary(_ window: CGWindow) -> Bool {
    window.layer == 0 && window.bounds.width >= minimumSize.width && window.bounds.height >= minimumSize.height
  }

  /// One AX window of an app with what the CGWindow list cannot say about it.
  struct AXWindow {
    let element: AXUIElement
    let id: CGWindowID?
    let title: String
    let frame: CGRect?
    let minimized: Bool
  }

  static func axWindows(_ pid: pid_t, timeout: Float = AX.messagingTimeout) -> [AXWindow] {
    let app = AX.application(pid, timeout: timeout)
    let attributes = [kAXRoleAttribute, kAXTitleAttribute, kAXPositionAttribute, kAXSizeAttribute, kAXMinimizedAttribute]
    return AX.elements(app, kAXWindowsAttribute).compactMap { element in
      // While the screen is locked (seen on macOS 27) apps answer with their application element in
      // place of every window, so only what says it is a window counts as one.
      guard let values = AX.values(element, attributes), AX.asString(values[0]) == kAXWindowRole else { return nil }
      var frame: CGRect?
      if let origin = AX.asPoint(values[2]), let size = AX.asSize(values[3]) { frame = CGRect(origin: origin, size: size) }
      return AXWindow(
        element: element,
        id: AX.windowID(element),
        title: AX.asString(values[1]) ?? "",
        frame: frame,
        minimized: AX.asBool(values[4]) ?? false,
      )
    }
  }

  /// The AX window for a CGWindow. Without `_AXUIElementGetWindow`, or for an app that does not
  /// answer it, the window with the same frame (and title, when both have one) is taken.
  static func axWindow(for window: CGWindow, among candidates: [AXWindow]) -> AXWindow? {
    if let exact = candidates.first(where: { $0.id == window.id }) { return exact }
    let unnumbered = candidates.filter { $0.id == nil }
    return unnumbered.first { candidate in
      guard let frame = candidate.frame, framesMatch(frame, window.bounds) else { return false }
      return window.title.isEmpty || candidate.title.isEmpty || candidate.title == window.title
    }
  }

  private static func framesMatch(_ a: CGRect, _ b: CGRect) -> Bool {
    abs(a.minX - b.minX) <= 2 && abs(a.minY - b.minY) <= 2 && abs(a.width - b.width) <= 2 && abs(a.height - b.height) <= 2
  }
}

enum Apps {
  /// Regular apps that own at least one ordinary window, frontmost app first, then in the order of
  /// their front windows; windows front to back.
  static func list(_ context: RequestContext) -> [JSON] {
    let state = State.shared
    let frontmost = NSWorkspace.shared.frontmostApplication?.processIdentifier
    var regular: [pid_t: NSRunningApplication] = [:]
    for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular && !app.isTerminated && !state.isExcluded(app.processIdentifier) {
      regular[app.processIdentifier] = app
    }

    var order: [pid_t] = []
    var candidates: [pid_t: [CGWindow]] = [:]
    for window in Windows.list([.optionAll, .excludeDesktopElements]) where regular[window.pid] != nil && Windows.isOrdinary(window) {
      if candidates[window.pid] == nil { order.append(window.pid) }
      candidates[window.pid, default: []].append(window)
    }
    if let frontmost, let index = order.firstIndex(of: frontmost) {
      order.remove(at: index)
      order.insert(frontmost, at: 0)
    }

    var apps: [JSON] = []
    for pid in order {
      guard let app = regular[pid], let windows = candidates[pid] else { continue }
      // A short timeout: one hung app must not stall the whole list.
      let axWindows = context.expired ? [] : Windows.axWindows(pid, timeout: 0.5)
      var listed: [JSON] = []
      for window in windows {
        let ax = Windows.axWindow(for: window, among: axWindows)
        // The window server also keeps windows that are not windows to a person (offscreen buffers,
        // windows an app keeps ready but never shows). Those on screen are real; an offscreen one
        // counts only when the app's AX tree names it (a minimized or hidden window). Windows on
        // other Spaces are not in the AX tree, so they are not listed until the user goes there.
        guard window.onScreen || ax != nil else { continue }
        listed.append([
          "id": Int(window.id),
          "title": window.title.isEmpty ? (ax?.title ?? "") : window.title,
          "minimized": ax?.minimized ?? false,
        ])
      }
      guard !listed.isEmpty else { continue }
      apps.append([
        "id": app.bundleIdentifier ?? app.executableURL?.path ?? app.localizedName ?? String(pid),
        "name": app.localizedName ?? app.bundleIdentifier ?? String(pid),
        "pid": Int(pid),
        "frontmost": pid == frontmost,
        "windows": listed,
      ])
    }
    return apps
  }
}

/// The window a snapshot or an action is about, checked to still exist and to belong to the pid.
struct Target {
  let pid: pid_t
  let window: CGWindow

  static func resolve(pid: Int, windowId: Int) throws -> Target {
    guard pid > 0, pid <= Int(Int32.max), windowId > 0, windowId <= Int(UInt32.max) else {
      throw ControlError.invalidRequest("`pid` and `windowId` must name a process and one of its windows.")
    }
    let pid = pid_t(pid)
    if State.shared.isExcluded(pid) { throw ControlError.notFound("No such app.") }
    // The process itself, not NSRunningApplication: LaunchServices' record of an app can go stale
    // (seen with two copies of one executable running) while the process and its windows live on.
    guard kill(pid, 0) == 0 || errno == EPERM else { throw ControlError.notFound("The app is not running any more.") }
    guard let window = Windows.info(CGWindowID(windowId)), window.pid == pid else {
      throw ControlError.notFound("The window is gone.")
    }
    return Target(pid: pid, window: window)
  }

  /// The window's AX element, when the app gives one.
  func axWindow() -> Windows.AXWindow? {
    Windows.axWindow(for: window, among: Windows.axWindows(pid))
  }

  /// The window as it is now (it may have moved since it was resolved).
  func refreshed() throws -> Target {
    guard let window = Windows.info(window.id), window.pid == pid else { throw ControlError.notFound("The window is gone.") }
    return Target(pid: pid, window: window)
  }
}
