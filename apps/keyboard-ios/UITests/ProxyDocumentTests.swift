import XCTest
import UIKit
@testable import KeyboardUI

@MainActor
final class ProxyDocumentTests: XCTestCase {
  func testMissingDocumentIdentifierDuringBootstrapIsOptional() {
    let proxy = BootstrapProxy()
    XCTAssertNil(ProxyDocument(proxy: proxy).documentIdentifier)
    XCTAssertEqual(proxy.typedIdentifierReads, 0)
  }

  func testIdentityFollowsTheCurrentDocumentAndCanDetach() {
    let proxy = BootstrapProxy()
    let document = ProxyDocument(proxy: proxy)
    let first = UUID(), second = UUID()
    proxy.identifier = first
    XCTAssertEqual(document.documentIdentifier, first)
    proxy.identifier = second
    XCTAssertEqual(document.documentIdentifier, second)
    proxy.identifier = nil
    XCTAssertNil(document.documentIdentifier)
    XCTAssertEqual(proxy.typedIdentifierReads, 0)
  }

  /// UIKit's Objective-C accessor can return nil before attachment, even though
  /// Swift imports it as UUID. Reading it through the typed getter would trap.
  private final class BootstrapProxy: NSObject, UITextDocumentProxy {
    var identifier: UUID?
    var typedIdentifierReads = 0
    var documentIdentifier: UUID {
      typedIdentifierReads += 1
      return identifier!
    }
    override func value(forKey key: String) -> Any? {
      if key == "documentIdentifier" { return identifier as NSUUID? }
      return super.value(forKey: key)
    }
    var documentContextBeforeInput: String? { nil }
    var documentContextAfterInput: String? { nil }
    var selectedText: String? { nil }
    var documentInputMode: UITextInputMode? { nil }
    var hasText: Bool { false }
    func insertText(_ text: String) {}
    func deleteBackward() {}
    func adjustTextPosition(byCharacterOffset offset: Int) {}
    func setMarkedText(_ markedText: String, selectedRange: NSRange) {}
    func unmarkText() {}
  }
}
