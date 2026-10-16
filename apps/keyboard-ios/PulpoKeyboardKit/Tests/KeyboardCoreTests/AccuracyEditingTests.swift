import Foundation
import Testing
@testable import KeyboardCore

struct AccuracyEditingTests {
  @Test(arguments: ["Hello again", "Good morning", "See you soon"])
  func pendingHostChangesPrecedeTranscriptCapitalization(transcript: String) {
    // A send/clear and a host paste can beat their asynchronous text callbacks.
    for (initial, current, expected) in [
      ("old message ", "", transcript),
      ("", "please ", "please " + transcript.prefix(1).lowercased() + transcript.dropFirst()),
      ("old message ", "Done. ", "Done. " + transcript),
    ] {
      let (engine, document) = Fixtures.engine(initial)
      document.text = current
      document.cursor = document.text.endIndex
      engine.insertTranscript(transcript)
      #expect(document.text == expected, "\(initial.debugDescription) -> \(current.debugDescription)")
    }
  }

  @Test func pendingCursorMovePrecedesTranscriptCapitalization() {
    let (engine, document) = Fixtures.engine("A note. please ")
    document.moveCursor(to: 0)  // No callback before dictation arrives.
    engine.insertTranscript("Hello again")
    #expect(document.text == "Hello againA note. please ")
  }

  @Test(arguments: ["Mireya", "Zayden", "GitHub"])
  func transcriptReconciliationPreservesLiteralCapitals(name: String) {
    let (engine, document) = Fixtures.engine()
    document.insertText("ask ")
    engine.insertTranscript(name)
    #expect(document.text == "ask " + name)
  }

  @Test func transcriptReconciliationPreservesKnownOwnEditLag() {
    let (engine, document) = Fixtures.engine("a ")
    document.contextBeforeOverride = document.text
    engine.type("note")
    engine.insertTranscript("Hello again")
    #expect(document.text == "a note hello again")
    #expect(engine.externalContextChanges == 0)
  }

  @Test(arguments: [false, true])
  func ignoredStaleChoicesPreserveSpaceSlipEvidence(lastLetter: Bool) throws {
    let prefix = lastLetter ? "It has " : "I "
    let fragment = lastLetter ? "bee" : "ha"
    let letter: Character = lastLetter ? "n" : "v"
    let (engine, document) = Fixtures.engine(prefix)
    engine.type(fragment)
    let stale = try #require(engine.suggestions.slots.first { $0.kind == .literal })
    engine.insertSpace(tap: SpaceSlipTests.space(below: letter, drop: 0.55))
    if !lastLetter { engine.type("e") }
    let unchanged = document.text
    engine.select(stale)
    #expect(document.text == unchanged)
    engine.insertSpace()
    #expect(document.text == (lastLetter ? "It has been " : "I have "))
    // Undo still restores exactly what was typed, without pinning a stale word.
    engine.deleteBackward()
    #expect(document.text == (lastLetter ? "It has bee " : "I ha e"))
  }

  @Test func ignoredStaleEmojiPreservesSpaceSlipEvidence() throws {
    let (engine, document) = Fixtures.engine("I ")
    engine.emojiSuggester = try EmojiSuggester(catalog: EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json")))
    engine.type("pizza")
    let stale = try #require(engine.suggestions.slots.first { $0.kind == .emoji })
    document.text = "I "
    document.cursor = document.text.endIndex
    engine.documentDidChange()
    engine.type("ha")
    engine.insertSpace(tap: SpaceSlipTests.space(below: "v", drop: 0.55))
    engine.type("e")
    engine.select(stale)
    engine.insertSpace()
    #expect(document.text == "I have ")
  }
}
