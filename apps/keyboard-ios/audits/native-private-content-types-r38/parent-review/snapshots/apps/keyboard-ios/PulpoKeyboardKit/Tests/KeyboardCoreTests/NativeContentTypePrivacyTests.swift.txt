import Foundation
import Testing
@testable import KeyboardCore

/// Values measured from named UIKit constants through PreviewHost/InputTraits.
/// This fixture is independent of the production privacy set.
struct NativeContentTypePrivacyTests {
  private struct Calibration: Decodable {
    struct Field: Decodable { let id: String; let rawValue: String; let declaredPrivate: Bool }
    let fields: [Field]
  }
  private func fields() throws -> [Calibration.Field] {
    let root = Fixtures.languageData.deletingLastPathComponent()
    let url = root.appendingPathComponent("audits/native-private-content-types-r38/calibration-baseline.json")
    return try JSONDecoder().decode(Calibration.self, from: Data(contentsOf: url)).fields
  }

  @Test func measuredNativeCategoriesApplyTheirExistingPolicy() throws {
    for field in try fields() {
      for keyboard in [InputTraits.Keyboard.standard, .numberPad] {
        var traits = InputTraits()
        traits.contentType = field.rawValue
        traits.keyboard = keyboard
        #expect(traits.isPrivate == field.declaredPrivate, "\(field.id) on \(keyboard)")
        let policy = InputPolicy(traits: traits, settings: KeyboardSettings())
        if field.declaredPrivate {
          #expect(!policy.autocorrects && !policy.appliesTextReplacements && !policy.showsSuggestions)
          #expect(!policy.learns && !policy.smartQuotes && !policy.smartSpacing && !policy.autoSpaces)
        }
        // Content privacy alone has never disabled glide.
        #expect(policy.allowsGlide == (keyboard == .standard))
      }
      var legacy = InputTraits()
      legacy.contentType = field.id
      if field.declaredPrivate { #expect(legacy.isPrivate, "Legacy \(field.id)") }
    }
  }

  @Test(arguments: ["en_US", "es", "en_es"])
  func measuredPrivateTypesDoNotCorrectReplaceOrLearn(resource: String) throws {
    let stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent(resource + ".pkdict"), personalURL: nil, touchURL: nil)
    stack.suggester.textReplacements = ["zzq": "Expanded public phrase"]
    let valid = resource == "en_US" ? "hello" : "hola"
    for field in try fields() where field.declaredPrivate {
      let document = MockDocument("prefix ")
      document.documentIdentifier = UUID()
      let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide)
      engine.settings.autoCapitalization = false
      engine.traits.contentType = field.rawValue
      engine.documentDidChange()
      engine.type("zzq " + valid + " !")
      #expect(document.text == "prefix zzq " + valid + " !", "Literal privacy \(field.id)")
      #expect(engine.suggestions.slots.isEmpty, "Private suggestions \(field.id)")
      #expect(stack.personal.totalCount == 0, "Private words \(field.id)")
      #expect(stack.personal.count(of: valid) == 0)
      #expect(stack.touch.weight == 0, "Private taps \(field.id)")
      let destination = DictationDestination(document: document, traits: engine.traits)
      #expect(destination.isPrivate && !destination.allowsConfirmation)
      #expect(!DictationInsertionGuard(origin: destination).allowsAutomaticInsertion(at: destination))
    }
  }

  @Test func ordinaryAndOpaqueCustomTypesKeepNormalBehaviorAndSecureOverride() throws {
    let normal = try fields().filter { !$0.declaredPrivate }.map(\.rawValue)
      + ["", "one_time_code", "One-Time-Code", "one-time-code.extra", " cc-number", "ccnumber", "new.password", "custom-secret"]
    for value in normal {
      var traits = InputTraits()
      traits.contentType = value
      #expect(!traits.isPrivate, "Opaque \(value)")
      let policy = InputPolicy(traits: traits, settings: KeyboardSettings())
      #expect(policy.autocorrects && policy.appliesTextReplacements && policy.showsSuggestions && policy.learns)
      #expect(policy.smartQuotes && policy.smartSpacing && policy.autoSpaces && policy.allowsGlide)
      traits.isSecure = true
      #expect(traits.isPrivate)
      #expect(!InputPolicy(traits: traits, settings: KeyboardSettings()).allowsGlide)
    }
    let stack = try LanguageStack(dictionaryURL: Fixtures.languageData.appendingPathComponent("en_US.pkdict"), personalURL: nil, touchURL: nil)
    let document = MockDocument()
    let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide)
    engine.settings.autoCapitalization = false
    engine.documentDidChange()
    engine.type("hello world !")
    #expect(stack.personal.count(of: "hello") > 0)
    #expect(stack.touch.weight > 0)
  }
}
