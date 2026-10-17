import Foundation
import Testing
@testable import KeyboardCore

struct NumericLocaleLayoutTests {
  private func layout(_ keyboard: InputTraits.Keyboard = .decimalPad, separator: String?, globe: Bool) -> KeyboardLayout {
    var traits = InputTraits()
    traits.keyboard = keyboard
    return KeyboardLayout.make(page: .letters, traits: traits, needsGlobe: globe, digitHints: false, decimalSeparator: separator)
  }

  @Test func decimalEntryKeepsLocaleSeparatorAndRequiredSwitcherTogether() {
    for locale in ["en_US", "es_ES", "es_MX", "ar_EG"] {
      let separator = Locale(identifier: locale).decimalSeparator!
      for globe in [false, true] {
        let pad = layout(separator: separator, globe: globe)
        let keys = pad.rows.flatMap(\.keys)
        #expect(keys.filter { $0.action == .nextKeyboard }.count == (globe ? 1 : 0))
        #expect(keys.contains { $0.action == .character(separator) && $0.label == separator })
        #expect(keys.filter { $0.action == .delete }.count == 1)
        for digit in "0123456789" {
          #expect(keys.filter { $0.action == .character(String(digit)) }.count == 1)
        }
        #expect(pad.rows.count == 4)
        // Numeric KeysView has three pitches, including the row's key gaps.
        #expect(pad.rows[3].keys.reduce(0) { $0 + $1.width } == 3)
        #expect(pad.rows[3].keys.allSatisfy { !$0.flexible })
      }
    }
  }

  @Test func missingOrMalformedSeparatorFallsBackWithoutChangingOtherPads() {
    for invalid: String? in [nil, "", " ", "\n", "1", "abc", "..", "💰"] {
      #expect(layout(separator: invalid, globe: true).rows[3].keys.first?.action == .character("."))
    }
    for separator in [".", ",", "٫"] {
      let number = layout(.numberPad, separator: separator, globe: true)
      #expect(number.rows[3].keys.map(\.action) == [.nextKeyboard, .character("0"), .delete])
      let noGlobe = layout(.numberPad, separator: separator, globe: false)
      #expect(noGlobe.rows[3].keys.map(\.action) == [.text(""), .character("0"), .delete])
      for keyboard: InputTraits.Keyboard in [.phonePad, .standard, .email, .url] {
        #expect(layout(keyboard, separator: separator, globe: true) == layout(keyboard, separator: ".", globe: true))
      }
    }
  }

}
