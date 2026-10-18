import Foundation
import Testing
@testable import KeyboardCore

/// Diagnostic boundary check: the engine intentionally edits its current
/// document. A passing reproduction is not controller acceptance; the controller
/// must authorize the original destination before using this primitive.
struct DictationDestinationBaselineTests {
  @Test func matchingRequestDeliveryDoesNotProtectAChangedField() {
    let document = MockDocument("original field")
    document.documentIdentifier = UUID()
    let engine = KeyboardEngine(document: document, suggester: nil, glide: nil)
    engine.documentDidChange()
    // The baseline controller checks only the request ID, then calls this engine.
    document.documentIdentifier = UUID()
    document.text = "another field"
    document.cursor = document.text.endIndex
    engine.insertTranscript("spoken words")
    #expect(document.text == "another field spoken words")
  }
}
