import SwiftUI
import UIKit
import XCTest
@testable import KeyboardUI
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

  private final class HeldContact: UITouch {
    let point: CGPoint
    private let time = ProcessInfo.processInfo.systemUptime
    init(point: CGPoint) { self.point = point; super.init() }
    override func location(in view: UIView?) -> CGPoint { point }
    override var timestamp: TimeInterval { time }
  }

  func testDetachedEditorEndEditingStopsHeldDeleteBeforeDismantling() throws {
    state.text = "old editor " + String(repeating: "abcdefghij", count: 8) + "!"
    state.selection = NSRange(location: (state.text as NSString).length, length: 0)
    state.focused = true
    let removed = try mount()
    XCTAssertTrue(removed.isFirstResponder)
    let delegate = try XCTUnwrap(removed.delegate as? PreviewTextView.Coordinator)
    let host = try XCTUnwrap(delegate.host)
    let controller = try XCTUnwrap(delegate.controller)
    let keys = controller.rootView.keys
    defer { keys.cancelAllTouches() }
    keys.layoutIfNeeded()
    let key = try XCTUnwrap(keys.keyViews.first { $0.key.action == .delete })
    XCTAssertGreaterThan(key.frame.width, 0)
    let contact = HeldContact(point: CGPoint(x: key.frame.midX, y: key.frame.midY))
    let original = removed.text
    keys.touchesBegan([contact], with: nil)
    let afterTouchDown = removed.text
    XCTAssertNotEqual(afterTouchDown, original, "The real delete contact must edit its attached editor")
    let repeatDeadline = Date().addingTimeInterval(1)
    while removed.text == afterTouchDown, Date() < repeatDeadline {
      RunLoop.main.run(until: Date().addingTimeInterval(0.01))
    }
    guard removed.text != afterTouchDown else {
      XCTFail("The held contact must repeat while attached before testing cleanup")
      return
    }

    // Keep the original SwiftUI owner mounted: removing just its UIKit editor
    // creates the detached-before-dismantle interval. Do not suppress any native
    // delegate callbacks that UIKit itself delivers while detaching.
    removed.removeFromSuperview()
    XCTAssertNil(removed.window)
    XCTAssertTrue(delegate.controller === controller)
    XCTAssertTrue(host.textView === removed)
    delegate.textViewDidEndEditing(removed)
    let afterEndEditing = removed.text
    RunLoop.main.run(until: Date().addingTimeInterval(0.3))
    XCTAssertEqual(removed.text, afterEndEditing, "A detached editor must stop the already-running delete repeat")
    XCTAssertTrue(delegate.controller === controller, "The cleanup oracle must precede representable dismantling")

    // A second window supplies a real replacement editor without dismantling
    // the retained original SwiftUI owner. Both bind to the same scene draft.
    let replacementWindow = UIWindow(windowScene: try XCTUnwrap(window.windowScene))
    defer { replacementWindow.rootViewController = nil; replacementWindow.isHidden = true }
    let replacement = "replacement 🐙 café"
    let selection = (replacement as NSString).range(of: "café")
    state.text = replacement
    state.selection = selection
    state.focused = false
    replacementWindow.rootViewController = UIHostingController(rootView: Editor(state: state))
    replacementWindow.makeKeyAndVisible()
    settle()
    let live = try XCTUnwrap(findEditor(replacementWindow.rootViewController!.view))
    XCTAssertNil(removed.window)
    XCTAssertTrue(delegate.controller === controller)
    removed.text = "stale"
    removed.selectedRange = NSRange(location: 0, length: 0)
    delegate.textViewDidChange(removed)
    delegate.textViewDidChangeSelection(removed)
    delegate.textViewDidBeginEditing(removed)
    delegate.textViewDidEndEditing(removed)
    host.openApp(URL(string: "pulpokeyboard://settings")!)
    keys.touchesEnded([contact], with: nil)
    settle()
    XCTAssertEqual(state.text, replacement)
    XCTAssertEqual(state.selection, selection)
    XCTAssertEqual(live.text, replacement)
    XCTAssertEqual(live.selectedRange, selection)
    XCTAssertFalse(state.focused)
    XCTAssertFalse(live.isFirstResponder)
    XCTAssertTrue(state.urls.isEmpty)
  }

  // Independently authored inputs, evaluated only after ba86a1b9 was selected.
  // Recreation exercises the native editor lifetime; the real HomeView route
  // is covered separately by DraftNavigationTests, not simulated as an E2E pass.
  func testIndependentCombiningEmojiSelectionAndArabicCaretOnce() throws {
    for (text, range) in [
      ("A👩🏽‍💻e\u{0301}中文\n終", NSRange(location: 1, length: 9)),
      ("مرحبا 🧪 e\u{0301}", NSRange(location: 8, length: 0)),
    ] {
      state.text = text
      state.selection = range
      state.focused = false
      try mount()
      unmount()
      try mount()
      for preview in [false, true] {
        state.preview = preview
        settle()
        let editor = try XCTUnwrap(findEditor(window.rootViewController!.view))
        XCTAssertEqual(editor.text, text)
        XCTAssertEqual(editor.selectedRange, range)
        XCTAssertFalse(editor.isFirstResponder)
      }
      state.focused = true
      settle()
      let editor = try XCTUnwrap(findEditor(window.rootViewController!.view))
      XCTAssertEqual(editor.text, text)
      XCTAssertEqual(editor.selectedRange, range)
      XCTAssertTrue(editor.isFirstResponder)
      unmount()
    }
  }

  func testIndependentClearOfSelectedCombiningTextOnce() throws {
    var draft = TryItDraft()
    draft.text = "秘密 🔐 e\u{0301}"
    draft.selection = NSRange(location: 6, length: 2)
    state.text = draft.text
    state.selection = draft.selection
    try mount()
    draft.clear()
    state.text = draft.text
    state.selection = draft.selection
    settle()
    unmount()
    state.preview = false
    let editor = try mount()
    XCTAssertEqual(editor.text, "")
    XCTAssertEqual(editor.selectedRange, NSRange(location: 0, length: 0))
    XCTAssertFalse(editor.isFirstResponder)
  }
}
