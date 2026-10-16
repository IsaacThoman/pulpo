import Foundation
import Testing
@testable import KeyboardCore

struct ContextVisibilityTests {
  @Test(arguments: [false, true], [false, true])
  func contextLossClearsWordUndo(swipe: Bool, secure: Bool) {
    let (engine, document) = Fixtures.engine()
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    if swipe {
      engine.insertGlide("helo".utf8.compactMap { engine.glide!.geometry.center($0) })
      #expect(document.text == "Hello")
    } else {
      engine.type("teh ")
      #expect(document.text == "The ")
    }
    let expected = String(document.text.dropLast())
    // The same field starts withholding context without changing its identity.
    document.hidesContext = true
    var traits = engine.traits
    traits.isSecure = secure
    engine.traits = traits
    engine.documentDidChange()
    #expect(engine.composingText.isEmpty)
    #expect(!engine.phantomSpace)
    #expect(engine.laggingContextUpdates == 0)
    let deletions = document.deletions
    engine.deleteBackward()
    #expect(document.text == expected)
    #expect(document.deletions == deletions + 1)
    engine.save()
    #expect(engine.suggester!.model.personal.count(of: swipe ? "hello" : "the") == 0)
  }

  @Test func contextLossDropsSwipeSpacingAndTentativeLearning() {
    var traits = InputTraits()
    traits.capitalization = .none
    let (engine, document) = Fixtures.engine(traits: traits)
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    engine.insertGlide("helo".utf8.compactMap { engine.glide!.geometry.center($0) })
    #expect(document.text == "hello")
    document.hidesContext = true
    engine.documentDidChange()
    engine.insertCharacter("a")
    engine.save()
    #expect(document.text == "helloa")
    #expect(engine.suggester!.model.personal.count(of: "hello") == 0)
  }

  @Test func contextLossDropsUncommittedComposition() {
    let (engine, document) = Fixtures.engine()
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    engine.clock = { 100 }
    engine.type("teh")
    document.hidesContext = true
    engine.documentDidChange()
    #expect(engine.composingText.isEmpty)
    engine.insertSpace()
    #expect(document.text == "Teh ")
  }

  @Test func consistentlyHiddenContextPreservesItsOwnDelayedCallbacks() {
    let document = MockDocument("existing ")
    document.documentIdentifier = UUID()
    document.hidesContext = true
    let (_, suggester, glide) = Fixtures.stack()
    let engine = KeyboardEngine(document: document, suggester: suggester, glide: glide)
    var traits = InputTraits()
    traits.capitalization = .none
    engine.traits = traits
    engine.clock = { 100 }
    engine.documentDidChange()
    document.onWillEdit = { engine.documentDidChange() }
    engine.type("teh ")
    #expect(document.text == "existing the ")
    #expect(engine.before == "the ")
    #expect(engine.externalContextChanges == 0)
    document.onWillEdit = nil
    engine.deleteBackward()
    #expect(document.text == "existing teh")
    document.hidesContext = false
    engine.documentDidChange()
    #expect(engine.composingText == "teh")
  }

  @Test func naturalNilEdgesKeepFirstSwipeState() {
    let (engine, document) = edgeEngine()
    engine.insertGlide("helo".utf8.compactMap { engine.glide!.geometry.center($0) })
    let alternatives = engine.suggestions
    engine.documentDidChange()
    #expect(engine.phantomSpace)
    #expect(engine.suggestions == alternatives)
    engine.deleteBackward()
    #expect(document.backing.text.isEmpty)
  }

  @Test func naturalNilEdgesKeepFirstWordTapEvidence() {
    let (engine, document) = edgeEngine()
    document.backing.onWillEdit = { engine.documentDidChange() }
    let taps = [KeyPoint(x: 4.4, y: 0.1), KeyPoint(x: 2.2, y: 0.1), KeyPoint(x: 5.6, y: 1.1)]
    for (character, tap) in zip("teh", taps) {
      engine.insertCharacter(String(character), tap: tap)
      engine.documentDidChange()
    }
    #expect(engine.composingText == "teh")
    #expect(engine.composing.taps == taps.map(Optional.some))
    #expect(engine.before == "teh")
    #expect(engine.externalContextChanges == 0)
  }

  @Test func naturalNilEdgesKeepThePrefixAcrossAutocorrection() {
    let (engine, document) = edgeEngine()
    document.backing.onWillEdit = { engine.documentDidChange() }
    engine.type("teh ")
    engine.documentDidChange()
    #expect(document.backing.text == "the ")
    #expect(engine.before == "the ")
    document.backing.onWillEdit = nil
    engine.deleteBackward()
    #expect(document.backing.text == "teh")
    #expect(engine.before == "teh")
  }

  @Test func delayedInitialNilSnapshotDoesNotEraseTapEvidence() {
    let (engine, document) = edgeEngine()
    engine.insertCharacter("a", tap: KeyPoint(x: 0.4, y: 1.1))
    document.backing.contextBeforeOverride = ""
    engine.documentDidChange()
    document.backing.contextBeforeOverride = nil
    engine.insertCharacter("b", tap: KeyPoint(x: 4.6, y: 2.1))
    engine.documentDidChange()
    #expect(document.backing.text == "ab")
    #expect(engine.composingText == "ab")
    #expect(engine.composing.taps == [KeyPoint(x: 0.4, y: 1.1), KeyPoint(x: 4.6, y: 2.1)])
  }

  @Test func privateTransitionClearsUndoEvenWhenItMatchesANaturalNilSnapshot() {
    let (engine, document) = edgeEngine()
    engine.insertGlide("helo".utf8.compactMap { engine.glide!.geometry.center($0) })
    document.backing.hidesContext = true
    var traits = engine.traits
    traits.isSecure = true
    engine.traits = traits
    engine.documentDidChange()
    engine.deleteBackward()
    #expect(document.backing.text == "hell")
    #expect(document.backing.deletions == 1)
    #expect(!engine.phantomSpace)
  }

  private func edgeEngine() -> (KeyboardEngine, EdgeNilDocument) {
    let document = EdgeNilDocument()
    let (_, suggester, glide) = Fixtures.stack()
    let engine = KeyboardEngine(document: document, suggester: suggester, glide: glide)
    var traits = InputTraits()
    traits.capitalization = .none
    engine.traits = traits
    engine.clock = { 100 }
    engine.documentDidChange()
    return (engine, document)
  }

  private final class EdgeNilDocument: TextDocument {
    let backing = MockDocument()
    let documentIdentifier: UUID? = UUID()
    var documentContextBeforeInput: String? {
      backing.documentContextBeforeInput.flatMap { $0.isEmpty ? nil : $0 }
    }
    var documentContextAfterInput: String? {
      backing.documentContextAfterInput.flatMap { $0.isEmpty ? nil : $0 }
    }
    var selectedText: String? { backing.selectedText }
    var hasText: Bool { backing.hasText }
    func insertText(_ text: String) { backing.insertText(text) }
    func deleteBackward() { backing.deleteBackward() }
  }

}
