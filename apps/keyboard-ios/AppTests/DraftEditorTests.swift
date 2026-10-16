import SwiftUI
import UIKit
import XCTest
@testable import PulpoKeyboard

@MainActor
final class DraftEditorTests: XCTestCase {
  @Observable final class State {
    var text = "A👩🏽‍💻 café 🇪🇸 Z"
    var selection = NSRange(location: 0, length: 0)
    var focused = false
    var preview = true
    var urls: [URL] = []
  }

  struct Editor: View {
    @Bindable var state: State
    var body: some View {
      PreviewTextView(text: $state.text, selection: $state.selection, focused: $state.focused,
        usePreview: state.preview) { state.urls.append($0) }
    }
  }

  var window: UIWindow!
  var state: State!

  override func setUp() async throws {
    try await super.setUp()
    state = State()
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first!
    window = UIWindow(windowScene: scene)
  }

  override func tearDown() async throws {
    window.rootViewController = nil
    window.isHidden = true
    window = nil
    state = nil
    try await super.tearDown()
  }

  private func settle() {
    RunLoop.main.run(until: Date().addingTimeInterval(0.15))
  }

  private func findEditor(_ view: UIView) -> UITextView? {
    if let text = view as? UITextView { return text }
    return view.subviews.lazy.compactMap { self.findEditor($0) }.first
  }

  @discardableResult private func mount() throws -> UITextView {
    window.rootViewController = UIHostingController(rootView: Editor(state: state))
    window.makeKeyAndVisible()
    settle()
    return try XCTUnwrap(findEditor(window.rootViewController!.view))
  }

  private func unmount() {
    window.rootViewController = UIViewController()
    settle()
  }

  func testEmojiCaretAndSelectedRangeSurviveRecreationBeforeEditing() throws {
    let original = state.text
    for range in [NSRange(location: ("A👩🏽‍💻" as NSString).length, length: 0),
                  (original as NSString).range(of: "café")] {
      for focused in [false, true] {
        state.text = original
        state.selection = range
        state.focused = focused
        let first = try mount()
        XCTAssertEqual(first.selectedRange, range)
        unmount()
        state.focused = focused
        let restored = try mount()
        XCTAssertEqual(restored.text, original)
        XCTAssertEqual(restored.selectedRange, range)
        XCTAssertEqual(restored.isFirstResponder, focused)
        restored.insertText("X")
        restored.delegate?.textViewDidChange?(restored)
        XCTAssertEqual(state.text, (original as NSString).replacingCharacters(in: range, with: "X"))
        unmount()
      }
    }
  }

  func testSwitchingNativeAndPreviewRetainsRangeAndDoesNotForceFocus() throws {
    state.selection = (state.text as NSString).range(of: "café")
    let expected = state.selection
    try mount()
    for preview in [false, true, false, true] {
      state.preview = preview
      settle()
      let editor = try XCTUnwrap(findEditor(window.rootViewController!.view))
      XCTAssertEqual(editor.text, state.text)
      XCTAssertEqual(editor.selectedRange, expected)
      XCTAssertEqual(editor.inputView is PreviewInputView, preview)
      XCTAssertFalse(editor.isFirstResponder)
      XCTAssertFalse(state.focused)
    }
  }

  func testFocusedSwitchingRetainsEmojiSelectionAndCanReplaceIt() throws {
    let original = state.text
    state.selection = (original as NSString).range(of: "café")
    let range = state.selection
    state.focused = true
    try mount()
    for preview in [false, true] {
      state.preview = preview
      settle()
      let editor = try XCTUnwrap(findEditor(window.rootViewController!.view))
      XCTAssertTrue(editor.isFirstResponder)
      XCTAssertTrue(state.focused)
      XCTAssertEqual(editor.selectedRange, range)
      XCTAssertEqual(editor.inputView is PreviewInputView, preview)
    }
    let editor = try XCTUnwrap(findEditor(window.rootViewController!.view))
    editor.insertText("té")
    editor.delegate?.textViewDidChange?(editor)
    XCTAssertEqual(state.text, (original as NSString).replacingCharacters(in: range, with: "té"))
  }

  func testClearResetsRangeAndRemainsEmptyAfterRecreationAndModeChange() throws {
    state.selection = (state.text as NSString).range(of: "café")
    try mount()
    state.text = ""
    state.selection = NSRange(location: 0, length: 0)
    settle()
    unmount()
    state.preview = false
    let editor = try mount()
    XCTAssertEqual(editor.text, "")
    XCTAssertEqual(editor.selectedRange, NSRange(location: 0, length: 0))
    XCTAssertFalse(editor.isFirstResponder)
    editor.insertText("nuevo")
    editor.delegate?.textViewDidChange?(editor)
    XCTAssertEqual(state.text, "nuevo")
  }

  func testInvalidAndOverflowingRangesStayWithinUTF16Text() throws {
    for range in [NSRange(location: NSNotFound, length: 0),
                  NSRange(location: 999, length: 4), NSRange(location: 1, length: Int.max)] {
      state.selection = range
      let editor = try mount()
      let length = (state.text as NSString).length
      XCTAssertLessThanOrEqual(editor.selectedRange.location, length)
      XCTAssertLessThanOrEqual(editor.selectedRange.length, length - editor.selectedRange.location)
      unmount()
    }
  }

  func testRemovedEditorCallbacksCannotChangeReplacementDraftOrFocus() throws {
    let removed = try mount()
    let delegate = try XCTUnwrap(removed.delegate as? PreviewTextView.Coordinator)
    let host = try XCTUnwrap(delegate.host)
    delegate.textViewDidChangeSelection(removed)
    state.focused = true
    unmount()
    state.focused = false
    state.text = "replacement 🐙"
    state.selection = NSRange(location: 4, length: 0)
    let live = try mount()
    removed.text = "stale"
    delegate.textViewDidChange(removed)
    delegate.textViewDidChangeSelection(removed)
    delegate.textViewDidBeginEditing(removed)
    delegate.textViewDidEndEditing(removed)
    host.openApp(URL(string: "pulpokeyboard://settings")!)
    settle()
    XCTAssertEqual(state.text, "replacement 🐙")
    XCTAssertEqual(state.selection, NSRange(location: 4, length: 0))
    XCTAssertFalse(state.focused)
    XCTAssertFalse(live.isFirstResponder)
    XCTAssertTrue(state.urls.isEmpty)
  }
}
