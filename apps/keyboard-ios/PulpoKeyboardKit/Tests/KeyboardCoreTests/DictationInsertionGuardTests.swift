import Foundation
import Testing
@testable import KeyboardCore

struct DictationInsertionGuardTests {
  private final class DestinationDocument: TextDocument {
    var documentIdentifier: UUID? = UUID()
    var before: String? = "hello "
    var after: String? = "world"
    var selection: String?
    var contextReads = 0
    var documentContextBeforeInput: String? { contextReads += 1; return before }
    var documentContextAfterInput: String? { contextReads += 1; return after }
    var selectedText: String? { contextReads += 1; return selection }
    var hasText: Bool { true }
    func insertText(_ text: String) { Issue.record("Unexpected document mutation") }
    func deleteBackward() { Issue.record("Unexpected document mutation") }
  }

  @Test func unchangedIdentifiedPublicCaretCanReceiveAutomatically() {
    let document = DestinationDocument()
    let origin = DictationDestination(document: document, traits: InputTraits())
    let guarder = DictationInsertionGuard(origin: origin)
    #expect(guarder.allowsAutomaticInsertion(at: origin))
    #expect(origin.allowsConfirmation)
  }

  @Test func identicalTextInAnotherFieldNeedsConfirmation() {
    let document = DestinationDocument()
    let origin = DictationDestination(document: document, traits: InputTraits())
    let guarder = DictationInsertionGuard(origin: origin)
    document.documentIdentifier = UUID()
    let current = DictationDestination(document: document, traits: InputTraits())
    #expect(!guarder.allowsAutomaticInsertion(at: current))
    #expect(current.allowsConfirmation)
  }

  @Test func caretSelectionAndExactContextChangesRefuseAutomaticDelivery() {
    let changes: [(DestinationDocument) -> Void] = [
      { $0.before = "hello w"; $0.after = "orld" },
      { $0.selection = "world"; $0.after = "" },
      { $0.before = "lo " }, // A matching suffix is not the same snapshot.
      { $0.after = "wor" },
      { $0.before = "edited " },
    ]
    for change in changes {
      let document = DestinationDocument()
      let guarder = DictationInsertionGuard(origin: DictationDestination(document: document, traits: InputTraits()))
      change(document)
      #expect(!guarder.allowsAutomaticInsertion(at: DictationDestination(document: document, traits: InputTraits())))
    }
  }

  @Test func missingIdentityOrEitherSideRequiresConfirmation() {
    let changes: [(DestinationDocument) -> Void] = [
      { $0.documentIdentifier = nil }, { $0.before = nil }, { $0.after = nil },
      { $0.before = nil; $0.after = nil },
    ]
    for change in changes {
      let document = DestinationDocument()
      change(document)
      let destination = DictationDestination(document: document, traits: InputTraits())
      #expect(!DictationInsertionGuard(origin: destination).allowsAutomaticInsertion(at: destination))
      #expect(destination.allowsConfirmation)
    }
  }

  @Test func explicitEmptyContextIsObservableUnlikeNil() {
    let document = DestinationDocument()
    document.before = ""
    document.after = ""
    let destination = DictationDestination(document: document, traits: InputTraits())
    #expect(DictationInsertionGuard(origin: destination).allowsAutomaticInsertion(at: destination))
  }

  @Test func originalSelectionCannotBeOverwrittenEvenWithMatchingSnapshots() {
    let document = DestinationDocument()
    document.selection = "world"
    let destination = DictationDestination(document: document, traits: InputTraits())
    #expect(destination.hasSelection)
    #expect(!destination.allowsConfirmation)
    #expect(!DictationInsertionGuard(origin: destination).allowsAutomaticInsertion(at: destination))
  }

  @Test func privateDestinationNeitherReadsHostTextNorPermitsInsertion() {
    let document = DestinationDocument()
    for contentType in ["password", "username", "oneTimeCode"] {
      var traits = InputTraits()
      traits.contentType = contentType
      let destination = DictationDestination(document: document, traits: traits)
      #expect(destination.isPrivate)
      #expect(!destination.allowsConfirmation)
      #expect(!DictationInsertionGuard(origin: destination).allowsAutomaticInsertion(at: destination))
    }
    var traits = InputTraits()
    traits.isSecure = true
    #expect(!DictationDestination(document: document, traits: traits).allowsConfirmation)
    #expect(document.contextReads == 0)
  }

  @Test func changedThenRestoredSnapshotDoesNotReviveAutomaticDelivery() {
    let document = DestinationDocument()
    let origin = DictationDestination(document: document, traits: InputTraits())
    var guarder = DictationInsertionGuard(origin: origin)
    document.before = "edited "
    guarder.invalidate() // A host edit, including one with a lagging snapshot.
    document.before = "hello "
    #expect(DictationDestination(document: document, traits: InputTraits()) == origin)
    #expect(!guarder.allowsAutomaticInsertion(at: origin))
  }

  @Test func impendingChangeOrLostVisibilityInvalidatesEvenALaggingSnapshot() {
    let document = DestinationDocument()
    let origin = DictationDestination(document: document, traits: InputTraits())
    var guarder = DictationInsertionGuard(origin: origin)
    guarder.invalidate()
    #expect(!guarder.allowsAutomaticInsertion(at: origin))
  }

  @Test func traitChangeRequiresConfirmationEvenWithoutTextChange() {
    let document = DestinationDocument()
    let origin = DictationDestination(document: document, traits: InputTraits())
    var traits = InputTraits()
    traits.keyboard = .email
    let current = DictationDestination(document: document, traits: traits)
    #expect(!DictationInsertionGuard(origin: origin).allowsAutomaticInsertion(at: current))
  }
}
