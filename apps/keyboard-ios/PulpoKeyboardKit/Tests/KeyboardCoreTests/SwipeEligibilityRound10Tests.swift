import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in, synthetic controls. Inputs/protocol precede compiler inspection.
struct SwipeEligibilityRound10Tests {
  struct Sample: Codable {
    let id: String
    let kind: String
    let language: String
    let context: String
    let target: String?
    let literal: String?
    let expectedDocument: String
  }
  struct Word: Codable { let display: String; let frequency: UInt8; let flags: UInt8 }
  struct Row: Codable {
    let id: String
    let language: String
    let profile: String
    let words: [Word]
    let candidates: [String]
    let visible: [String]
    let rawDocument: String
    let phantomSpace: Bool
    let document: String
    let exact: Bool
    let setupMS: Double
    let gestureMS: Double
  }
  struct Literal: Codable { let id: String; let document: String; let exact: Bool }
  struct Cold: Codable {
    let language: String
    let constructionMS: Double
    let setupMS: Double
    let firstGestureMS: Double
    let firstInferenceMS: Double
  }
  struct Report: Codable { let rows: [Row]; let literals: [Literal]; let cold: Cold? }
  static let root = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("audits/swipe-eligibility-r10")
  static let profiles = ["320-ideal", "390-ideal", "390-jitter", "430-jitter"]

  static func path(_ word: String, profile: String) throws -> ([KeyPoint], [Double]) {
    let width = Double(profile.split(separator: "-")[0])!
    let pitchX = width / 10, pitchY = 48.0
    let folded = word.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    let centers = try folded.utf8.map { byte in try #require(LetterGeometry.qwerty.center(byte)) }
    try #require(centers.count >= 2)
    var pixels: [KeyPoint] = []
    for (a, b) in zip(centers, centers.dropFirst()) {
      // Repeated letters produce a dwell, just like all other frozen controls.
      for step in 0..<8 {
        let t = Double(step) / 8
        pixels.append(KeyPoint(x: (a.x + (b.x - a.x) * t) * pitchX,
                               y: (a.y + (b.y - a.y) * t) * pitchY))
      }
    }
    pixels.append(KeyPoint(x: centers.last!.x * pitchX, y: centers.last!.y * pitchY))
    let points = pixels.enumerated().map { i, pixel in
      let interior = i > 0 && i < pixels.count - 1 && profile.hasSuffix("jitter")
      return KeyPoint(x: pixel.x / pitchX + (interior ? sin(Double(i) * 1.7) * 0.12 : 0),
                      y: pixel.y / pitchY + (interior ? cos(Double(i) * 2.3) * 0.10 : 0))
    }
    return (points, points.indices.map { Double($0) * 0.04 })
  }

  static func stack(_ language: String) throws -> LanguageStack {
    let resource = ["english": "en_US", "spanish": "es", "bilingual": "en_es"][language]!
    let directory = ProcessInfo.processInfo.environment["PULPO_R10_DATA"].map { URL(fileURLWithPath: $0) } ?? Fixtures.languageData
    return try LanguageStack(dictionaryURL: directory.appendingPathComponent(resource + ".pkdict"), personalURL: nil)
  }
  static func engine(_ stack: LanguageStack, _ sample: Sample) -> (KeyboardEngine, MockDocument) {
    let document = MockDocument(sample.context)
    var settings = KeyboardSettings()
    settings.language = ["english": .english, "spanish": .spanish, "bilingual": .bilingual][sample.language]!
    settings.autoCapitalization = false
    settings.learnWords = false
    let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide, settings: settings)
    engine.documentDidChange()
    return (engine, document)
  }
  static func ms(_ duration: Duration) -> Double {
    Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
  }
  static func write(_ report: Report, _ path: String) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    try encoder.encode(report).write(to: URL(fileURLWithPath: path), options: .atomic)
  }

  @Test func boundarySmoke() throws {
    // Test mechanics before the baseline without reading any scenario outcome.
    let sample = Sample(id: "smoke", kind: "swipe", language: "english", context: "Say ",
                        target: "hello", literal: nil, expectedDocument: "Say hello ")
    let stack = try Self.stack("english")
    let (engine, document) = Self.engine(stack, sample)
    let (points, times) = try Self.path("hello", profile: "320-ideal")
    engine.insertGlide(points, times: times)
    #expect(document.text == "Say hello")
    #expect(engine.phantomSpace)
    engine.insertSpace()
    #expect(document.text == sample.expectedDocument)
  }

  @Test func frozenSweep() throws {
    let env = ProcessInfo.processInfo.environment
    guard let output = env["PULPO_R10_OUTPUT"] else { return }
    let development = try JSONDecoder().decode([Sample].self, from: Data(contentsOf: Self.root.appendingPathComponent("dev.json")))
    let clock = ContinuousClock()
    if let language = env["PULPO_R10_COLD"] {
      let sample = development.first { $0.language == language && $0.kind == "swipe" }!
      let (points, times) = try Self.path(sample.target!, profile: "390-ideal")
      let start = clock.now
      let stack = try Self.stack(language)
      let constructed = clock.now
      let (engine, _) = Self.engine(stack, sample)
      let setup = clock.now
      engine.insertGlide(points, times: times)
      let end = clock.now
      try Self.write(Report(rows: [], literals: [], cold: Cold(language: language,
        constructionMS: Self.ms(start.duration(to: constructed)), setupMS: Self.ms(constructed.duration(to: setup)),
        firstGestureMS: Self.ms(setup.duration(to: end)), firstInferenceMS: Self.ms(constructed.duration(to: end)))), output)
      return
    }
    let split = env["PULPO_R10_SPLIT"] ?? "dev"
    try #require(["dev", "heldout"].contains(split))
    let samples = try JSONDecoder().decode([Sample].self, from: Data(contentsOf: Self.root.appendingPathComponent(split + ".json")))
    var rows: [Row] = [], literals: [Literal] = []
    for language in ["spanish", "bilingual", "english"] {
      let stack = try Self.stack(language)
      // Warm this exact model, including engine context predictions, before timing.
      let warm = development.first { $0.language == language && $0.kind == "swipe" }!
      let (warmEngine, _) = Self.engine(stack, warm)
      let (warmPoints, warmTimes) = try Self.path(warm.target!, profile: "390-ideal")
      warmEngine.insertGlide(warmPoints, times: warmTimes)
      for sample in samples where sample.language == language {
        if sample.kind == "literal" {
          let (engine, document) = Self.engine(stack, sample)
          engine.type(sample.literal!)
          literals.append(Literal(id: sample.id, document: document.text, exact: document.text == sample.expectedDocument))
          continue
        }
        for profile in Self.profiles {
          let (points, times) = try Self.path(sample.target!, profile: profile)
          let start = clock.now
          let (engine, document) = Self.engine(stack, sample)
          let setup = clock.now
          let candidates = engine.insertGlide(points, times: times)
          let end = clock.now
          let raw = document.text, phantom = engine.phantomSpace
          let visible = engine.suggestions.slots.prefix(3).map(\.text)
          engine.insertSpace()
          let words = stack.lexicon.words(forKey: TextNormalizer.key(sample.target!)).map {
            Word(display: stack.lexicon.display($0), frequency: stack.lexicon.frequency($0), flags: stack.lexicon.flags($0).rawValue)
          }
          rows.append(Row(id: sample.id, language: language, profile: profile, words: words,
            candidates: candidates.map(\.text), visible: visible, rawDocument: raw, phantomSpace: phantom,
            document: document.text, exact: raw == sample.context + sample.target! && phantom && document.text == sample.expectedDocument,
            setupMS: Self.ms(start.duration(to: setup)), gestureMS: Self.ms(setup.duration(to: end))))
        }
      }
      #expect(stack.personal.totalCount == 0)
    }
    #expect(rows.count == 128)
    #expect(literals.count == 8)
    try Self.write(Report(rows: rows, literals: literals, cold: nil), output)
  }
}
