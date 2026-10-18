import UIKit
import XCTest
@testable import PulpoKeyboard

/// Parent integration regressions authored after the R17 candidate was exposed.
/// These are conservation checks, not additional blind benchmark observations.
@MainActor
final class PreviewCursorBoundaryTests: XCTestCase {
  private let clusters = ["👩‍❤️‍💋‍👨", "🇦🇷", "7\u{FE0F}\u{20E3}", "e\u{301}", "\r\n", "👍🏿", "क्ष", "ش\u{651}\u{64E}"]

  private func check(_ document: String, selection: NSRange, offset: Int,
                     moved: Int, expected: String, final: Int,
                     file: StaticString = #filePath, line: UInt = #line) {
    let editor = UITextView()
    editor.text = document
    editor.selectedRange = selection
    XCTAssertEqual(editor.selectedRange, selection, "UIKit setup", file: file, line: line)
    let host = PreviewHost(textView: editor) { _ in XCTFail("Cursor movement navigated", file: file, line: line) }
    host.adjustTextPosition(byCharacterOffset: offset)
    XCTAssertEqual(editor.selectedRange, NSRange(location: moved, length: 0), document, file: file, line: line)
    editor.insertText("x")
    let raw = editor.text as NSString
    let actualUnits = (0..<raw.length).map { raw.character(at: $0) }
    XCTAssertEqual(actualUnits, Array(expected.utf16), "Exact UTF-16 conservation: \(document)", file: file, line: line)
    XCTAssertEqual(editor.selectedRange, NSRange(location: final, length: 0), file: file, line: line)
  }

  func testBackwardAndForwardMovementPreserveWholeClusters() {
    for cluster in clusters {
      XCTAssertEqual(cluster.count, 1, "Fixture requires one extended grapheme cluster")
      let document = "A" + cluster + "B"
      let end = (document as NSString).length
      let afterCluster = 1 + (cluster as NSString).length
      check(document, selection: NSRange(location: end, length: 0), offset: -2,
            moved: 1, expected: "Ax" + cluster + "B", final: 2)
      check(document, selection: NSRange(location: 1, length: 0), offset: 1,
            moved: afterCluster, expected: "A" + cluster + "xB", final: afterCluster + 1)
    }
  }

  func testSelectionStartAndZeroOffsetKeepExistingCollapseContract() {
    check("A\r\nB", selection: NSRange(location: 1, length: 2), offset: 1,
          moved: 3, expected: "A\r\nxB", final: 4)
    // The existing adapter collapses a selection even for zero movement.
    // R17's independently authored no-op intention remains an unresolved miss.
    check("A🍵B", selection: NSRange(location: 1, length: 2), offset: 0,
          moved: 1, expected: "Ax🍵B", final: 2)
  }

  func testExtremeOffsetsClampWithoutArithmeticOverflow() {
    check("A🍵B", selection: NSRange(location: 1, length: 0), offset: Int.min,
          moved: 0, expected: "xA🍵B", final: 1)
    check("A🍵B", selection: NSRange(location: 1, length: 0), offset: Int.max,
          moved: 4, expected: "A🍵Bx", final: 5)
  }
}
