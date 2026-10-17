import Foundation
import Testing
@testable import KeyboardCore

/// The app's setup screen learns Full Access from the keyboard's own reports.
struct SetupStatusTests {
  let now = Date(timeIntervalSince1970: 1_800_000_000)

  @Test func unknownUntilTheKeyboardHasAppeared() {
    #expect(KeyboardHeartbeat.fullAccess(heartbeat: nil, limitedSeenAt: nil) == nil)
  }

  @Test func heartbeatMeansFullAccess() {
    let heartbeat = KeyboardHeartbeat(hasFullAccess: true, lastSeen: now)
    #expect(KeyboardHeartbeat.fullAccess(heartbeat: heartbeat, limitedSeenAt: nil) == true)
  }

  @Test func appearingWithoutFullAccessMeansOff() {
    #expect(KeyboardHeartbeat.fullAccess(heartbeat: nil, limitedSeenAt: now) == false)
  }

  /// Turning Full Access off can't rewrite the heartbeat, so a newer limited sighting wins.
  @Test func newerSightingWins() {
    let heartbeat = KeyboardHeartbeat(hasFullAccess: true, lastSeen: now)
    #expect(KeyboardHeartbeat.fullAccess(heartbeat: heartbeat, limitedSeenAt: now.addingTimeInterval(60)) == false)
    #expect(KeyboardHeartbeat.fullAccess(heartbeat: heartbeat, limitedSeenAt: now.addingTimeInterval(-60)) == true)
  }

  @Test func heartbeatRoundTripsAndClears() throws {
    let suite = "SetupStatusTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    #expect(KeyboardHeartbeat.load(defaults: defaults) == nil)
    KeyboardHeartbeat.record(hasFullAccess: true, defaults: defaults)
    #expect(KeyboardHeartbeat.load(defaults: defaults)?.hasFullAccess == true)
    KeyboardHeartbeat.clear(defaults: defaults)
    #expect(KeyboardHeartbeat.load(defaults: defaults) == nil)
  }

  @Test func appearanceNotificationsAreDistinct() {
    let full = KeyboardHeartbeat.appearedNotification(fullAccess: true)
    let limited = KeyboardHeartbeat.appearedNotification(fullAccess: false)
    #expect(full != limited)
    #expect(full.hasPrefix(AppGroup.identifier))
  }
}
