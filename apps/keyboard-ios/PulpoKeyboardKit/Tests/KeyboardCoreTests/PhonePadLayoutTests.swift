import Foundation
import Testing
@testable import KeyboardCore

/// The phone pad and its +*# page.
struct PhonePadLayoutTests {
  private func phoneLayout(_ page: KeyboardPage, needsGlobe: Bool = false) -> KeyboardLayout {
    var traits = InputTraits()
    traits.keyboard = .phonePad
    return KeyboardLayout.make(page: page, traits: traits, needsGlobe: needsGlobe, digitHints: false)
  }

  @Test func phonePadOffersPlusStarAndHash() {
    let digits = phoneLayout(.letters)
    #expect(digits.isNumberPad)
    let labels = digits.rows.map { $0.keys.map(\.label) }
    #expect(labels[0] == ["1", "2", "3"])
    #expect(labels[3] == ["+*#", "0", "delete"])
    let zero = digits.rows[3].keys[1]
    #expect(zero.alternates == ["+"])
    #expect(zero.hint == "+")
    #expect(digits.rows[3].keys[0].action == .page(.symbols))

    let symbols = phoneLayout(.symbols)
    let characters = symbols.rows.flatMap(\.keys).compactMap { key -> String? in
      if case .character(let text) = key.action { return text }
      return nil
    }
    for required in ["+", "*", "#", "(", ")", "-", ",", ";"] {
      #expect(characters.contains(required), "Missing \(required)")
    }
    #expect(symbols.rows[3].keys.map(\.action) == [.page(.letters), .space, .delete])
  }

  @Test func phonePadKeepsTheGlobeWhenTheSystemNeedsIt() {
    let symbols = phoneLayout(.symbols, needsGlobe: true)
    #expect(symbols.rows.flatMap(\.keys).contains { $0.action == .nextKeyboard })
    #expect(symbols.rows.allSatisfy { $0.keys.count == 3 })
  }

  @Test func phonePadIsNumericAndPrivateFromLearning() {
    var traits = InputTraits()
    traits.keyboard = .phonePad
    #expect(traits.isNumeric)
    let policy = InputPolicy(traits: traits, settings: KeyboardSettings())
    #expect(!policy.showsSuggestions && !policy.learns && !policy.autocorrects && !policy.allowsGlide)
  }
}
