import UIKit
import XCTest
import KeyboardUI
@testable import PulpoKeyboard

/// R21: independently authored against f17109e7, before candidate source reveal.
/// Standalone release timing corrected after evaluation; see the authorship audit.
@MainActor
final class PreviewDocumentLifecycleCounterchecks: XCTestCase {
  func testDirectHostReleaseLeavesRetainedInputControllerEngineAndDocumentInert() throws {
    let editor = makeEditor("amber signal")
    var host: PreviewHost? = PreviewHost(textView: editor, openURL: { _ in })
    weak var releasedHost = host
    let controller = KeyboardController(host: host!, dictationBridge: nil)
    let input = PreviewInputView(controller: controller)
    let engine = controller.engine
    let document = try XCTUnwrap(engine.document as? TextViewDocument)
    XCTAssertTrue(document === host!.document)
    XCTAssertTrue(input.controller === controller)

    engine.insertText("!")
    XCTAssertEqual(editor.text, "amber signal!")
    XCTAssertEqual(document.documentContextBeforeInput, "amber signal!")
    XCTAssertEqual(document.documentContextAfterInput, "")
    XCTAssertNil(document.selectedText)
    XCTAssertTrue(document.hasText)

    // Do not invalidate: the adapter must tolerate owner deallocation itself.
    host = nil
    XCTAssertNil(releasedHost, "Retained consumers must not keep the host alive")
    guard releasedHost == nil else { return }
    withExtendedLifetime((input, controller, engine, document)) {
      assertInert(document, engine: engine, oldEditor: editor)
      controller.documentDidChange()
      assertEmptyContext(document)
    }
  }

  func testInvalidationIsInertWhileHostAndSelectedEditorRemainAlive() throws {
    let editor = makeEditor("cedar amber fog")
    editor.selectedRange = NSRange(location: 6, length: 5)
    let host = PreviewHost(textView: editor, openURL: { _ in })
    weak var livingHost = host
    let controller = KeyboardController(host: host, dictationBridge: nil)
    let document = try XCTUnwrap(controller.engine.document as? TextViewDocument)
    XCTAssertEqual(document.documentContextBeforeInput, "cedar ")
    XCTAssertEqual(document.selectedText, "amber")
    XCTAssertEqual(document.documentContextAfterInput, " fog")
    XCTAssertTrue(document.hasText)
    document.insertText("moss")
    XCTAssertEqual(editor.text, "cedar moss fog")
    document.deleteBackward()
    XCTAssertEqual(editor.text, "cedar mos fog")
    XCTAssertEqual(document.documentContextBeforeInput, "cedar mos")
    XCTAssertEqual(document.documentContextAfterInput, " fog")
    // Preserve a real selection so stale deletion would visibly damage text.
    editor.selectedRange = NSRange(location: 6, length: 3)

    host.invalidate()
    withExtendedLifetime((host, controller)) {
      XCTAssertNotNil(livingHost, "This check requires invalidation before deallocation")
      XCTAssertTrue(host.document === document)
      assertInert(document, engine: controller.engine, oldEditor: editor)
      host.invalidate()
      controller.documentDidChange()
      assertEmptyContext(document)
    }
  }

  func testStandaloneDocumentSurvivesInputControllerEngineAndHostRelease() throws {
    let editor = makeEditor("cobalt kite")
    weak var releasedHost: PreviewHost?
    weak var releasedController: KeyboardController?
    weak var releasedInput: PreviewInputView?
    weak var releasedEngine: KeyboardEngine?
    let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
    let probes = ReleasedConsumers()
    let document = makeStandaloneDocument(editor: editor, scene: scene, probes: probes)
    releasedHost = probes.host
    releasedController = probes.controller
    releasedInput = probes.input
    releasedEngine = probes.engine

    XCTAssertNil(releasedHost, "The host must deallocate before draining deferred UIKit work")
    // PreviewInputView builds a UIKit hierarchy and owns controller -> engine.
    // Allow deferred UIKit/layout work to finish without retaining those owners.
    // Each weak-probe evaluation and run-loop slice gets its own autorelease pool.
    let deadline = ProcessInfo.processInfo.systemUptime + 2
    while autoreleasepool(invoking: {
      releasedInput != nil || releasedController != nil ||
        releasedEngine != nil || releasedHost != nil
    }), ProcessInfo.processInfo.systemUptime < deadline {
      autoreleasepool {
        RunLoop.main.run(until: Date().addingTimeInterval(0.01))
      }
    }

    XCTAssertNil(releasedInput)
    XCTAssertNil(releasedController)
    XCTAssertNil(releasedEngine)
    XCTAssertNil(releasedHost, "A standalone document must not own its former host")
    guard releasedInput == nil, releasedController == nil,
          releasedEngine == nil, releasedHost == nil else { return }
    withExtendedLifetime((document, editor)) {
      assertInert(document, oldEditor: editor)
    }
  }

  private final class ReleasedConsumers {
    weak var host: PreviewHost?
    weak var controller: KeyboardController?
    weak var input: PreviewInputView?
    weak var engine: KeyboardEngine?
  }

  // Keep construction in a distinct stack frame: weak assertions must not
  // observe owners extended by a debug build's inlined closure lifetime.
  @inline(never)
  private func makeStandaloneDocument(
    editor: UITextView, scene: UIWindowScene, probes: ReleasedConsumers
  ) -> TextDocument {
    autoreleasepool {
      let host = PreviewHost(textView: editor, openURL: { _ in })
      let controller = KeyboardController(host: host, dictationBridge: nil)
      let input = PreviewInputView(controller: controller)
      // Give the real UIKit hierarchy a complete window/layout/remove cycle,
      // rather than assuming an unpresented self-sizing input is released.
      let window = UIWindow(windowScene: scene)
      window.rootViewController = UIViewController()
      window.makeKeyAndVisible()
      input.frame = CGRect(x: 0, y: 0, width: window.bounds.width,
        height: input.intrinsicContentSize.height)
      window.rootViewController!.view.addSubview(input)
      window.layoutIfNeeded()
      input.layoutIfNeeded()
      probes.host = host
      probes.controller = controller
      probes.input = input
      probes.engine = controller.engine
      XCTAssertTrue(controller.engine.document is TextViewDocument)
      XCTAssertTrue(controller.engine.document === host.document)
      controller.engine.document.insertText("?")
      XCTAssertEqual(editor.text, "cobalt kite?")
      controller.engine.document.deleteBackward()
      XCTAssertEqual(editor.text, "cobalt kite")
      input.removeFromSuperview()
      window.rootViewController = nil
      window.isHidden = true
      RunLoop.main.run(until: Date().addingTimeInterval(0.01))
      return withExtendedLifetime(input) { controller.engine.document }
    }
  }

  private func makeEditor(_ text: String) -> UITextView {
    let editor = UITextView()
    editor.autocorrectionType = .no
    editor.autocapitalizationType = .none
    editor.text = text
    editor.selectedRange = NSRange(location: (text as NSString).length, length: 0)
    return editor
  }

  private func assertEmptyContext(
    _ document: TextDocument, file: StaticString = #filePath, line: UInt = #line
  ) {
    XCTAssertNil(document.documentContextBeforeInput, file: file, line: line)
    XCTAssertNil(document.documentContextAfterInput, file: file, line: line)
    XCTAssertNil(document.selectedText, file: file, line: line)
    XCTAssertFalse(document.hasText, file: file, line: line)
  }

  private func assertInert(
    _ document: TextDocument, engine: KeyboardEngine? = nil, oldEditor: UITextView,
    file: StaticString = #filePath, line: UInt = #line
  ) {
    let oldText = oldEditor.text
    let oldSelection = oldEditor.selectedRange
    let replacement = makeEditor("silver map")
    let replacementHost = PreviewHost(textView: replacement, openURL: { _ in })
    let replacementDocument = replacementHost.document
    withExtendedLifetime(replacementHost) {
      replacementDocument.insertText("+")
      XCTAssertEqual(replacement.text, "silver map+", file: file, line: line)
      replacement.selectedRange = NSRange(location: 7, length: 3)
      let replacementSelection = replacement.selectedRange

      assertEmptyContext(document, file: file, line: line)
      // Check both orders: insertion must not revive a stale adapter.
      document.insertText("stale parcel")
      document.deleteBackward()
      document.deleteBackward()
      document.insertText("late beacon")
      engine?.insertText("obsolete engine")
      engine?.deleteBackward()
      assertEmptyContext(document, file: file, line: line)
      XCTAssertEqual(oldEditor.text, oldText, file: file, line: line)
      XCTAssertEqual(oldEditor.selectedRange, oldSelection, file: file, line: line)
      XCTAssertEqual(replacement.text, "silver map+", file: file, line: line)
      XCTAssertEqual(replacement.selectedRange, replacementSelection, file: file, line: line)
      XCTAssertEqual(replacementDocument.selectedText, "map", file: file, line: line)

      replacementDocument.insertText("route")
      XCTAssertEqual(replacement.text, "silver route+", file: file, line: line)
      replacementDocument.deleteBackward()
      XCTAssertEqual(replacement.text, "silver rout+", file: file, line: line)
    }
  }
}
