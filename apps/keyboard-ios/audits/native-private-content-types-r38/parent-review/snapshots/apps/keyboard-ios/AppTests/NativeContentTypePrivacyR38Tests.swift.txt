import UIKit
import XCTest
@testable import KeyboardUI
@testable import PulpoKeyboard

@MainActor
final class NativeContentTypePrivacyR38Tests: XCTestCase {
  private let privateFields: [UITextContentType] = [
    .username, .password, .newPassword, .oneTimeCode, .emailAddress, .URL, .telephoneNumber,
    .creditCardNumber, .creditCardSecurityCode, .creditCardExpiration, .creditCardExpirationMonth,
    .creditCardExpirationYear, .creditCardName, .creditCardGivenName, .creditCardFamilyName,
    .creditCardMiddleName, .creditCardType, .postalCode, .flightNumber, .shipmentTrackingNumber,
    .birthdate, .birthdateDay, .birthdateMonth, .birthdateYear,
  ]

  private func type(_ text: String, into engine: KeyboardEngine) {
    for c in text {
      if c == " " { engine.insertSpace() }
      else { engine.insertCharacter(String(c), tap: String(c).utf8.count == 1 ? LetterGeometry.qwerty.center(String(c).utf8.first!) : nil) }
    }
  }

  func testRealEnumsAdapterLiteralEditingAndLearning() throws {
    for language in ["en_US", "es", "en_es"] {
      let resource = try XCTUnwrap(KeyboardResources.url(language, "pkdict"))
      let word = language == "en_US" ? "hello" : "hola"
      for content in privateFields {
        let stack = try LanguageStack(dictionaryURL: resource, personalURL: nil, touchURL: nil)
        stack.suggester.textReplacements = ["zzq": "expanded phrase"]
        let editor = UITextView()
        editor.autocapitalizationType = .none
        editor.text = "left PICK right🍵"
        editor.selectedRange = NSRange(location: 5, length: 4)
        editor.textContentType = content
        editor.keyboardType = .default
        let host = PreviewHost(textView: editor) { _ in XCTFail("Unexpected navigation") }
        let engine = KeyboardEngine(document: host.document, suggester: stack.suggester, glide: stack.glide)
        engine.settings.autoCapitalization = false
        engine.traits = host.inputTraits
        engine.documentDidChange()
        XCTAssertEqual(engine.traits.contentType, content.rawValue)
        XCTAssertTrue(engine.traits.isPrivate, content.rawValue)
        type("zzq " + word + " !", into: engine)
        let expected = "left zzq " + word + " ! right🍵"
        XCTAssertEqual(Array(editor.text.utf16), Array(expected.utf16), content.rawValue)
        XCTAssertEqual(editor.selectedRange, NSRange(location: ("left zzq " + word + " !").utf16.count, length: 0))
        XCTAssertTrue(engine.suggestions.slots.isEmpty)
        XCTAssertEqual(stack.personal.totalCount, 0)
        XCTAssertEqual(stack.personal.count(of: word), 0)
        XCTAssertEqual(stack.touch.weight, 0)
        let destination = DictationDestination(document: host.document, traits: host.inputTraits)
        XCTAssertTrue(destination.isPrivate)
        XCTAssertFalse(destination.allowsConfirmation)
        // Numeric classification cannot mask a privacy error in the direct guard.
        editor.keyboardType = .numberPad
        XCTAssertTrue(host.inputTraits.isPrivate)
        XCTAssertFalse(DictationDestination(document: host.document, traits: host.inputTraits).allowsConfirmation)
      }
      let editor = UITextView()
      editor.textContentType = .givenName
      editor.autocapitalizationType = .none
      let host = PreviewHost(textView: editor) { _ in XCTFail("Unexpected navigation") }
      let stack = try LanguageStack(dictionaryURL: resource, personalURL: nil, touchURL: nil)
      let engine = KeyboardEngine(document: host.document, suggester: stack.suggester, glide: stack.glide)
      engine.settings.autoCapitalization = false
      engine.traits = host.inputTraits
      engine.documentDidChange()
      type(word + " !", into: engine)
      XCTAssertGreaterThan(stack.personal.count(of: word), 0)
      XCTAssertGreaterThan(stack.touch.weight, 0)
    }
  }

  private func bridge() throws -> (DictationBridge, () -> Void) {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "r38-fake-" + UUID().uuidString
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    let bridge = try XCTUnwrap(DictationBridge(containerURL: dir, defaults: defaults))
    return (bridge, { defaults.removePersistentDomain(forName: suite); try? FileManager.default.removeItem(at: dir) })
  }

  func testActualControllerRefusesPrivateStartsWithFakeAccount() throws {
    let original = AppGroup.defaults?.object(forKey: "accountSnapshot")
    defer { AppGroup.defaults?.set(original, forKey: "accountSnapshot") }
    AccountSnapshot(signedIn: true, displayName: "Synthetic R38", instanceHost: "fake.invalid", dictationAvailable: true).save()
    for content in [UITextContentType.oneTimeCode, .emailAddress, .creditCardMiddleName, .birthdateYear] {
      let editor = UITextView()
      editor.text = "synthetic only"
      editor.textContentType = content
      editor.keyboardType = .default
      let host = PreviewHost(textView: editor) { _ in XCTFail("Unexpected navigation") }
      let (bridge, cleanup) = try bridge()
      defer { cleanup() }
      let controller = KeyboardController(host: host, dictationBridge: bridge)
      controller.hostWillAppear()
      controller.rootView.bar.onMicrophone?() // Fire the actual callback, even though hidden.
      XCTAssertNil(bridge.pendingRequest)
      XCTAssertNil(bridge.readCommand())
      XCTAssertEqual(controller.rootView.dictation.state, .message(title: "Choose a non-private field", detail: "Dictation can't insert into a private field.", action: nil))
      controller.hostDidDisappear()
    }
  }

  func testActualControllerRecoveryRechecksNativeTraitsAndLateConfirmation() throws {
    let editor = UITextView()
    editor.text = "left  right🍵"
    editor.selectedRange = NSRange(location: 5, length: 0)
    editor.textContentType = .oneTimeCode
    editor.keyboardType = .default
    let host = PreviewHost(textView: editor) { _ in XCTFail("Unexpected navigation") }
    let (bridge, cleanup) = try bridge()
    defer { cleanup() }
    let request = UUID()
    bridge.pendingRequest = request
    bridge.writeState(DictationState(phase: .finished, requestID: request, transcript: "synthetic hello"))
    let controller = KeyboardController(host: host, dictationBridge: bridge)
    controller.hostWillAppear()
    XCTAssertNil(controller.rootView.dictation.onAction, "Private recovery must be unavailable")
    XCTAssertEqual(editor.text, "left  right🍵")
    XCTAssertFalse(bridge.wasDelivered(request))
    editor.textContentType = .givenName
    controller.documentDidChange()
    let captured = try XCTUnwrap(controller.rootView.dictation.onAction, "Normal recovery must be actionable")
    editor.textContentType = .emailAddress
    controller.documentDidChange()
    captured() // Fire previously authorized action after entering a real private field.
    XCTAssertEqual(editor.text, "left  right🍵")
    XCTAssertEqual(editor.selectedRange, NSRange(location: 5, length: 0))
    XCTAssertFalse(bridge.wasDelivered(request))
    XCTAssertNil(controller.rootView.dictation.onAction)
    editor.textContentType = .jobTitle
    controller.documentDidChange()
    try XCTUnwrap(controller.rootView.dictation.onAction)()
    XCTAssertEqual(editor.text, "left synthetic hello right🍵")
    XCTAssertEqual(editor.selectedRange, NSRange(location: 20, length: 0))
    XCTAssertTrue(bridge.wasDelivered(request))
    controller.hostDidDisappear()
  }
}
