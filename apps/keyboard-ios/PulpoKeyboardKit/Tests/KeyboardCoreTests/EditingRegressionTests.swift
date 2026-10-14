import Foundation
import Testing
@testable import KeyboardCore

/// Minimal editing repros found by the randomized editing fuzzer (`EngineFuzz`).
struct EditingRegressionTests {
  @Test func suggestionBeforeExistingSpaceDoesNotDoubleIt() throws {
    let (engine, document) = Fixtures.engine("I like beau world")
    document.moveCursor(to: 11)
    engine.documentDidChange()
    #expect(engine.composingText == "beau")
    let pick = try #require(engine.suggestions.slots.first { $0.text == "beautiful" })
    engine.select(pick)
    #expect(document.text == "I like beautiful world")
    engine.insertCharacter(",")
    #expect(document.text == "I like beautiful, world")
  }

  @Test func keptLiteralBeforeExistingSpaceAddsNothing() throws {
    let (engine, document) = Fixtures.engine("say teh now")
    document.moveCursor(to: 7)
    engine.documentDidChange()
    let literal = try #require(engine.suggestions.slots.first { $0.kind == .literal })
    engine.select(literal)
    #expect(document.text == "say teh now")
  }
}
