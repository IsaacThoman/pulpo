import AppKit
import ApplicationServices

/// Lets a background app take a single click as if its window were key, without activating it.
///
/// AppKit drops a mouse-down with a click count of 1 on a window that is not key when the view under
/// it does not accept the first mouse (buttons and most controls do; many custom views, canvases and
/// lists do not). A person's click would activate the app first; the agent's must not, because
/// activating takes the user's keyboard and brings the app forward.
///
/// SkyLight's process-services event records are what the window server sends an app when it gains
/// or loses the focus. Sent with `SLPSPostEventRecordTo`, they reach only the target process: the
/// app believes it is active and its window key, while the window server's own front process (and
/// with it where the user's keyboard goes) and the order of windows stay as they were. The helper
/// sends "activated" just before a left click, a drag or keys and "deactivated" right after, so the
/// app believes it is active only while the agent's input arrives. The same records decide which
/// of the app's windows posted keys land in. This is the pair yabai uses to focus a
/// window without raising it, minus its call that makes the process frontmost.
enum Focus {
  static var isAvailable: Bool { Private.postEventRecordTo != nil && Private.getProcessForPID != nil }

  /// Runs `body` while the app believes `window` is its key window in an active app. When the app
  /// is the frontmost one already (the user is working in it), or the private calls are missing,
  /// `body` simply runs: a click on a view that refuses the first mouse is then dropped by the app.
  static func simulated<T>(pid: pid_t, window: CGWindowID, _ body: () throws -> T) rethrows -> T {
    guard let post = Private.postEventRecordTo, let getProcess = Private.getProcessForPID,
          NSWorkspace.shared.frontmostApplication?.processIdentifier != pid else { return try body() }
    var psn = ProcessSerialNumber()
    guard getProcess(pid, &psn) == noErr else { return try body() }

    func send(_ fill: (inout [UInt8]) -> Void) {
      var bytes = [UInt8](repeating: 0, count: 0xF8)
      bytes[0x04] = 0xF8
      fill(&bytes)
      withUnsafeBytes(of: window.littleEndian) { id in
        for (offset, byte) in id.enumerated() { bytes[0x3C + offset] = byte }
      }
      _ = bytes.withUnsafeMutableBufferPointer { post(&psn, $0.baseAddress!) }
    }
    /// Record 0x0D: the window was activated (1) or deactivated (2).
    func activation(_ state: UInt8) {
      send { bytes in
        bytes[0x08] = 0x0D
        bytes[0x8A] = state
      }
    }
    /// Records 1 and 2: the window became key.
    func makeKey() {
      for kind: UInt8 in [0x01, 0x02] {
        send { bytes in
          bytes[0x08] = kind
          bytes[0x3A] = 0x10
          for offset in 0x20..<0x30 { bytes[offset] = 0xFF }
        }
      }
    }

    activation(1)
    makeKey()
    // The app handles the records on its main thread; the click must arrive after them.
    Thread.sleep(forTimeInterval: 0.05)
    defer {
      // After the app has handled the click's events. If the user switched to the app meanwhile it
      // really is active now, and telling it otherwise would leave it deaf to their keyboard.
      Thread.sleep(forTimeInterval: 0.05)
      if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { activation(2) }
    }
    return try body()
  }
}
