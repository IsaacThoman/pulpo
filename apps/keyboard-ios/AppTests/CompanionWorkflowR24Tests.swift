import SwiftUI
import UIKit
import XCTest
@testable import PulpoKeyboard

/// Native binding countercheck, separate from the real Home navigation UI tests.
@MainActor
final class CompanionWorkflowR24Tests: XCTestCase {
  @Observable final class State {
    var draft = TryItDraft()
    var focused = true
  }
  struct Screen: View {
    @Bindable var state: State
    var body: some View {
      NavigationStack { TryItView(draft: $state.draft, focused: $state.focused) }
    }
  }
  private func editor(_ view: UIView) -> UITextView? {
    if let text = view as? UITextView { return text }
    return view.subviews.lazy.compactMap { self.editor($0) }.first
  }
  private func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.15)) }

  func testSelectedMultilingualDraftAcrossSmallViewportModesFieldsAndRefocus() throws {
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let window = UIWindow(windowScene: scene)
    let state = State()
    state.draft.text = "Hola 👩🏽‍💻 café\nmañana e\u{0301}"
    state.draft.selection = (state.draft.text as NSString).range(of: "café")
    let original = state.draft.text
    let range = state.draft.selection
    let model = AppModel()
    model.showSetupGuide = false
    let container = UIViewController()
    let host = UIHostingController(rootView: Screen(state: state).environment(model))
    window.rootViewController = container
    window.makeKeyAndVisible()
    container.addChild(host)
    container.view.addSubview(host.view)
    host.view.frame = CGRect(x: 0, y: 0, width: 320, height: 568)
    host.didMove(toParent: container)
    defer { window.rootViewController = nil; window.isHidden = true }
    settle()
    for preview in [true, false, true] {
      state.draft.usePreview = preview
      for field in TryItView.FieldKind.allCases {
        state.draft.field = field
        settle()
        let text = try XCTUnwrap(editor(host.view))
        XCTAssertEqual(text.text, original)
        XCTAssertEqual(state.draft.text, original)
        XCTAssertEqual(text.selectedRange, range)
        XCTAssertEqual(state.draft.selection, range)
        XCTAssertEqual(text.keyboardType, field.keyboardType)
        XCTAssertTrue(text.isFirstResponder)
        XCTAssertTrue(state.focused)
      }
    }
    state.focused = false
    settle()
    let text = try XCTUnwrap(editor(host.view))
    XCTAssertFalse(text.isFirstResponder)
    XCTAssertEqual(text.selectedRange, range)
    state.focused = true
    settle()
    XCTAssertTrue(text.isFirstResponder)
    XCTAssertEqual(text.selectedRange, range)
    text.insertText("té")
    text.delegate?.textViewDidChange?(text)
    XCTAssertEqual(state.draft.text, (original as NSString).replacingCharacters(in: range, with: "té"))
    XCTAssertEqual(state.draft.selection, NSRange(location: range.location + 2, length: 0))
  }
}
