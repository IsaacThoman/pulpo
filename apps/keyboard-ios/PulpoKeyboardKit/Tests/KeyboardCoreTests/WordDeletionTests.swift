import Foundation
import Testing
@testable import KeyboardCore

/// Delete-key swipes: preview, delete whole words in one step, and undo.
struct WordDeletionTests {
  @Test func previewGrowsOneWordAtATimeAndChangesNothing() {
    let (engine, document) = Fixtures.engine("one two three four ")
    #expect(engine.wordDeletionPreview(words: 0) == "")
    #expect(engine.wordDeletionPreview(words: 1) == "four ")
    #expect(engine.wordDeletionPreview(words: 2) == "three four ")
    #expect(engine.wordDeletionPreview(words: 9) == "one two three four ")
    #expect(document.text == "one two three four ")
  }

  @Test func punctuationCountsAsAStepLikeWordRepeat() {
    let (engine, _) = Fixtures.engine("Hi there, friend.")
    #expect(engine.wordDeletionPreview(words: 1) == ".")
    #expect(engine.wordDeletionPreview(words: 2) == "friend.")
    #expect(engine.wordDeletionPreview(words: 3) == ", friend.")
  }

  @Test func deletesTheSwipedWordsLikeGboard() throws {
    // Gboard leaves the space before the first deleted word.
    let (engine, document) = Fixtures.engine("one two three four ")
    let deletion = try #require(engine.deleteWordsBackward(2))
    #expect(document.text == "one two ")
    #expect(deletion.removed == "three four ")
    #expect(engine.composingText == "")
  }

  @Test func undoPutsBackTheTextIncludingTheTouchDownCharacter() throws {
    let (engine, document) = Fixtures.engine("one two three four ")
    let original = engine.contextBeforeCursor
    // The delete key acts on touch down before the finger starts to slide.
    engine.deleteBackward()
    #expect(document.text == "one two three four")
    let deletion = try #require(engine.deleteWordsBackward(2, originalContext: original))
    #expect(document.text == "one two ")
    #expect(deletion.removed == "three four ")
    #expect(engine.undo(deletion))
    #expect(document.text == "one two three four ")
    // Typing continues normally after the restored text.
    engine.type("five")
    #expect(document.text == "one two three four five")
  }

  @Test func undoRestoresTheComposingWordWhenTheCursorEndsInsideIt() throws {
    let (engine, document) = Fixtures.engine("say hello")
    let deletion = try #require(engine.deleteWordsBackward(1))
    #expect(document.text == "say ")
    #expect(engine.undo(deletion))
    #expect(document.text == "say hello")
    #expect(engine.composingText == "hello")
  }

  @Test func undoIsRefusedOnceTheTextChanges() throws {
    let (engine, document) = Fixtures.engine("one two three")
    let deletion = try #require(engine.deleteWordsBackward(1))
    engine.type("x")
    #expect(!engine.canUndo(deletion))
    #expect(!engine.undo(deletion))
    #expect(document.text == "one two x")
  }

  @Test func undoIsRefusedInAnotherDocument() throws {
    let (engine, document) = Fixtures.engine("one two three")
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    let deletion = try #require(engine.deleteWordsBackward(1))
    document.documentIdentifier = UUID()
    engine.documentDidChange()
    #expect(!engine.undo(deletion))
    #expect(document.text == "one two ")
  }

  @Test func nothingToDeleteReturnsNil() {
    let (engine, document) = Fixtures.engine("")
    #expect(engine.deleteWordsBackward(3) == nil)
    #expect(document.text == "")
  }

  @Test func deleteReportsWhenItWouldUndoAnAutocorrection() {
    let (engine, _) = Fixtures.engine()
    engine.type("and teh ")
    #expect(engine.deleteUndoesLastEdit)
    engine.type("cat")
    #expect(!engine.deleteUndoesLastEdit)
  }

  @Test func swipingAfterAnAutocorrectionDeletesWithoutLearningTheTypo() throws {
    // The swipe path never calls deleteBackward, so the correction stays and
    // the typo is neither pinned nor rejected as a correction target.
    let (engine, document) = Fixtures.engine()
    engine.type("and teh ")
    #expect(document.text == "And the ")
    try #require(engine.deleteWordsBackward(1))
    #expect(document.text == "And ")
    engine.type("teh ")
    #expect(document.text == "And the ")
  }
}
