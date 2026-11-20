import Foundation

/// In-memory destination evidence. Never write host text to the dictation bridge.
public struct DictationDestination: Equatable, Sendable {
  private let identifier: UUID?
  private let before: String?
  private let after: String?
  private let selection: String?
  private let traits: InputTraits

  public init(document: TextDocument, traits: InputTraits) {
    identifier = document.documentIdentifier
    // Private field contents are not needed even for comparison.
    before = traits.isPrivate ? nil : document.documentContextBeforeInput
    after = traits.isPrivate ? nil : document.documentContextAfterInput
    selection = traits.isPrivate ? nil : document.selectedText
    self.traits = traits
  }

  public var isPrivate: Bool { traits.isPrivate }
  public var hasSelection: Bool { selection?.isEmpty == false }
  public var allowsConfirmation: Bool { !isPrivate && !hasSelection }

  /// Hosts report an empty field, and some every field, as no context at all.
  fileprivate func allowsAutomaticInsertion(hiddenContext: Bool) -> Bool {
    allowsConfirmation && identifier != nil && (hiddenContext || (before != nil && after != nil))
  }
}

/// Automatic delivery belongs to the original, continuously observed destination.
/// A snapshot that changes and later returns to its original value is still stale.
public struct DictationInsertionGuard: Sendable {
  private let origin: DictationDestination
  private let observedContinuously: Bool
  private var invalidated = false

  /// `observedContinuously` is for dictation recorded inside the keyboard: it never
  /// leaves the screen, so any host edit or caret move invalidates the guard, and a
  /// field without visible context (an empty one, usually) is as safe as typing into it.
  public init(origin: DictationDestination, observedContinuously: Bool = false) {
    self.origin = origin
    self.observedContinuously = observedContinuously
  }

  public mutating func invalidate() { invalidated = true }

  public func allowsAutomaticInsertion(at destination: DictationDestination) -> Bool {
    !invalidated && origin.allowsAutomaticInsertion(hiddenContext: observedContinuously) && destination == origin
  }
}
