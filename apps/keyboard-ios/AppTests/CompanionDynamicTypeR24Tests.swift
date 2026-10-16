import SwiftUI
import UIKit
import XCTest
@testable import PulpoKeyboard

@MainActor
final class CompanionDynamicTypeR24Tests: XCTestCase {
  @Observable final class State {
    var text = "Hola 👩🏽‍💻 café\nmañana"
    var selection = NSRange(location: 13, length: 4)
    var focused = true
  }
  struct Editor: View {
    @Bindable var state: State
    var body: some View {
      PreviewTextView(text: $state.text, selection: $state.selection, focused: $state.focused) { _ in }
        .frame(height: 220).padding()
    }
  }
  private func editor(in view: UIView) -> UITextView? {
    if let text = view as? UITextView { return text }
    return view.subviews.lazy.compactMap { self.editor(in: $0) }.first
  }

  /// The runner changes this simulator's actual system content_size after ready.
  /// No trait overrides or preferred-size launch arguments are used.
  func testLiveSystemTextSizeRetainsDraftSelectionAndFocus() throws {
    guard let output = ProcessInfo.processInfo.environment["PK_R24_LIVE_DIR"] else {
      throw XCTSkip("Requires the UUID-pinned R24 runner to change actual system content_size after ready")
    }
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let window = UIWindow(windowScene: scene)
    let state = State()
    let original = state.text
    let range = state.selection
    window.rootViewController = UIHostingController(rootView: Editor(state: state))
    window.makeKeyAndVisible()
    defer { window.rootViewController = nil; window.isHidden = true }
    RunLoop.main.run(until: Date().addingTimeInterval(0.5))
    let text = try XCTUnwrap(editor(in: window.rootViewController!.view))
    let before = text.font!.pointSize
    let initialCategory = text.traitCollection.preferredContentSizeCategory.rawValue
    try Data("ready".utf8).write(to: URL(fileURLWithPath: output + "/ready"))
    let deadline = Date().addingTimeInterval(50)
    while text.traitCollection.preferredContentSizeCategory != .accessibilityExtraExtraExtraLarge, Date() < deadline {
      RunLoop.main.run(until: Date().addingTimeInterval(0.1))
    }
    RunLoop.main.run(until: Date().addingTimeInterval(0.5))
    let target = UIFont.preferredFont(forTextStyle: .body, compatibleWith: text.traitCollection).pointSize
    let observation: [String: Any] = ["initialCategory": initialCategory,
      "finalCategory": text.traitCollection.preferredContentSizeCategory.rawValue,
      "beforeFont": before, "afterFont": text.font!.pointSize, "expectedBodyFont": target,
      "document": text.text ?? "", "selectionUTF16": [text.selectedRange.location, text.selectedRange.length],
      "firstResponder": text.isFirstResponder, "bindingFocused": state.focused]
    try JSONSerialization.data(withJSONObject: observation, options: [.prettyPrinted, .sortedKeys])
      .write(to: URL(fileURLWithPath: output + "/observation.json"))
    let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
      window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }
    try image.pngData()?.write(to: URL(fileURLWithPath: output + "/live-editor.png"))
    XCTAssertEqual(initialCategory, UIContentSizeCategory.large.rawValue)
    XCTAssertEqual(text.traitCollection.preferredContentSizeCategory, .accessibilityExtraExtraExtraLarge)
    XCTAssertGreaterThan(target, before)
    XCTAssertEqual(text.font!.pointSize, target, accuracy: 0.1)
    XCTAssertEqual(text.text, original)
    XCTAssertEqual(state.text, original)
    XCTAssertEqual(text.selectedRange, range)
    XCTAssertEqual(state.selection, range)
    XCTAssertTrue(text.isFirstResponder)
    XCTAssertTrue(state.focused)
    text.insertText("té")
    text.delegate?.textViewDidChange?(text)
    XCTAssertEqual(state.text, (original as NSString).replacingCharacters(in: range, with: "té"))
    XCTAssertEqual(state.selection, NSRange(location: range.location + 2, length: 0))
  }
}
