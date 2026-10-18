import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in tap-typing autocorrection benchmark. `scripts/prepare_tap_benchmark.py`
/// writes a frozen split outside Git: simulated thumb taps over held-out sentences,
/// real human misspellings and clean-intent controls. Every key carries its touch,
/// so the engine sees the same evidence a real key grid would report.
///
///   PK_TAP_BENCH=develop.json PK_TAP_REPORT=out.json swift test -c release --filter TapCorrectionBenchmark
///
/// `PK_TAP_RAW=1` also replays sentences with autocorrect off. `PK_TAP_BASELINE`
/// asserts that clean text, controls and misspelling fixes do not regress.
///
/// Round-2 manifests (`scripts/prepare_tap_benchmark_r2.py`) add space touches,
/// per-word noise labels, clean-tapped sentences with "vulnerable" words (a more
/// frequent real word is one slip away) and per-persona adaptation sentences.
/// `PK_TAP_ADAPT=1` first replays each persona's adaptation sentences into one
/// learning touch model, then scores that persona's sentences with it frozen.
struct TapCorrectionBenchmarkTests {
  enum Event: Decodable {
    case key(String, KeyPoint)
    case space(KeyPoint?)
    case punctuation(String)
    case bar(Int)

    init(from decoder: any Decoder) throws {
      var container = try decoder.unkeyedContainer()
      switch try container.decode(String.self) {
      case "k":
        let key = try container.decode(String.self)
        self = .key(key, KeyPoint(x: try container.decode(Double.self), y: try container.decode(Double.self)))
      case "s":
        if let x = try container.decodeIfPresent(Double.self), let y = try container.decodeIfPresent(Double.self) {
          self = .space(KeyPoint(x: x, y: y))
        } else {
          self = .space(nil)
        }
      case "p": self = .punctuation(try container.decode(String.self))
      default: self = .bar(try container.decode(Int.self))
      }
    }
  }

  struct WordInfo: Decodable {
    let ref: String
    let exact: Bool
    let cognitive: Bool
    let typed: String
    let noise: [String]?
    let sentenceStart: Bool?
    let vulnerable: Bool?
  }

  struct PersonaInfo: Decodable {
    let name: String
    let model: String?
  }

  struct SentenceRun: Decodable {
    let id: String
    let persona: String
    let reference: String
    let events: [Event]
    let words: [WordInfo]
  }

  struct Misspelling: Decodable {
    let id: String
    let source: String
    let input: String
    let expected: String
    let distance: Int
    let realword: Bool
    let conversational: Bool
    let taps: [[Double]?]
  }

  struct Control: Decodable {
    let id: String
    let category: String
    let variant: String
    let prefix: String
    let token: String
    let events: [Event]
  }

  struct Manifest: Decodable {
    let version: String
    let split: String
    let personas: [PersonaInfo]?
    let sentences: [SentenceRun]
    let clean: [SentenceRun]?
    let adaptation: [SentenceRun]?
    let misspellings: [Misspelling]
    let controls: [Control]
  }

  struct SentenceResult: Codable {
    let id: String
    let persona: String
    let reference: String
    let output: String
    let raw: String?
    let wordErrors: Int
    let words: Int
    let characterErrors: Int
    let characters: Int
    let caseWordErrors: Int
    let rawWordErrors: Int?
    /// Per intended word: typed exactly, aligned output correct, intended word in the bar.
    let exact: [Bool]
    let correct: [Bool]
    let visible: [Bool]
  }

  struct WordResult: Codable {
    let id: String
    let group: String
    let input: String
    let expected: String
    let output: String
    let slots: [String]
  }

  struct Counts: Codable, Equatable {
    var items = 0
    var errors = 0
    var units = 0
    var cleanWords = 0
    var cleanChanged = 0
    var noisyWords = 0
    var noisyFixed = 0
    var noisyVisible = 0
    var allVisible = 0
    var caseErrors = 0
    var rawErrors = 0
    var characterErrors = 0
    var characters = 0
  }

  struct CleanCounts: Codable, Equatable {
    var words = 0
    var changed = 0
    var vulnerable = 0
    var vulnerableChanged = 0
    var visible = 0
  }

  struct ClassCounts: Codable, Equatable {
    var words = 0
    var fixed = 0
    var visible = 0
  }

  struct WordCounts: Codable, Equatable {
    var items = 0
    var fixed = 0
    var visible = 0
    var harmful = 0
    var kept = 0
  }

  struct Report: Codable {
    let version: String
    let split: String
    let sentenceSummary: [String: Counts]
    let misspellingSummary: [String: WordCounts]
    let controlSummary: [String: WordCounts]
    let cleanSummary: [String: CleanCounts]?
    let noiseSummary: [String: ClassCounts]?
    let clean: [SentenceResult]?
    let sentences: [SentenceResult]
    let misspellings: [WordResult]
    let controls: [WordResult]
  }

  // MARK: Scoring

  static func normalized(_ text: String) -> String {
    text.replacingOccurrences(of: "\u{2019}", with: "'").replacingOccurrences(of: "\u{2018}", with: "'")
  }

  /// Letter-and-apostrophe runs, so word errors ignore punctuation spacing.
  static func words(_ text: String, folding: Bool = true) -> [String] {
    let text = normalized(text)
    return text.split { !($0.isLetter || $0 == "'") }
      .map { String($0).trimmingCharacters(in: CharacterSet(charactersIn: "'")) }
      .filter { !$0.isEmpty }
      .map { folding ? $0.lowercased() : $0 }
  }

  static func distance<T: Equatable>(_ a: [T], _ b: [T]) -> Int {
    if a.isEmpty { return b.count }
    var previous = Array(0...b.count)
    for i in 1...a.count {
      var current = [i] + Array(repeating: 0, count: b.count)
      for j in stride(from: 1, through: b.count, by: 1) {
        current[j] = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1))
      }
      previous = current
    }
    return previous[b.count]
  }

  /// For each reference token, the output token aligned to it by a minimum edit path.
  static func alignment(_ reference: [String], _ output: [String]) -> [String?] {
    let n = reference.count, m = output.count
    var table = Array(repeating: Array(repeating: 0, count: m + 1), count: n + 1)
    for i in 0...n { table[i][0] = i }
    for j in 0...m { table[0][j] = j }
    if n > 0, m > 0 {
      for i in 1...n {
        for j in 1...m {
          table[i][j] = min(table[i - 1][j] + 1, table[i][j - 1] + 1, table[i - 1][j - 1] + (reference[i - 1] == output[j - 1] ? 0 : 1))
        }
      }
    }
    var aligned = [String?](repeating: nil, count: n)
    var i = n, j = m
    while i > 0 {
      if j > 0, table[i][j] == table[i - 1][j - 1] + (reference[i - 1] == output[j - 1] ? 0 : 1) {
        aligned[i - 1] = output[j - 1]
        i -= 1; j -= 1
      } else if j > 0, table[i][j] == table[i][j - 1] + 1 {
        j -= 1
      } else {
        i -= 1
      }
    }
    return aligned
  }

  static func canonical(_ text: String) -> String {
    normalized(text).lowercased().split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  // MARK: Replay

  final class Session {
    let engine: KeyboardEngine
    let document: MockDocument
    var time = 1_000.0

    init(prefix: String, autocorrect: Bool, touch: TouchModel? = nil) {
      document = MockDocument(prefix)
      let model = LanguageModel(lexicon: Fixtures.lexicon, personal: PersonalDictionary(url: nil))
      let corrector = SpellCorrector(lexicon: Fixtures.lexicon)
      corrector.touch = touch
      let suggester = Suggester(model: model, corrector: corrector)
      var settings = KeyboardSettings()
      settings.autocorrect = autocorrect
      engine = KeyboardEngine(document: document, suggester: suggester, glide: GlideDecoder(model: model), settings: settings)
      engine.clock = { [unowned self] in self.time }
      engine.documentDidChange()
    }

    /// Replays events; returns the bar contents read at each word checkpoint.
    func replay(_ events: [Event]) -> [Int: [String]] {
      var bars: [Int: [String]] = [:]
      for event in events {
        switch event {
        case let .key(key, point):
          let lower = key.lowercased()
          if key != lower, !engine.shift.isActive {
            engine.shiftDown(); engine.shiftUp()
            time += 0.25
          }
          engine.insertCharacter(lower, tap: point)
          time += 0.25
        case let .space(point):
          engine.insertSpace(tap: point)
          time += 0.25
        case let .punctuation(character):
          engine.insertCharacter(character)
          time += 0.25
        case let .bar(index):
          bars[index] = engine.suggestions.slots.map(\.text)
        }
      }
      return bars
    }
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_TAP_BENCH"] != nil))
  func replayFrozenTapBenchmark() throws {
    let environment = ProcessInfo.processInfo.environment
    let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: URL(fileURLWithPath: environment["PK_TAP_BENCH"]!)))
    let includeRaw = environment["PK_TAP_RAW"] == "1"
    let started = ProcessInfo.processInfo.systemUptime

    let models = Dictionary((manifest.personas ?? []).map { ($0.name, $0.model ?? "thumb") }, uniquingKeysWith: { a, _ in a })
    func groups(_ persona: String) -> [String] {
      ["all", persona] + (models[persona].map { ["model-" + $0] } ?? [])
    }

    // Personal touch adaptation: one learner per persona, trained on its own
    // adaptation sentences, then frozen for scoring.
    var touchModels: [String: TouchModel] = [:]
    if environment["PK_TAP_ADAPT"] == "1", let adaptation = manifest.adaptation {
      for run in adaptation {
        let touch = touchModels[run.persona] ?? TouchModel(url: nil)
        touchModels[run.persona] = touch
        _ = Session(prefix: "", autocorrect: true, touch: touch).replay(run.events)
      }
      for (persona, touch) in touchModels.sorted(by: { $0.key < $1.key }) {
        touch.isLearning = false
        let shown = ["e", "g", "h", "p", "q", "z", "m"].map { letter -> String in
          let offset = touch.offset(letter.utf8.first!)
          return letter + String(format: "(%+.2f,%+.2f)", offset.x, offset.y)
        }
        print("TAP ADAPT \(manifest.split) \(persona): weight \(Int(touch.weight)) " + shown.joined(separator: " "))
      }
    }

    /// Replays one typed sentence from an empty field and scores it word by word.
    func score(_ run: SentenceRun, raw includeRaw: Bool) -> SentenceResult {
      let session = Session(prefix: "", autocorrect: true, touch: touchModels[run.persona])
      let bars = session.replay(run.events)
      let output = session.document.text
      var raw: String?
      if includeRaw {
        let plain = Session(prefix: "", autocorrect: false)
        _ = plain.replay(run.events)
        raw = plain.document.text
      }
      let reference = Self.words(run.reference), produced = Self.words(output)
      #expect(reference.count == run.words.count, "Tokenization mismatch: \(run.reference)")
      let aligned = Self.alignment(reference, produced)
      let correct = reference.indices.map { aligned[$0] == reference[$0] }
      let visible = reference.indices.map { index in
        (bars[index] ?? []).contains { Self.normalized($0).lowercased() == reference[index] }
      }
      return SentenceResult(
        id: run.id, persona: run.persona, reference: run.reference, output: output, raw: raw,
        wordErrors: Self.distance(reference, produced), words: reference.count,
        characterErrors: Self.distance(Array(Self.canonical(run.reference)), Array(Self.canonical(output))),
        characters: Self.canonical(run.reference).count,
        caseWordErrors: Self.distance(Self.words(run.reference, folding: false), Self.words(output, folding: false)),
        rawWordErrors: raw.map { Self.distance(reference, Self.words($0)) },
        exact: run.words.map(\.exact), correct: correct, visible: visible)
    }

    var sentences: [SentenceResult] = []
    var sentenceSummary: [String: Counts] = [:]
    var noiseSummary: [String: ClassCounts] = [:]
    for run in manifest.sentences {
      let result = score(run, raw: includeRaw)
      let exact = result.exact, correct = result.correct, visible = result.visible
      sentences.append(result)
      for group in groups(run.persona) {
        var counts = sentenceSummary[group, default: Counts()]
        counts.items += 1
        counts.errors += result.wordErrors
        counts.units += result.words
        counts.caseErrors += result.caseWordErrors
        counts.rawErrors += result.rawWordErrors ?? 0
        counts.characterErrors += result.characterErrors
        counts.characters += result.characters
        for index in exact.indices {
          if visible[index] { counts.allVisible += 1 }
          if exact[index] {
            counts.cleanWords += 1
            if !correct[index] { counts.cleanChanged += 1 }
          } else {
            counts.noisyWords += 1
            if correct[index] { counts.noisyFixed += 1 }
            if visible[index] { counts.noisyVisible += 1 }
          }
        }
        sentenceSummary[group] = counts
      }
      for (index, word) in run.words.enumerated() where index < correct.count {
        var classes = Set(word.noise ?? [])
        if word.sentenceStart == true { classes.insert(word.exact ? "start-clean" : "start-noisy") }
        for name in classes {
          var counts = noiseSummary[name, default: ClassCounts()]
          counts.words += 1
          if correct[index] { counts.fixed += 1 }
          if visible[index] { counts.visible += 1 }
          noiseSummary[name] = counts
        }
      }
    }

    var cleanResults: [SentenceResult] = []
    var cleanSummary: [String: CleanCounts] = [:]
    for run in manifest.clean ?? [] {
      let result = score(run, raw: false)
      cleanResults.append(result)
      for group in groups(run.persona) {
        var counts = cleanSummary[group, default: CleanCounts()]
        for (index, word) in run.words.enumerated() where index < result.correct.count {
          counts.words += 1
          if !result.correct[index] { counts.changed += 1 }
          if result.visible[index] { counts.visible += 1 }
          if word.vulnerable == true {
            counts.vulnerable += 1
            if !result.correct[index] { counts.vulnerableChanged += 1 }
          }
        }
        cleanSummary[group] = counts
      }
    }

    let (_, suggester, _) = Fixtures.stack()
    var misspellings: [WordResult] = []
    var misspellingSummary: [String: WordCounts] = [:]
    for item in manifest.misspellings {
      let taps = item.taps.map { $0.map { KeyPoint(x: $0[0], y: $0[1]) } }
      let set = suggester.suggestions(for: TypedWord(text: item.input, taps: taps), context: .unknown, autocorrect: true)
      let expected = Self.canonical(item.expected)
      let output = set.autocorrection ?? item.input
      let kind = item.realword ? "realword" : "nonword"
      misspellings.append(WordResult(id: item.id, group: kind + "-" + item.source, input: item.input, expected: item.expected,
                                     output: output, slots: set.slots.map(\.text)))
      var groups = [kind, kind + "-" + item.source, kind + "-distance\(item.distance)"]
      if item.conversational { groups.append(kind + "-conversational") }
      for group in groups {
        var counts = misspellingSummary[group, default: WordCounts()]
        counts.items += 1
        if Self.canonical(output) == expected { counts.fixed += 1 }
        if set.slots.contains(where: { Self.canonical($0.text) == expected }) { counts.visible += 1 }
        if let correction = set.autocorrection {
          if Self.canonical(correction) != expected { counts.harmful += 1 }
        } else {
          counts.kept += 1
        }
        misspellingSummary[group] = counts
      }
    }

    var controls: [WordResult] = []
    var controlSummary: [String: WordCounts] = [:]
    for item in manifest.controls {
      let session = Session(prefix: item.prefix, autocorrect: true)
      let bars = session.replay(item.events)
      let text = session.document.text
      let output = text.hasPrefix(item.prefix) ? String(text.dropFirst(item.prefix.count)) : text
      let kept = Self.canonical(output) == Self.canonical(item.token)
      controls.append(WordResult(id: item.id, group: item.category + "-" + item.variant, input: item.token,
                                 expected: item.token, output: output, slots: bars[0] ?? []))
      for group in ["all", item.category + "-" + item.variant] {
        var counts = controlSummary[group, default: WordCounts()]
        counts.items += 1
        if kept { counts.kept += 1 } else { counts.harmful += 1 }
        if (bars[0] ?? []).contains(where: { Self.canonical($0) == Self.canonical(item.token) }) { counts.visible += 1 }
        controlSummary[group] = counts
      }
    }

    let report = Report(version: manifest.version, split: manifest.split, sentenceSummary: sentenceSummary,
                        misspellingSummary: misspellingSummary, controlSummary: controlSummary,
                        cleanSummary: manifest.clean == nil ? nil : cleanSummary,
                        noiseSummary: noiseSummary.isEmpty ? nil : noiseSummary,
                        clean: manifest.clean == nil ? nil : cleanResults,
                        sentences: sentences, misspellings: misspellings, controls: controls)
    if let path = environment["PK_TAP_REPORT"] {
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      try encoder.encode(report).write(to: URL(fileURLWithPath: path), options: .atomic)
    }

    func percent(_ part: Int, _ whole: Int) -> String { String(format: "%.2f%%", whole == 0 ? 0 : 100 * Double(part) / Double(whole)) }
    for group in sentenceSummary.keys.sorted() {
      let c = sentenceSummary[group]!
      print("TAP SENTENCES \(manifest.split) \(group): WER \(percent(c.errors, c.units)) CER \(percent(c.characterErrors, c.characters))"
        + " caseWER \(percent(c.caseErrors, c.units))" + (includeRaw ? " rawWER \(percent(c.rawErrors, c.units))" : "")
        + " clean changed \(c.cleanChanged)/\(c.cleanWords) noisy fixed \(c.noisyFixed)/\(c.noisyWords)"
        + " noisy visible \(c.noisyVisible)/\(c.noisyWords) all visible \(c.allVisible)/\(c.cleanWords + c.noisyWords)")
    }
    for group in cleanSummary.keys.sorted() {
      let c = cleanSummary[group]!
      print("TAP CLEAN \(manifest.split) \(group): changed \(c.changed)/\(c.words) vulnerable changed \(c.vulnerableChanged)/\(c.vulnerable)"
        + " visible \(c.visible)/\(c.words)")
    }
    for group in noiseSummary.keys.sorted() {
      let c = noiseSummary[group]!
      print("TAP NOISE \(manifest.split) \(group): fixed \(c.fixed)/\(c.words) visible \(c.visible)")
    }
    for group in misspellingSummary.keys.sorted() {
      let c = misspellingSummary[group]!
      print("TAP MISSPELLINGS \(manifest.split) \(group): fixed \(c.fixed)/\(c.items) visible \(c.visible) harmful \(c.harmful) kept \(c.kept)")
    }
    for group in controlSummary.keys.sorted() {
      let c = controlSummary[group]!
      print("TAP CONTROLS \(manifest.split) \(group): changed \(c.harmful)/\(c.items) visible \(c.visible)")
    }
    print(String(format: "TAP elapsed %.1f s", ProcessInfo.processInfo.systemUptime - started))

    if let path = environment["PK_TAP_BASELINE"] {
      let baseline = try JSONDecoder().decode(Report.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
      #expect(baseline.version == report.version && baseline.split == report.split)
      let now = sentenceSummary["all"]!, before = baseline.sentenceSummary["all"]!
      #expect(now.cleanChanged <= before.cleanChanged, "More clean sentence words changed")
      #expect(now.errors <= before.errors, "Sentence word errors regressed")
      #expect(controlSummary["all"]!.harmful <= baseline.controlSummary["all"]!.harmful, "More controls changed")
      if let nonword = misspellingSummary["nonword"], let nonwordBefore = baseline.misspellingSummary["nonword"] {
        #expect(nonword.fixed >= nonwordBefore.fixed && nonword.harmful <= nonwordBefore.harmful, "Misspelling fixes regressed")
      }
      if let clean = cleanSummary["all"], let cleanBefore = baseline.cleanSummary?["all"] {
        #expect(clean.changed <= cleanBefore.changed, "More clean-typed words changed")
      }
    }
  }
}
