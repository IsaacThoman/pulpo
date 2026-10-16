import Foundation
import Testing
@testable import KeyboardCore

/// A bottom-row letter tap can land on the space bar: "ha e" for have. Once the
/// next word ends, the space is read as the letter it landed beside when the
/// joined word clearly beats the words as typed. Backspace restores them.
struct SpaceSlipTests {
  static func center(_ letter: Character) -> KeyPoint {
    LetterGeometry.qwerty.center(letter.asciiValue!)!
  }

  /// A space touch `drop` pitches below `letter`'s center.
  static func space(below letter: Character, drop: Double) -> KeyPoint {
    let center = center(letter)
    return KeyPoint(x: center.x, y: center.y + drop)
  }

  @Test func aLetterOnTheSpaceBarJoinsTheWordAroundIt() {
    let (engine, document) = Fixtures.engine("I ")
    engine.type("ha")
    engine.insertSpace(tap: Self.space(below: "v", drop: 0.55))
    engine.type("e ")
    #expect(document.text == "I have ")
  }

  @Test func backspaceRestoresTheWordsAsTyped() {
    let (engine, document) = Fixtures.engine("I ")
    engine.type("ha")
    engine.insertSpace(tap: Self.space(below: "v", drop: 0.55))
    engine.type("e ")
    #expect(engine.deleteUndoesLastEdit)
    engine.deleteBackward()
    #expect(document.text == "I ha e")
    engine.insertSpace()
    #expect(document.text == "I ha e ")
  }

  @Test func aSpaceTouchedWellBelowTheLettersStaysASpace() {
    let (engine, document) = Fixtures.engine("I ")
    engine.type("ha")
    engine.insertSpace(tap: Self.space(below: "v", drop: 0.95))
    engine.type("e ")
    #expect(document.text == "I ha e ")
  }

  @Test func withoutATouchLocationSpacesAreNeverReinterpreted() {
    let (engine, document) = Fixtures.engine("I ")
    engine.type("ha e ")
    #expect(document.text == "I ha e ")
  }

  @Test func theLastLetterOfAWordCanLandOnTheSpaceBar() {
    let (engine, document) = Fixtures.engine("It has ")
    engine.type("bee")
    engine.insertSpace(tap: Self.space(below: "n", drop: 0.55))
    engine.insertSpace()
    // Read as "been", not as a double-space period.
    #expect(document.text == "It has been ")
  }

  @Test func acronymsAndShortWordsWithTheirOwnReadingStaySeparate() {
    let (engine, document) = Fixtures.engine("he was ")
    engine.type("a")
    engine.insertSpace(tap: Self.space(below: "b", drop: 0.6))
    engine.type("RB ")
    #expect(document.text == "he was a RB ")
  }

  @Test func autocorrectOffNeverJoins() {
    var settings = KeyboardSettings()
    settings.autocorrect = false
    let (engine, document) = Fixtures.engine("I ", settings: settings)
    engine.type("ha")
    engine.insertSpace(tap: Self.space(below: "v", drop: 0.55))
    engine.type("e ")
    #expect(document.text == "I ha e ")
  }

  @Test func privateFieldsNeverJoin() {
    var traits = InputTraits()
    traits.isSecure = true
    let (engine, document) = Fixtures.engine("", traits: traits)
    engine.type("ha")
    engine.insertSpace(tap: Self.space(below: "v", drop: 0.55))
    engine.type("e ")
    #expect(document.text.lowercased() == "ha e ", "\(document.text)")
  }

  @Test func onlyLettersBorderingTheSpaceBarAreCandidates() {
    let (_, suggester, _) = Fixtures.stack()
    #expect(suggester.spaceSlipLetter(at: Self.space(below: "v", drop: 0.55))?.letter == "v")
    #expect(suggester.spaceSlipLetter(at: Self.space(below: "b", drop: 0.6))?.letter == "b")
    #expect(suggester.spaceSlipLetter(at: Self.space(below: "v", drop: 1.0)) == nil)
    // Above the bottom row is a letter tap, not a space.
    #expect(suggester.spaceSlipLetter(at: Self.center("g")) == nil)
  }
}
