import Foundation
import Testing
@testable import KeyboardCore

struct OneHandedTests {
  @Test(arguments: [(375.0, 332.0), (393.0, 332.0), (402.0, 332.0), (430.0, 353.0), (440.0, 361.0)])
  func dockedWidthsLeaveRoomForSideControls(width: Double, expected: Double) {
    for mode in [OneHandedMode.left, .right] {
      let keys = mode.keysWidth(in: width)
      #expect(keys == expected)
      #expect(width - keys >= OneHandedMode.minimumPanelWidth)
      // Ten letter pitches with 6.75 pt margins and 6.5 pt gaps keep caps >= 26 pt.
      let cap = (keys - 2 * 6.75 + 6.5) / 10 - 6.5
      #expect(cap >= 25.9)
    }
  }

  @Test(arguments: [0.0, 320.0, 360.0, 667.0, 852.0, 956.0])
  func narrowAndLandscapeKeyboardsStayFullWidth(width: Double) {
    #expect(OneHandedMode.left.keysWidth(in: width) == width)
    #expect(OneHandedMode.right.keysWidth(in: width) == width)
  }

  @Test func offIsAlwaysFullWidth() {
    #expect(OneHandedMode.off.keysWidth(in: 393) == 393)
  }

  @Test func flippingSwitchesSides() {
    #expect(OneHandedMode.left.flipped == .right)
    #expect(OneHandedMode.right.flipped == .left)
    #expect(OneHandedMode.off.flipped == .off)
  }

  @Test func storeRoundTripsAndDefaultsToOff() {
    let defaults = UserDefaults(suiteName: "OneHandedTests-\(UUID().uuidString)")!
    let store = OneHandedStore(defaults: defaults)
    #expect(store.load() == .off)
    store.save(.right)
    #expect(OneHandedStore(defaults: defaults).load() == .right)
    defaults.set("sideways", forKey: OneHandedStore.key)
    #expect(store.load() == .off)
    #expect(OneHandedStore(defaults: nil).load() == .off)
  }

  @Test func searchLayoutKeepsQWERTYWithAWayBack() {
    let layout = KeyboardLayout.emojiSearch()
    let letters = layout.rows.flatMap(\.keys).compactMap { key -> String? in
      if case .character(let text) = key.action { return text }
      return nil
    }
    #expect(letters.joined() == "qwertyuiopasdfghjklzxcvbnm")
    #expect(layout.rows.last?.keys.map(\.identifier) == ["key-letters", "key-emoji", "key-space"])
    #expect(layout.rows[2].keys.last?.action == .delete)
  }
}
