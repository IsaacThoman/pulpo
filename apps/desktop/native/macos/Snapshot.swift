import AppKit
import ApplicationServices
import ImageIO
import ScreenCaptureKit

enum Permissions {
  static var accessibility: Bool { AXIsProcessTrusted() }
  static var screenRecording: Bool { CGPreflightScreenCaptureAccess() }

  static func answer(prompt: Bool) -> JSON {
    if prompt {
      // Each shows the system's own request (or opens its settings pane) only when that permission is missing.
      if !accessibility {
        _ = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
      }
      if !screenRecording { _ = CGRequestScreenCaptureAccess() }
    }
    return ["accessibility": accessibility, "screenRecording": screenRecording]
  }

  static func require(screenRecording needsScreen: Bool) throws {
    var missing: [String] = []
    if !accessibility { missing.append("Accessibility") }
    if needsScreen && !screenRecording { missing.append("Screen Recording") }
    guard missing.isEmpty else {
      throw ControlError.permissionDenied("Pulpo needs \(missing.joined(separator: " and ")) permission in System Settings > Privacy & Security.")
    }
  }
}

enum Snapshot {
  private static var counter = 0
  private static let counterLock = NSLock()

  static func take(params: JSON, context: RequestContext) throws -> JSON {
    try Permissions.require(screenRecording: true)
    var target = try Target.resolve(pid: try params.requireInt("pid"), windowId: try params.requireInt("windowId"))
    let wantsOutline = params.bool("outline") ?? true
    let maxElements = max(1, min(params.int("maxElements") ?? 300, 5000))
    guard let imageDir = State.shared.current.imageDir else {
      throw ControlError.invalidRequest("`configure` must name an `imageDir` first.")
    }

    var axWindow = target.axWindow()
    if let minimized = axWindow, minimized.minimized {
      try restore(minimized.element, target: target, context: context)
      target = try target.refreshed()
      axWindow = target.axWindow()
    }

    let bounds = target.window.bounds
    guard bounds.width >= 1, bounds.height >= 1 else { throw ControlError.unsupported("The window has no size.") }
    let backingScale = onMain { Screens.backingScale(for: bounds) }
    let maxEdge = State.shared.current.maxImageEdge
    let factor = min(backingScale, maxEdge / max(bounds.width, bounds.height))
    let width = max(1, Int((bounds.width * factor).rounded()))
    let height = max(1, Int((bounds.height * factor).rounded()))

    let captured = try capture(target.window, context: context)
    let image = try draw(captured, width: width, height: height)
    let url = imageDir.appendingPathComponent(nextFileName(target.window.id))
    try writeJPEG(image, to: url)

    // The factor the agent's pixels are divided by; width and height were rounded, so take it from
    // the image rather than the formula.
    let actualFactor = Double(width) / bounds.width
    var elements: [JSON] = []
    var axElements: [AXUIElement] = []
    var truncated = false
    if wantsOutline, let axWindow {
      let outline = Outline.walk(window: axWindow.element, bounds: bounds, factor: actualFactor, maxElements: maxElements, context: context)
      elements = outline.elements
      axElements = outline.axElements
      truncated = outline.truncated
    }
    State.shared.remember(
      State.WindowSnapshot(pid: target.pid, factor: actualFactor, imageWidth: width, imageHeight: height, elements: axElements),
      for: target.window.id,
    )

    let title = target.window.title.isEmpty ? (axWindow?.title ?? "") : target.window.title
    return [
      "window": ["id": Int(target.window.id), "title": title, "minimized": false],
      "image": ["path": url.path, "width": width, "height": height, "mimeType": "image/jpeg"],
      "elements": elements,
      "truncated": truncated,
    ]
  }

  /// Un-minimizes through AX, which does not activate the app, and waits until the Dock has finished
  /// animating the window back.
  private static func restore(_ element: AXUIElement, target: Target, context: RequestContext) throws {
    let error = AX.set(element, kAXMinimizedAttribute, kCFBooleanFalse)
    guard error == .success else { throw ControlError.unsupported("The window is minimized and could not be restored.") }
    // The window is on screen as soon as the Dock's animation starts, and until it ends the window
    // server reports the frame of the moment, not the window's own. A picture sized by that frame
    // would be stretched and its coordinates wrong, so wait until the frame is the size the app
    // says its window has and has stopped changing.
    let until = Date().addingTimeInterval(3)
    var last: CGRect?
    var steady = 0
    while Date() < until && !context.expired {
      Thread.sleep(forTimeInterval: 0.05)
      guard let window = Windows.info(target.window.id), window.onScreen else { continue }
      let own = AX.frame(element)
      let matches = own.map { abs($0.width - window.bounds.width) <= 2 && abs($0.height - window.bounds.height) <= 2 } ?? true
      steady = matches && window.bounds == last ? steady + 1 : 0
      last = window.bounds
      if steady >= 3 { break }
    }
  }

  private static func nextFileName(_ window: CGWindowID) -> String {
    counterLock.lock()
    counter += 1
    let number = counter
    counterLock.unlock()
    let random = UUID().uuidString.prefix(8).lowercased()
    return "window-\(window)-\(getpid())-\(number)-\(random).jpg"
  }

  // MARK: Capture

  /// The window alone, whatever covers it, without its shadow or the pointer.
  private static func capture(_ window: CGWindow, context: RequestContext) throws -> CGImage {
    if #available(macOS 14.0, *) {
      do {
        return try captureWithScreenCaptureKit(window, context: context)
      } catch let error as ControlError where error.code == "permission_denied" {
        throw error
      } catch {
        // ScreenCaptureKit queues a process's requests behind any earlier one that is stuck (seen
        // while another copy of the helper waited on a Screen Recording prompt), and fails for some
        // windows it does not list. The window server's own picture still works then.
        guard let image = try? captureWithWindowList(window) else { throw error }
        log("ScreenCaptureKit could not capture window \(window.id) (\(error)); used the window list instead")
        return image
      }
    }
    return try captureWithWindowList(window)
  }

  @available(macOS 14.0, *)
  private static func captureWithScreenCaptureKit(_ window: CGWindow, context: RequestContext) throws -> CGImage {
    final class Box: @unchecked Sendable { var result: Result<CGImage, Error> = .failure(ControlError.failed("The window could not be captured in time.")) }
    let box = Box()
    let done = DispatchSemaphore(value: 0)
    let id = window.id
    let backingScale = onMain { Screens.backingScale(for: window.bounds) }
    Task.detached {
      do {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let scWindow = content.windows.first(where: { $0.windowID == id }) else {
          throw ControlError.notFound("The window is gone.")
        }
        let filter = SCContentFilter(desktopIndependentWindow: scWindow)
        let configuration = SCStreamConfiguration()
        // Capture at the display's full resolution; `draw` scales it down to the image size.
        configuration.width = max(1, Int((scWindow.frame.width * backingScale).rounded()))
        configuration.height = max(1, Int((scWindow.frame.height * backingScale).rounded()))
        configuration.showsCursor = false
        configuration.ignoreShadowsSingleWindow = true
        configuration.captureResolution = .best
        box.result = .success(try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration))
      } catch {
        box.result = .failure(error)
      }
      done.signal()
    }
    let remaining = max(1, min(4, context.deadline.timeIntervalSinceNow - 2))
    if done.wait(timeout: .now() + remaining) == .timedOut {
      throw ControlError.failed("The window could not be captured in time.")
    }
    switch box.result {
    case .success(let image): return image
    case .failure(let error as ControlError): throw error
    case .failure(let error):
      if !Permissions.screenRecording { throw ControlError.permissionDenied("Pulpo needs Screen Recording permission in System Settings > Privacy & Security.") }
      throw ControlError.unsupported("The window could not be captured: \(error.localizedDescription)")
    }
  }

  /// The window server's own picture of the window: the only way on macOS 13, and the fallback after.
  /// It is deprecated since macOS 14 but still works (checked on macOS 27).
  private static func captureWithWindowList(_ window: CGWindow) throws -> CGImage {
    guard let create = Private.windowListCreateImage else { throw ControlError.unsupported("This macOS cannot capture a single window.") }
    let includingWindow: UInt32 = CGWindowListOption.optionIncludingWindow.rawValue
    let options: UInt32 = CGWindowImageOption.boundsIgnoreFraming.rawValue | CGWindowImageOption.bestResolution.rawValue
    guard let image = create(.null, includingWindow, window.id, options)?.takeRetainedValue(), image.width > 0, image.height > 0 else {
      throw ControlError.unsupported("The window could not be captured.")
    }
    return image
  }

  /// The capture scaled to the snapshot's size on white, since JPEG has no transparency (a window's
  /// rounded corners would otherwise turn black).
  private static func draw(_ image: CGImage, width: Int, height: Int) throws -> CGImage {
    guard let context = CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue,
    ) else { throw ControlError.failed("The picture could not be drawn.") }
    context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let result = context.makeImage() else { throw ControlError.failed("The picture could not be drawn.") }
    return result
  }

  private static func writeJPEG(_ image: CGImage, to url: URL) throws {
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.jpeg" as CFString, 1, nil) else {
      throw ControlError.failed("Could not write \(url.path).")
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else { throw ControlError.failed("Could not write \(url.path).") }
  }
}

enum Screens {
  /// The height of the main display, which turns the window server's y-down coordinates into
  /// AppKit's y-up ones. Main thread only.
  static var mainHeight: CGFloat { NSScreen.screens.first?.frame.height ?? 0 }

  /// AppKit frame (y up) of a rectangle given in window-server coordinates (y down).
  static func appKitRect(_ rect: CGRect) -> CGRect {
    CGRect(x: rect.minX, y: mainHeight - rect.maxY, width: rect.width, height: rect.height)
  }

  /// The pixels per point of the display that shows most of the rectangle. Main thread only.
  static func backingScale(for rect: CGRect) -> Double {
    let frame = appKitRect(rect)
    var best: (area: CGFloat, scale: CGFloat)?
    for screen in NSScreen.screens {
      let overlap = screen.frame.intersection(frame)
      let area = overlap.isNull ? 0 : overlap.width * overlap.height
      if best == nil || area > best!.area { best = (area, screen.backingScaleFactor) }
    }
    return Double(best?.scale ?? NSScreen.main?.backingScaleFactor ?? 2)
  }
}

/// Runs UI work on the main thread, where AppKit wants it, and waits for it.
func onMain<T>(_ work: () -> T) -> T {
  if Thread.isMainThread { return work() }
  return DispatchQueue.main.sync(execute: work)
}
