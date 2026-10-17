import Foundation
import Testing
@testable import KeyboardCore

struct AccentCompletionTests {
  @Test(arguments: ["Zoë", "Zoe\u{308}", "zoë", "ZOË"])
  func writtenAccentWinsOverMoreFrequentUnaccentedContinuations(prefix: String) {
    let personal = PersonalDictionary(url: nil)
    personal.pin("Zoëline")
    personal.pin("Zoeline")
    for _ in 0..<100 { personal.learn("Zoeline", after: nil) }
    let (_, suggester, _) = Fixtures.stack(personal: personal)
    let set = suggester.suggestions(for: TypedWord(text: prefix), context: .unknown, autocorrect: false)
    let expected = Suggester.matchCase(of: prefix, to: "Zoëline")
    #expect(set.slots.contains { $0.text == expected && $0.kind == .completion })
    #expect(set.slots.first { $0.kind == .literal }?.text == prefix)
    #expect(set.slots.count <= 3)
    #expect(set.autocorrection == nil)

    // Without an entered accent, frequency remains the evidence for spelling.
    let plain = suggester.suggestions(for: TypedWord(text: "Zoe"), context: .unknown, autocorrect: false)
    #expect(plain.slots.first { $0.kind != .literal }?.text == "Zoeline")
  }

  @Test func aBlockedAccentedContinuationStaysBlocked() {
    let personal = PersonalDictionary(url: nil)
    personal.pin("Zoëline")
    personal.forget("Zoëline")
    let (_, suggester, _) = Fixtures.stack(personal: personal)
    let set = suggester.suggestions(for: TypedWord(text: "Zoë"), context: .unknown, autocorrect: false)
    #expect(!set.slots.contains { $0.text == "Zoëline" })
    #expect(set.slots.contains { $0.text == "Zoë" && $0.kind == .literal })
  }

  @Test func selectingAnAccentedCompletionPreservesItsSpelling() throws {
    let (engine, document) = Fixtures.engine("We discussed nai\u{308}")
    let suggestion = try #require(engine.suggestions.slots.first { $0.text == "naïve" })
    #expect(engine.suggestions.autocorrection == nil)
    engine.select(suggestion)
    #expect(document.text == "We discussed naïve ")
  }
}
