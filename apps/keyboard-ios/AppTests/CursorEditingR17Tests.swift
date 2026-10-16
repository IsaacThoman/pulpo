import UIKit
import XCTest
@testable import PulpoKeyboard

/// Frozen synthetic documents through the production native preview host.
/// This isolates host offsets from suggestion/correction decisions.
@MainActor
final class CursorEditingR17Tests: XCTestCase {
  struct Input: Decodable {
    let id: String
    let language: String
    let document: String
    let selectionUTF16: [Int]
    let offset: Int
    let insert: String
    let expectedDocument: String
    let expectedSelectionUTF16: [Int]
  }
  struct Suite: Decodable { let cases: [Input] }
  struct Outcome: Encodable {
    let id: String
    let language: String
    let initialDocument: String
    let initialSelectionUTF16: [Int]
    let offset: Int
    let document: String
    let exactDocumentUTF16: [UInt16]
    let movementSelectionUTF16: [Int]
    let finalSelectionUTF16: [Int]
    let expectedDocument: String
    let expectedSelectionUTF16: [Int]
    let documentPassed: Bool
    let selectionPassed: Bool
    let ui: String
  }

  func testFrozenCases() throws {
    let directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .appendingPathComponent("audits/editing-ux-r17")
    let path = ProcessInfo.processInfo.environment["PK_R17_CASES"]
    let url = path.map { URL(fileURLWithPath: $0) } ?? directory.appendingPathComponent("cursor-development-v2.json")
    let inputs = try JSONDecoder().decode(Suite.self, from: Data(contentsOf: url)).cases
    var outcomes: [Outcome] = []
    for input in inputs {
      let editor = UITextView()
      editor.text = input.document
      editor.selectedRange = NSRange(location: input.selectionUTF16[0], length: input.selectionUTF16[1])
      let host = PreviewHost(textView: editor) { _ in XCTFail("Cursor movement must not navigate") }
      host.adjustTextPosition(byCharacterOffset: input.offset)
      let moved = editor.selectedRange
      editor.insertText(input.insert)
      let raw = editor.text as NSString
      let units = (0..<raw.length).map { raw.character(at: $0) }
      let actual = String(decoding: units, as: UTF16.self)
      let selection = [editor.selectedRange.location, editor.selectedRange.length]
      outcomes.append(Outcome(id: input.id, language: input.language, initialDocument: input.document,
        initialSelectionUTF16: input.selectionUTF16, offset: input.offset, document: actual, exactDocumentUTF16: units,
        movementSelectionUTF16: [moved.location, moved.length], finalSelectionUTF16: selection,
        expectedDocument: input.expectedDocument, expectedSelectionUTF16: input.expectedSelectionUTF16,
        documentPassed: units == Array(input.expectedDocument.utf16), selectionPassed: selection == input.expectedSelectionUTF16,
        ui: "Real UITextView + PreviewHost; no keyboard controller or engine; engine language not exercised"))
    }
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    if let path = ProcessInfo.processInfo.environment["PK_R17_REPORT"] {
      let destination = URL(fileURLWithPath: path)
      try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
      try encoder.encode(outcomes).write(to: destination)
    }
    for row in outcomes {
      XCTAssertTrue(row.documentPassed, "\(row.id): exact document differs; UTF16=\(row.exactDocumentUTF16)")
      XCTAssertTrue(row.selectionPassed, "\(row.id): selection=\(row.finalSelectionUTF16)")
    }
  }
}
