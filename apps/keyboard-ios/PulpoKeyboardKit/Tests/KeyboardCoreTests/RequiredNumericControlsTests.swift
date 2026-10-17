import Foundation
import Testing
@testable import KeyboardCore

struct RequiredNumericControlsTests {
  @Test func decimalFieldKeepsRegionEntryAndRequiredKeyboardSwitchVisible() {
    var traits = InputTraits()
    traits.keyboard = .decimalPad
    let pad = KeyboardLayout.make(page: .letters, traits: traits, needsGlobe: true, digitHints: false)
    let keys = pad.rows.flatMap(\.keys)
    #expect(keys.contains { $0.action == .character(Locale.autoupdatingCurrent.decimalSeparator ?? ".") })
    #expect(keys.contains { $0.action == .nextKeyboard })
    #expect(keys.contains { $0.action == .character("0") })
    #expect(keys.contains { $0.action == .delete })
    #expect(pad.rows[3].keys.reduce(0) { $0 + $1.width } == 3)
  }
}
