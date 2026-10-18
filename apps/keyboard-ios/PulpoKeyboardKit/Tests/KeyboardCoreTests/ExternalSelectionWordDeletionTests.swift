import Foundation
import Testing
@testable import KeyboardCore

struct ExternalSelectionWordDeletionTests {
  /// Unlike a selection-only proxy override, edits really replace this range.
  private final class Host: TextDocument {
    var documentIdentifier: UUID? = UUID()
    var text: String
    var cursor: Int
    var selectionLength = 0
    var deletions = 0
    var hidesContext = false
    var selectionSnapshot: String?

    init(_ text: String) { self.text = text; cursor = text.count }
    private var characters: [Character] { Array(text) }
    var documentContextBeforeInput: String? { hidesContext ? nil : String(characters.prefix(cursor)) }
    var documentContextAfterInput: String? { hidesContext ? nil : String(characters.dropFirst(cursor + selectionLength)) }
    var selectedText: String? {
      selectionSnapshot ?? (selectionLength == 0 ? nil : String(characters.dropFirst(cursor).prefix(selectionLength)))
    }
    var hasText: Bool { !text.isEmpty }

    func insertText(_ inserted: String) {
      text = String(characters.prefix(cursor)) + inserted + String(characters.dropFirst(cursor + selectionLength))
      cursor += inserted.count
      selectionLength = 0
    }

    func deleteBackward() {
      deletions += 1
      if selectionLength > 0 {
        text = String(characters.prefix(cursor)) + String(characters.dropFirst(cursor + selectionLength))
        selectionLength = 0
      } else if cursor > 0 {
        text = String(characters.prefix(cursor - 1)) + String(characters.dropFirst(cursor))
        cursor -= 1
      }
    }
  }

  @Test func freshSelectionDeletesOnlyItsRangeAndUndoRestoresItsActualContents() throws {
    let host = Host("prefix chosen suffix")
    let engine = KeyboardEngine(document: host, suggester: nil, glide: nil)
    engine.documentDidChange()
    let gestureOrigin = engine.contextBeforeCursor
    // A host selection arrives while a delete swipe is in progress.
    host.cursor = 7
    host.selectionLength = 6
    engine.documentDidChange()

    let deletion = try #require(engine.deleteWordsBackward(3, originalContext: gestureOrigin))
    #expect(host.text == "prefix  suffix")
    #expect(host.deletions == 1)
    #expect(deletion.removed == "chosen")
    #expect(engine.undo(deletion))
    #expect(host.text == "prefix chosen suffix")
  }

  @Test func selectedRangeAtDocumentStartCanBeDeletedAndRestored() throws {
    let host = Host("👩🏽‍💻 café tail")
    host.cursor = 0
    host.selectionLength = "👩🏽‍💻 café".count
    let engine = KeyboardEngine(document: host, suggester: nil, glide: nil)
    engine.documentDidChange()

    let deletion = try #require(engine.deleteWordsBackward(1))
    #expect(host.text == " tail")
    #expect(host.deletions == 1)
    #expect(deletion.removed == "👩🏽‍💻 café")
    #expect(engine.undo(deletion))
    #expect(host.text == "👩🏽‍💻 café tail")
  }

  @Test func freshExternalSuffixEditInvalidatesSelectionUndo() throws {
    let host = Host("prefix chosen suffix")
    host.cursor = 7
    host.selectionLength = 6
    let engine = KeyboardEngine(document: host, suggester: nil, glide: nil)
    engine.documentDidChange()
    let deletion = try #require(engine.deleteWordsBackward(1))

    // The prefix/caret still match, but the host changed the following text.
    host.text = "prefix external"
    engine.documentDidChange()
    #expect(!engine.canUndo(deletion))
    #expect(!engine.undo(deletion))
    #expect(host.text == "prefix external")
  }

  @Test func zeroWordGestureDoesNotDeleteASelection() {
    let host = Host("chosen tail")
    host.cursor = 0
    host.selectionLength = 6
    let engine = KeyboardEngine(document: host, suggester: nil, glide: nil)
    engine.documentDidChange()
    #expect(engine.deleteWordsBackward(0) == nil)
    #expect(host.text == "chosen tail")
    #expect(host.deletions == 0)
  }

  @Test(arguments: [false, true])
  func liveSelectionWithWithheldContextIsReconciledBeforeItsCallback(initiallyHidden: Bool) throws {
    let host = Host("prefix chosen suffix")
    host.hidesContext = initiallyHidden
    let engine = KeyboardEngine(document: host, suggester: nil, glide: nil)
    engine.documentDidChange()
    host.cursor = 7
    host.selectionLength = 6
    host.hidesContext = true
    // The live selection is available; the text/selection callback has not arrived.
    let deletion = try #require(engine.deleteWordsBackward(1))
    #expect(host.text == "prefix  suffix")
    #expect(host.deletions == 1)
    #expect(deletion.removed == "chosen")
    #expect(engine.undo(deletion))
    #expect(host.text == "prefix chosen suffix")
  }

  @Test func delayedOwnSelectionSnapshotInHiddenContextPreservesWordDeletion() throws {
    let host = Host("chosen tail")
    host.cursor = 0
    host.selectionLength = 6
    host.hidesContext = true
    let engine = KeyboardEngine(document: host, suggester: nil, glide: nil)
    engine.documentDidChange()
    // Keep reporting the selection our own insertion has already replaced.
    host.selectionSnapshot = "chosen"
    engine.insertText("hello")
    let deletion = try #require(engine.deleteWordsBackward(1))
    #expect(host.text == " tail")
    #expect(host.deletions == 5)
    #expect(deletion.removed == "hello")
  }
}
