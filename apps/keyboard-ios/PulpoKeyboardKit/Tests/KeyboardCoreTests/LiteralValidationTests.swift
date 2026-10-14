import Foundation
import Testing
@testable import KeyboardCore

struct LiteralValidationTests {
  @Test func olderDictionariesStillLoadWithoutSupplementalSpellings() throws {
    try withDictionary(literals: nil) { lexicon in
      #expect(lexicon.id(of: "hello") == Fixtures.lexicon.id(of: "hello"))
      #expect(!lexicon.isSupplementalLiteral("fir"))
    }
  }

  @Test func supplementarySpellingsPreserveWordIDsAndExactApostrophes() throws {
    try withDictionary(literals: ["diffs", "fir"]) { lexicon in
      let (model, suggester) = stack(lexicon)
      #expect(lexicon.wordCount == Fixtures.lexicon.wordCount)
      #expect(lexicon.id(of: "hello") == Fixtures.lexicon.id(of: "hello"))
      #expect(lexicon.id(of: "fir") == nil)
      #expect(lexicon.id(of: "diffs") == nil)
      #expect(lexicon.isSupplementalLiteral("DIFFS"))
      #expect(!lexicon.isSupplementalLiteral("diff's"))
      #expect(suggester.isValid("diffs"))
      #expect(suggester.isValid("diff's"))
      #expect(suggester.isValid("Fir"))
      #expect(!model.predictions(in: .unknown, limit: 256).contains { $0.word == "fir" })
      #expect(!suggester.candidates(for: TypedWord(text: "fie"), context: .unknown).contains { $0.text == "fir" })
    }
  }

  @Test func supplementalLiteralsStayTypedEvenWithStrongContextAndEdgeTouches() throws {
    try withDictionary(literals: ["diffs", "fir"]) { lexicon in
      let (model, suggester) = stack(lexicon)
      let geometry = LetterGeometry.qwerty
      var taps = Array("fir".utf8).map { geometry.center($0) }
      taps[1] = geometry.center(Character("o").asciiValue!)
      let context = model.context(previousWord: "looking", sentenceStart: false)
      let result = suggester.suggestions(for: TypedWord(text: "fir", taps: taps), context: context, autocorrect: true)
      #expect(result.autocorrection == nil)
      #expect(result.slots.contains { $0.text == "fir" && $0.kind == .literal })
      #expect(result.slots.contains { $0.text == "for" })
      #expect(suggester.suggestions(for: TypedWord(text: "diffs"), context: .unknown, autocorrect: true).autocorrection == nil)
      // Explicit user replacements still run before the literal-only decision.
      suggester.textReplacements["fir"] = "Forest Research"
      #expect(suggester.suggestions(for: TypedWord(text: "fir"), context: context, autocorrect: true).autocorrection == "Forest Research")
    }
  }

  private func stack(_ lexicon: Lexicon) -> (LanguageModel, Suggester) {
    let model = LanguageModel(lexicon: lexicon, personal: PersonalDictionary(url: nil))
    return (model, Suggester(model: model, corrector: SpellCorrector(lexicon: lexicon)))
  }

  /// Rewrites only the optional section; tests work before and after a data rebuild.
  private func withDictionary(literals: [String]?, body: (Lexicon) throws -> Void) throws {
    let original = try Data(contentsOf: Fixtures.languageData.appendingPathComponent("en_US.pkdict"))
    func integer<T: FixedWidthInteger>(_ type: T.Type, at offset: Int) -> T {
      original.withUnsafeBytes { T(littleEndian: $0.loadUnaligned(fromByteOffset: offset, as: T.self)) }
    }
    var sections: [(Data, Data)] = []
    for index in 0..<Int(integer(UInt32.self, at: 8)) {
      let entry = 12 + index * 20
      let tag = original.subdata(in: entry..<(entry + 4))
      let offset = Int(integer(UInt64.self, at: entry + 4))
      let length = Int(integer(UInt64.self, at: entry + 12))
      if tag != Data("VWRD".utf8) { sections.append((tag, original.subdata(in: offset..<(offset + length)))) }
    }
    if let literals { sections.append((Data("VWRD".utf8), Data((literals.joined(separator: "\n") + "\n").utf8))) }
    func append<T: FixedWidthInteger>(_ value: T, to data: inout Data) {
      var value = value.littleEndian
      Swift.withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
    }
    var header = Data("PKD1".utf8)
    append(UInt32(1), to: &header)
    append(UInt32(sections.count), to: &header)
    var offset = (12 + sections.count * 20 + 7) & ~7
    var payload = Data()
    for (tag, data) in sections {
      header.append(tag)
      append(UInt64(offset), to: &header)
      append(UInt64(data.count), to: &header)
      payload.append(data)
      let padding = (8 - data.count % 8) % 8
      payload.append(Data(repeating: 0, count: padding))
      offset += data.count + padding
    }
    header.append(Data(repeating: 0, count: (8 - header.count % 8) % 8))
    header.append(payload)
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("literal-validation-\(UUID().uuidString).pkdict")
    try header.write(to: url, options: .atomic)
    defer { try? FileManager.default.removeItem(at: url) }
    try body(Lexicon(url: url))
  }
}
