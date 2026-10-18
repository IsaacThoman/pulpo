#if os(iOS)
import Foundation
#if PK_PERF_LOG
import Darwin
import os
import QuartzCore
#endif

/// Main-thread timings and memory for measuring the keyboard, compiled only into
/// builds with `SWIFT_ACTIVE_COMPILATION_CONDITIONS=PK_PERF_LOG`. Every call is
/// empty otherwise. Read the results with
/// `xcrun simctl spawn <device> log show --predicate 'subsystem == "com.isaacthoman.pulpo.keyboard.perf"'`.
enum PerfLog {
  /// A start time for `end`, in nanoseconds.
  @inline(__always) static func begin() -> UInt64 {
    #if PK_PERF_LOG
    clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
    #else
    0
    #endif
  }

  /// Records the time since `start` under `name`; summarized by `flush`.
  @inline(__always) static func end(_ name: StaticString, _ start: UInt64) {
    #if PK_PERF_LOG
    let elapsed = Double(clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - start) / 1_000_000
    samples["\(name)", default: []].append(elapsed)
    #endif
  }

  /// A milestone, with the time since the process started and its memory: the
  /// footprint (what jetsam compares with the process's limit), its peak so far,
  /// and how much the system says is left before the limit (0 where none applies,
  /// as in the simulator).
  @inline(__always) static func event(_ name: StaticString) {
    #if PK_PERF_LOG
    let memory = memory()
    logger.notice("PKPERF event=\("\(name)", privacy: .public) sinceLaunchMs=\(sinceLaunch(), format: .fixed(precision: 1), privacy: .public) footprintMB=\(memory.footprint, format: .fixed(precision: 2), privacy: .public) peakMB=\(memory.peak, format: .fixed(precision: 2), privacy: .public) limitRemainingMB=\(memory.remaining, format: .fixed(precision: 2), privacy: .public)")
    #endif
  }

  /// Like `event`, `delay` seconds later, once the main thread has let go of
  /// what the moment released.
  @inline(__always) static func event(_ name: StaticString, after delay: TimeInterval) {
    #if PK_PERF_LOG
    DispatchQueue.main.asyncAfter(deadline: .now() + delay) { event(name) }
    #endif
  }

  /// Like `event`, once per process.
  @inline(__always) static func firstEvent(_ name: StaticString) {
    #if PK_PERF_LOG
    if logged.insert("\(name)").inserted { event(name) }
    #endif
  }

  /// Flushes shortly after the keyboard appears, covering startup and the first bar.
  @inline(__always) static func flushSoon() {
    #if PK_PERF_LOG
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { flush("appeared") }
    #endif
  }

  /// Records display frame intervals under `frame` while `on`, such as while a
  /// grid scrolls. `flush` reports them with the number that missed a refresh.
  @inline(__always) static func trackFrames(_ on: Bool) {
    #if PK_PERF_LOG
    if on, frameLink == nil {
      let tracker = FrameTracker()
      let link = CADisplayLink(target: tracker, selector: #selector(FrameTracker.tick(_:)))
      link.add(to: .main, forMode: .common)
      frameLink = link
    } else if !on, let link = frameLink {
      link.invalidate()
      frameLink = nil
    }
    #endif
  }

  /// Logs each timing's count, median, 95th percentile and maximum, then resets.
  static func flush(_ reason: StaticString) {
    #if PK_PERF_LOG
    for (name, values) in samples.sorted(by: { $0.key < $1.key }) {
      let sorted = values.sorted()
      let p50 = sorted[sorted.count / 2], p95 = sorted[min(sorted.count - 1, sorted.count * 95 / 100)]
      logger.notice("PKPERF summary=\(name, privacy: .public) reason=\("\(reason)", privacy: .public) n=\(sorted.count, privacy: .public) p50=\(p50, format: .fixed(precision: 3), privacy: .public) p95=\(p95, format: .fixed(precision: 3), privacy: .public) max=\(sorted.last!, format: .fixed(precision: 3), privacy: .public) over16=\(sorted.filter { $0 > 16 }.count, privacy: .public)")
    }
    if !frameIntervals.isEmpty {
      let late = frameIntervals.filter { $0.interval > $0.expected * 1.5 }.count
      let sorted = frameIntervals.map(\.interval).sorted()
      logger.notice("PKPERF frames reason=\("\(reason)", privacy: .public) n=\(sorted.count, privacy: .public) late=\(late, privacy: .public) p50=\(sorted[sorted.count / 2], format: .fixed(precision: 2), privacy: .public) p95=\(sorted[min(sorted.count - 1, sorted.count * 95 / 100)], format: .fixed(precision: 2), privacy: .public) max=\(sorted.last!, format: .fixed(precision: 2), privacy: .public)")
      frameIntervals = []
    }
    samples = [:]
    event("flush")
    #endif
  }

  #if PK_PERF_LOG
  private static let logger = Logger(subsystem: "com.isaacthoman.pulpo.keyboard.perf", category: "perf")
  private static var samples: [String: [Double]] = [:]
  private static var logged: Set<String> = []
  private static var frameLink: CADisplayLink?
  fileprivate static var frameIntervals: [(interval: Double, expected: Double)] = []

  private static func sinceLaunch() -> Double {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var name: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&name, 4, &info, &size, nil, 0) == 0 else { return -1 }
    let start = info.kp_proc.p_un.__p_starttime
    let started = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
    return (Date().timeIntervalSince1970 - started) * 1000
  }

  private static func memory() -> (footprint: Double, peak: Double, remaining: Double) {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(task_self_trap(), task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    guard result == KERN_SUCCESS else { return (-1, -1, -1) }
    let megabyte = 1_048_576.0
    return (Double(info.phys_footprint) / megabyte, Double(info.ledger_phys_footprint_peak) / megabyte, Double(info.limit_bytes_remaining) / megabyte)
  }
  #endif
}

#if PK_PERF_LOG
private final class FrameTracker: NSObject {
  private var last: CFTimeInterval = 0

  @objc func tick(_ link: CADisplayLink) {
    defer { last = link.timestamp }
    guard last > 0 else { return }
    PerfLog.frameIntervals.append(((link.timestamp - last) * 1000, (link.targetTimestamp - link.timestamp) * 1000))
  }
}
#endif
#endif
