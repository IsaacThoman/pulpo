import SwiftUI
import UIKit
import XCTest
@testable import KeyboardUI
@testable import PulpoKeyboard

@MainActor
final class PreviewDocumentLifetimeTests: XCTestCase {
  @Observable final class State {
    var text = "old 🐙 café end"
    var selection = NSRange(location: 7, length: 4)
    var preview = true
  }

  struct Editor: View {
    @Bindable var state: State
    var body: some View {
      PreviewTextView(text: $state.text, selection: $state.selection,
        focused: .constant(false), usePreview: state.preview) { _ in }
    }
  }

  private var window: UIWindow!
  private var state: State!

  override func setUp() async throws {
    try await super.setUp()
    state = State()
    window = UIWindow(windowScene: try XCTUnwrap(
      UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first))
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
    window.layoutIfNeeded()
  }

  private func findEditor(_ view: UIView) -> UITextView? {
    if let editor = view as? UITextView { return editor }
    return view.subviews.lazy.compactMap { self.findEditor($0) }.first
  }

  private func mount() throws -> UITextView {
    window.rootViewController = UIHostingController(rootView: Editor(state: state))
    window.makeKeyAndVisible()
    settle()
    return try XCTUnwrap(findEditor(window.rootViewController!.view))
  }

  private func assertInert(_ input: PreviewInputView, old: UITextView, replacement: UITextView) {
    let controller = input.controller
    let engine = controller.engine
    let document = engine.document
    let oldText = old.text
    let oldRange = old.selectedRange
    let replacementText = replacement.text
    let replacementRange = replacement.selectedRange
    XCTAssertNil(document.documentContextBeforeInput)
    XCTAssertNil(document.documentContextAfterInput)
    XCTAssertNil(document.selectedText)
    XCTAssertFalse(document.hasText)
    document.insertText("stale direct")
    document.deleteBackward()
    engine.insertText("stale engine")
    engine.deleteBackward()
    engine.documentDidChange()
    engine.refreshSuggestions()
    controller.documentDidChange()
    let late = expectation(description: "Retained old controller refreshes after host deallocation")
    DispatchQueue.main.async {
      controller.documentDidChange()
      engine.refreshSuggestions()
      document.insertText("stale queued")
      document.deleteBackward()
      late.fulfill()
    }
    wait(for: [late], timeout: 2)
    settle()
    XCTAssertNil(document.documentContextBeforeInput)
    XCTAssertNil(document.documentContextAfterInput)
    XCTAssertNil(document.selectedText)
    XCTAssertFalse(document.hasText)
    XCTAssertEqual(old.text, oldText)
    XCTAssertEqual(old.selectedRange, oldRange)
    XCTAssertEqual(replacement.text, replacementText)
    XCTAssertEqual(replacement.selectedRange, replacementRange)
    XCTAssertEqual(state.text, replacementText)
    XCTAssertEqual(state.selection, replacementRange)
  }

  func testRetainedInputEngineDocumentIsInertAfterRepresentableDismantle() throws {
    let old = try mount()
    let coordinator = try XCTUnwrap(old.delegate as? PreviewTextView.Coordinator)
    let input = try XCTUnwrap(old.inputView as? PreviewInputView)
    weak var host = coordinator.host
    XCTAssertNotNil(host)
    XCTAssertEqual(input.controller.engine.document.selectedText, "café")
    // Keep the actual old input/controller/engine/document, never the host.
    coordinator.textViewDidChangeSelection(old)
    // Invoke the production dismantle entry point deterministically. Retaining
    // UIKit views can defer SwiftUI's automatic dismantling in this test host.
    window.rootViewController = UIViewController()
    settle()
    PreviewTextView.dismantleUIView(old, coordinator: coordinator)
    XCTAssertNil(coordinator.host)
    XCTAssertNil(coordinator.controller)
    guard host == nil else {
      XCTFail("A strong host in the fixture would conceal the lifetime bug")
      return
    }
    state.text = "replacement 🧪 safe"
    state.selection = NSRange(location: 0, length: 11)
    let replacement = try mount()
    print("R21 dismantle: weak host nil; retained input/controller/engine; next read beforeInput")
    assertInert(input, old: old, replacement: replacement)
  }

  func testRetainedInputEngineDocumentIsInertAfterSwitchToSystemKeyboard() throws {
    let old = try mount()
    let coordinator = try XCTUnwrap(old.delegate as? PreviewTextView.Coordinator)
    let input = try XCTUnwrap(old.inputView as? PreviewInputView)
    weak var host = coordinator.host
    XCTAssertNotNil(host)
    state.preview = false
    settle()
    XCTAssertNil(coordinator.host)
    XCTAssertNil(coordinator.controller)
    guard host == nil else {
      XCTFail("Switching to the system keyboard must release the original host")
      return
    }
    XCTAssertNil(old.inputView)
    // Same editor, newly installed preview host: stale document must not rebind.
    state.preview = true
    state.text = "new host 🪼 untouched"
    state.selection = NSRange(location: 4, length: 4)
    settle()
    XCTAssertNotNil(coordinator.host)
    XCTAssertFalse(coordinator.controller === input.controller)
    print("R21 switch: weak host nil; replacement preview installed; next read beforeInput")
    assertInert(input, old: old, replacement: old)
  }

  func testLiveHostDocumentPreservesReadsAndEdits() throws {
    let editor = try mount()
    let coordinator = try XCTUnwrap(editor.delegate as? PreviewTextView.Coordinator)
    let document = try XCTUnwrap(coordinator.controller).engine.document
    XCTAssertEqual(document.documentContextBeforeInput, "old 🐙 ")
    XCTAssertEqual(document.selectedText, "café")
    XCTAssertEqual(document.documentContextAfterInput, " end")
    XCTAssertTrue(document.hasText)
    document.insertText("tea")
    XCTAssertEqual(editor.text, "old 🐙 tea end")
    document.deleteBackward()
    XCTAssertEqual(editor.text, "old 🐙 te end")
    XCTAssertEqual(document.documentContextBeforeInput, "old 🐙 te")
    XCTAssertNil(document.selectedText)
    XCTAssertEqual(document.documentContextAfterInput, " end")
  }
}
