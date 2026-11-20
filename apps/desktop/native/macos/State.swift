import ApplicationServices
import Foundation

/// What the helper remembers between requests. A request that took too long may still be finishing
/// on its own thread while the next one runs, so everything here is behind a lock.
final class State: @unchecked Sendable {
  static let shared = State()

  struct Config {
    var excludePids: Set<pid_t> = []
    var imageDir: URL?
    var maxImageEdge: Double = 1568
  }

  /// The latest snapshot of one window: how its image maps to the window and the elements its
  /// outline listed, so `act` can turn pixels and indexes back into points and AX elements.
  struct WindowSnapshot {
    let pid: pid_t
    /// Image pixels per point.
    let factor: Double
    let imageWidth: Int
    let imageHeight: Int
    let elements: [AXUIElement]
  }

  private let lock = NSLock()
  private var config = Config()
  private var snapshots: [CGWindowID: WindowSnapshot] = [:]

  var current: Config {
    lock.lock()
    defer { lock.unlock() }
    return config
  }

  func configure(_ update: (inout Config) -> Void) {
    lock.lock()
    update(&config)
    lock.unlock()
  }

  func isExcluded(_ pid: pid_t) -> Bool {
    pid == getpid() || current.excludePids.contains(pid)
  }

  func snapshot(of window: CGWindowID) -> WindowSnapshot? {
    lock.lock()
    defer { lock.unlock() }
    return snapshots[window]
  }

  func remember(_ snapshot: WindowSnapshot, for window: CGWindowID) {
    lock.lock()
    snapshots[window] = snapshot
    // Windows come and go; the elements of closed ones hold on to their app's AX objects.
    if snapshots.count > 64 {
      let live = Set(Windows.list(.optionAll).map(\.id))
      snapshots = snapshots.filter { live.contains($0.key) }
    }
    lock.unlock()
  }
}
