import UIKit
import XCTest
@testable import PulpoKeyboard

/// Adapter for EXPOSED R17 development cases. Missing semantics stop a case;
/// later authored stages remain unexecuted. This is native editing, not E2E UI.
@MainActor
final class BroadExposedR24Tests: XCTestCase {
  func testOriginalLiteralPrefixesWithoutRepairingOracles() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    let input = root.appendingPathComponent("audits/editing-ux-r17/broad-heldout-authored.json")
    let suite = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: input)) as? [String: Any])
    let cases = try XCTUnwrap(suite["cases"] as? [[String: Any]])
    var outcomes: [[String: Any]] = []
    for item in cases {
      let initial = item["starting_state"] as! [String: Any]
      let range = initial["selection_utf16"] as! [String: Int]
      let editor = UITextView()
      editor.text = initial["document"] as? String
      editor.selectedRange = NSRange(location: range["start"]!, length: range["end"]! - range["start"]!)
      // The production document is retained explicitly, without touching lifetime policy.
      let host = PreviewHost(textView: editor) { _ in }
      let document = host.document
      var steps: [[String: Any]] = []
      var stopped = false
      for (index, step) in (item["steps"] as! [[String: Any]]).enumerated() {
        let action = step["action"] as! [String: Any]
        let type = action["type"] as! String
        var reason: String?
        if stopped { reason = "unexecuted after unavailable semantic action" }
        else if type == "type_text" { document.insertText(action["text"] as! String) }
        else if type == "press_key", action["key"] as? String == "Backspace" { document.deleteBackward() }
        else {
          reason = "No real UI binding in this native prefix fixture for \(type); no simulated navigation/selection substituted"
          stopped = true
        }
        var result: [String: Any] = ["index": index, "action": action, "expected": step["expected"]!, "status": reason == nil ? "executed-native-prefix" : "unavailable-or-unexecuted"]
        if let reason { result["reason"] = reason }
        else {
          let expected = step["expected"] as! [String: Any]
          let expectedRange = expected["selection_utf16"] as! [String: Int]
          result["document"] = editor.text ?? ""
          result["selection_utf16"] = ["start": editor.selectedRange.location, "end": NSMaxRange(editor.selectedRange)]
          result["documentPassed"] = editor.text == expected["document"] as? String
          result["selectionPassed"] = editor.selectedRange == NSRange(location: expectedRange["start"]!, length: expectedRange["end"]! - expectedRange["start"]!)
        }
        steps.append(result)
      }
      outcomes.append(["id": item["id"]!, "starting_state": initial, "steps": steps, "languageAndUI": "unexecuted; UITextView + production PreviewHost.document literal prefix only; no engine or language-control claim"])
    }
    if let path = ProcessInfo.processInfo.environment["PK_R24_REPORT"] {
      try JSONSerialization.data(withJSONObject: outcomes, options: [.prettyPrinted, .sortedKeys]).write(to: URL(fileURLWithPath: path))
    }
    XCTAssertEqual(outcomes.count, 6)
  }
}
