import ApplicationServices
import CoreGraphics
import Foundation

// Private system functions the helper uses. Each is looked up at run time, so a macOS release that
// drops one leaves the helper running with a narrower ability (each use names its fallback) instead
// of failing to start.

enum Private {
  private static let defaultHandle = UnsafeMutableRawPointer(bitPattern: -2) // RTLD_DEFAULT

  /// SkyLight is loaded by AppKit already; opening it again only makes sure its symbols resolve.
  private static let skyLight: UnsafeMutableRawPointer? = dlopen("/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight", RTLD_LAZY)

  private static func symbol(_ name: String) -> UnsafeMutableRawPointer? {
    if let found = dlsym(defaultHandle, name) { return found }
    if let skyLight, let found = dlsym(skyLight, name) { return found }
    return nil
  }

  /// `CGEventSetWindowLocation(event, point)`: the point in the window, from its top-left corner with
  /// y down, which AppKit turns into `NSEvent.locationInWindow`. Without it a mouse event posted to a
  /// process lands at the window's corner, so coordinate clicks cannot be delivered in the background.
  typealias SetWindowLocation = @convention(c) (CGEvent, CGPoint) -> Void
  static let setWindowLocation: SetWindowLocation? = symbol("CGEventSetWindowLocation").map { unsafeBitCast($0, to: SetWindowLocation.self) }

  /// `_AXUIElementGetWindow(element, &id)`: the CGWindowID of an AX window. Without it AX windows are
  /// matched to CGWindowIDs by title and frame.
  typealias AXGetWindow = @convention(c) (AXUIElement, UnsafeMutablePointer<CGWindowID>) -> AXError
  static let axGetWindow: AXGetWindow? = symbol("_AXUIElementGetWindow").map { unsafeBitCast($0, to: AXGetWindow.self) }

  /// `SLPSPostEventRecordTo(&psn, bytes)`: hands a process-services event record to one process. Used
  /// to tell an app its window is key without making the app frontmost (see Focus.swift).
  typealias PostEventRecordTo = @convention(c) (UnsafeMutablePointer<ProcessSerialNumber>, UnsafeMutablePointer<UInt8>) -> CGError
  static let postEventRecordTo: PostEventRecordTo? = symbol("SLPSPostEventRecordTo").map { unsafeBitCast($0, to: PostEventRecordTo.self) }

  /// `GetProcessForPID` is public but deprecated, and Swift no longer offers it; SLPS wants the
  /// process serial number it gives.
  typealias GetProcessForPID = @convention(c) (pid_t, UnsafeMutablePointer<ProcessSerialNumber>) -> OSStatus
  static let getProcessForPID: GetProcessForPID? = symbol("GetProcessForPID").map { unsafeBitCast($0, to: GetProcessForPID.self) }

  /// `CGWindowListCreateImage` is public, but the current SDK hides it from Swift. It is only the
  /// macOS 13 fallback for ScreenCaptureKit's single-window screenshot, which arrived in macOS 14.
  typealias WindowListCreateImage = @convention(c) (CGRect, UInt32, CGWindowID, UInt32) -> Unmanaged<CGImage>?
  static let windowListCreateImage: WindowListCreateImage? = symbol("CGWindowListCreateImage").map { unsafeBitCast($0, to: WindowListCreateImage.self) }
}

/// Integer field 51 of a mouse event is the number of the window it is meant for; AppKit reads
/// `NSEvent.windowNumber` from it. An event posted to a process without it reaches no window.
let eventTargetWindowField = CGEventField(rawValue: 51)!
