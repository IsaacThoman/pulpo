import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in keystroke-savings benchmark over held-out messages.
///
/// An ideal user types each prepared turn into `KeyboardEngine` key by key and
/// taps the intended word as soon as any visible bar slot shows it exactly. The
/// automatic space after a suggestion replaces the next typed space; before
/// `.,!?;:` smart spacing moves it, and before other characters the user deletes
/// it. When space or punctuation would replace a correctly typed word, the user
/// taps the literal if it is visible and otherwise undoes the autocorrection.
/// Shift taps and page switches are not counted. Each session keeps one fresh
/// personal dictionary, so in-session learning is measured as shipped.
///
/// Prepare inputs with `scripts/prepare_ksr_benchmark.py`, then run
/// `PK_KSR_BENCH=develop.json PK_KSR_REPORT=report.json swift test -c release --filter KeystrokeSavings`.
/// `PK_KSR_SHARD=i/n` runs every n-th session; `PK_KSR_CASES` writes per-word
/// JSON lines; `PK_KSR_DICTIONARY` selects another dictionary.
struct KeystrokeSavingsBenchmarkTests {
  struct Session: Decodable { var source: String; var id: String; var turns: [String] }
  struct Benchmark: Decodable {
    var version: Int
    var partition: String
    var salt: String
    var sessions: [Session]
    var validWords: [String]
  }

  /// Additive counts so shard reports can be summed.
  struct Counts: Codable {
    static let prefixBuckets = 8
    var sessions = 0, turns = 0, characters = 0, keystrokes = 0
    var predictionTaps = 0, completionTaps = 0, literalTaps = 0, backspaces = 0, repeatedSeparators = 0
    /// Alphabetic words: letters and apostrophes with at least one letter.
    var words = 0, wordCharacters = 0, wordLettersTyped = 0
    var appeared = 0, lettersBeforeAppearance = 0
    /// Next-word prediction before a word's first letter, after a space or at turn start.
    var wordStarts = 0, nextTop1 = 0, nextTop3 = 0
    var turnStarts = 0, turnStartTop1 = 0, turnStartTop3 = 0
    /// `visibleBy[k]` of `eligible[k]` words longer than k appeared within k typed letters.
    var visibleBy = [Int](repeating: 0, count: prefixBuckets)
    var eligible = [Int](repeating: 0, count: prefixBuckets)
    /// Words typed out completely, and those whose exact literal was then not visible.
    var completions = 0, completionsValid = 0, literalMissing = 0, literalMissingValid = 0
    /// Typed-out words followed by space or autocorrecting punctuation.
    var autocorrectDecisions = 0, autocorrectDecisionsValid = 0
    /// The pending autocorrection would replace the intended word.
    var wrongAutocorrect = 0, wrongAutocorrectValid = 0
    /// ...and its literal was not visible, so the user had to undo.
    var unavoidableWrong = 0, unavoidableWrongValid = 0
    /// A slot matched the word only ignoring case.
    var caseOnlyMatches = 0
    var desyncs = 0, repairKeystrokes = 0, finalMismatches = 0

    mutating func add(_ other: Counts) {
      sessions += other.sessions; turns += other.turns; characters += other.characters; keystrokes += other.keystrokes
      predictionTaps += other.predictionTaps; completionTaps += other.completionTaps; literalTaps += other.literalTaps
      backspaces += other.backspaces; repeatedSeparators += other.repeatedSeparators
      words += other.words; wordCharacters += other.wordCharacters; wordLettersTyped += other.wordLettersTyped
      appeared += other.appeared; lettersBeforeAppearance += other.lettersBeforeAppearance
      wordStarts += other.wordStarts; nextTop1 += other.nextTop1; nextTop3 += other.nextTop3
      turnStarts += other.turnStarts; turnStartTop1 += other.turnStartTop1; turnStartTop3 += other.turnStartTop3
      for k in 0..<Self.prefixBuckets { visibleBy[k] += other.visibleBy[k]; eligible[k] += other.eligible[k] }
      completions += other.completions; completionsValid += other.completionsValid
      literalMissing += other.literalMissing; literalMissingValid += other.literalMissingValid
      autocorrectDecisions += other.autocorrectDecisions; autocorrectDecisionsValid += other.autocorrectDecisionsValid
      wrongAutocorrect += other.wrongAutocorrect; wrongAutocorrectValid += other.wrongAutocorrectValid
      unavoidableWrong += other.unavoidableWrong; unavoidableWrongValid += other.unavoidableWrongValid
      caseOnlyMatches += other.caseOnlyMatches
      desyncs += other.desyncs; repairKeystrokes += other.repairKeystrokes; finalMismatches += other.finalMismatches
    }
  }

  struct Report: Codable {
    var benchmark: String
    var partition: String
    var dictionary: String
    var shard: String
    var elapsedSeconds: Double
    var sources: [String: Counts]
  }

  /// One alphabetic word's outcome, for diagnosing development failures.
  struct WordCase: Codable {
    var source: String
    var session: String
    var turn: Int
    var before: String
    var word: String
    var valid: Bool
    /// Letters typed when the word first appeared, or nil.
    var appearedAt: Int?
    /// Visible slot texts, strongest first, before each typed letter.
    var bars: [[String]]
    var autocorrection: String?
    var outcome: String
  }

  private final class Clock { var now = 1_000.0 }
  static let debug = ProcessInfo.processInfo.environment["PK_KSR_DEBUG"] != nil

  static func plain(_ text: String) -> String {
    String(text.map { c -> Character in
      switch c {
      case "\u{2018}", "\u{2019}": "'"
      case "\u{201C}", "\u{201D}": "\""
      default: c
      }
    })
  }

  /// Display order puts the strongest choice in the middle; undo that.
  static func ranked(_ slots: [Suggestion]) -> [Suggestion] {
    switch slots.count {
    case 2: [slots[1], slots[0]]
    case 3: [slots[1], slots[0], slots[2]]
    default: slots
    }
  }

  static func isAlphabetic(_ word: String) -> Bool {
    word.contains(where: \.isLetter) && word.allSatisfy { $0.isLetter || $0 == "'" }
  }

  /// Types one turn as the ideal user and accumulates its counts.
  private final class Typist {
    let engine: KeyboardEngine
    let document = MockDocument("")
    let clock: Clock
    let target: [Character]
    let valid: Set<String>
    var counts: Counts
    var cases: [WordCase]?
    let source: String, session: String, turnIndex: Int
    var position = 0
    var pendingSpace = false

    init(turn: String, stack: (Suggester, GlideDecoder), emoji: EmojiSuggester, valid: Set<String>, counts: Counts,
         cases: [WordCase]?, source: String, session: String, turnIndex: Int) {
      target = Array(turn)
      self.valid = valid
      self.counts = counts
      self.cases = cases
      self.source = source
      self.session = session
      self.turnIndex = turnIndex
      let clock = Clock()
      self.clock = clock
      engine = KeyboardEngine(document: document, suggester: stack.0, glide: stack.1, settings: KeyboardSettings())
      engine.emojiSuggester = emoji
      engine.clock = { clock.now }
      engine.documentDidChange()
    }

    var expected: String { String(target[..<position]) + (pendingSpace ? " " : "") }

    func tick(_ seconds: Double = 0.3) { clock.now += seconds }

    func press(_ c: Character) {
      tick()
      counts.keystrokes += 1
      if c == " " { engine.insertSpace(); return }
      guard c.isLetter else { engine.insertCharacter(String(c)); return }
      var taps = 0
      while engine.shift.isActive != c.isUppercase, taps < 3 {
        tick(0.6)
        engine.shiftDown()
        engine.shiftUp()
        taps += 1
      }
      let lower = String(c).lowercased()
      engine.insertCharacter(lower, tap: lower.utf8.count == 1 ? LetterGeometry.qwerty.center(lower.utf8.first!) : nil)
    }

    func tap(_ suggestion: Suggestion) {
      tick()
      counts.keystrokes += 1
      engine.select(suggestion)
    }

    func backspace() {
      tick()
      counts.keystrokes += 1
      counts.backspaces += 1
      engine.deleteBackward()
    }

    /// Accepts benign spacing differences; repairs anything else at keystroke cost.
    func sync() {
      let actual = KeystrokeSavingsBenchmarkTests.plain(document.text)
      if actual == expected { return }
      let typed = String(target[..<position])
      if !pendingSpace, actual == typed + " " { pendingSpace = true; return }
      if pendingSpace, actual == typed { pendingSpace = false; return }
      // Restore the typed prefix without any pending space, as a user would.
      let want = typed
      pendingSpace = false
      let common = zip(actual, want).prefix { $0 == $1 }.count
      counts.desyncs += 1
      if KeystrokeSavingsBenchmarkTests.debug {
        print("desync \(source) \(session)#\(turnIndex): expected \(want.debugDescription) actual \(actual.debugDescription)")
      }
      let cost = (actual.count - common) + (want.count - common)
      counts.repairKeystrokes += cost
      counts.keystrokes += cost
      document.text = want
      document.cursor = document.text.endIndex
      engine.documentDidChange()
    }

    func bar() -> [String] { KeystrokeSavingsBenchmarkTests.ranked(engine.suggestions.slots).filter { $0.kind != .emoji }.map { KeystrokeSavingsBenchmarkTests.plain($0.text) } }

    func match(_ word: String) -> Suggestion? {
      engine.suggestions.slots.first { $0.kind != .emoji && KeystrokeSavingsBenchmarkTests.plain($0.text) == word }
    }

    func run() {
      var spans: [Range<Int>] = []
      var index = 0
      while index < target.count {
        guard KeyboardEngine.isWordCharacter(target[index]) else { index += 1; continue }
        let start = index
        while index < target.count, KeyboardEngine.isWordCharacter(target[index]) { index += 1 }
        spans.append(start..<index)
      }
      counts.turns += 1
      counts.characters += target.count
      var spanIndex = 0
      while position < target.count {
        if spanIndex < spans.count, spans[spanIndex].lowerBound == position {
          if pendingSpace { backspace(); pendingSpace = false; sync() }
          typeWord(spans[spanIndex])
          spanIndex += 1
          continue
        }
        let c = target[position]
        if pendingSpace {
          if c == " " { position += 1; pendingSpace = false; continue }
          if !KeyboardEngine.spaceSwapPunctuation.contains(c) { backspace(); pendingSpace = false; sync(); continue }
        }
        press(c)
        position += 1
        sync()
      }
      if KeystrokeSavingsBenchmarkTests.plain(document.text).trimmingCharacters(in: .whitespaces) != String(target) {
        counts.finalMismatches += 1
      }
      engine.save()
    }

    /// Types or picks one word, then commits it with the following separator when needed.
    func typeWord(_ span: Range<Int>) {
      let word = String(target[span])
      let alphabetic = KeystrokeSavingsBenchmarkTests.isAlphabetic(word)
      let isValid = alphabetic && valid.contains(word.lowercased())
      let atWordStart = span.lowerBound == 0 || target[span.lowerBound - 1] == " "
      let before = String(target[..<span.lowerBound])
      var bars: [[String]] = []
      var appearedAt: Int?
      var caseOnly = false
      for k in 0..<span.count {
        let visible = bar()
        if cases != nil { bars.append(visible) }
        if k == 0, alphabetic, atWordStart {
          counts.wordStarts += 1
          if visible.first == word { counts.nextTop1 += 1 }
          if visible.contains(word) { counts.nextTop3 += 1 }
          if span.lowerBound == 0 {
            counts.turnStarts += 1
            if visible.first == word { counts.turnStartTop1 += 1 }
            if visible.contains(word) { counts.turnStartTop3 += 1 }
          }
        }
        if let hit = match(word) {
          appearedAt = k
          tap(hit)
          if k == 0 { counts.predictionTaps += 1 } else { counts.completionTaps += 1 }
          position = span.upperBound
          pendingSpace = true
          sync()
          break
        }
        if !caseOnly, visible.contains(where: { $0.lowercased() == word.lowercased() }) { caseOnly = true }
        press(target[position])
        position += 1
        sync()
      }
      if alphabetic {
        counts.words += 1
        counts.wordCharacters += word.count
        counts.wordLettersTyped += appearedAt ?? word.count
        if caseOnly { counts.caseOnlyMatches += 1 }
        if let appearedAt { counts.appeared += 1; counts.lettersBeforeAppearance += appearedAt }
        for k in 0..<min(word.count, Counts.prefixBuckets) {
          counts.eligible[k] += 1
          if let appearedAt, appearedAt <= k { counts.visibleBy[k] += 1 }
        }
      }
      var outcome = appearedAt == nil ? "typed" : (appearedAt == 0 ? "predicted" : "completed")
      var autocorrection: String?
      if appearedAt == nil {
        let literal = match(word)
        autocorrection = engine.suggestions.autocorrection.map(KeystrokeSavingsBenchmarkTests.plain)
        if cases != nil { bars.append(bar()) }
        if alphabetic {
          counts.completions += 1
          if isValid { counts.completionsValid += 1 }
          if literal == nil {
            counts.literalMissing += 1
            if isValid { counts.literalMissingValid += 1 }
          }
        }
        let next = position < target.count ? target[position] : nil
        if let next, next == " " || KeyboardEngine.autocorrectSeparators.contains(next) {
          if alphabetic {
            counts.autocorrectDecisions += 1
            if isValid { counts.autocorrectDecisionsValid += 1 }
          }
          if let autocorrection, autocorrection != word {
            if alphabetic {
              counts.wrongAutocorrect += 1
              if isValid { counts.wrongAutocorrectValid += 1 }
            }
            if let literal {
              outcome = "literal"
              tap(literal)
              counts.literalTaps += 1
              pendingSpace = true
              sync()
            } else {
              press(next)
              position += 1
              let typed = String(target[..<position])
              let actual = KeystrokeSavingsBenchmarkTests.plain(document.text)
              if actual != typed, actual != typed + " " {
                outcome = "undone"
                if alphabetic {
                  counts.unavoidableWrong += 1
                  if isValid { counts.unavoidableWrongValid += 1 }
                }
                backspace()
                let restored = KeystrokeSavingsBenchmarkTests.plain(document.text)
                if restored == String(target[..<(position - 1)]) {
                  press(next)
                  counts.repeatedSeparators += 1
                }
              }
              sync()
            }
          }
        }
      }
      if alphabetic, cases != nil {
        cases!.append(WordCase(source: source, session: session, turn: turnIndex, before: String(before.suffix(60)), word: word,
                               valid: isValid, appearedAt: appearedAt, bars: bars, autocorrection: autocorrection, outcome: outcome))
      }
    }
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_KSR_BENCH"] != nil))
  func measureKeystrokeSavings() throws {
    let environment = ProcessInfo.processInfo.environment
    let path = environment["PK_KSR_BENCH"]!
    let benchmark = try JSONDecoder().decode(Benchmark.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    let dictionary = environment["PK_KSR_DICTIONARY"].map { URL(fileURLWithPath: $0) }
      ?? Fixtures.languageData.appendingPathComponent("en_US.pkdict")
    let lexicon = try Lexicon(url: dictionary)
    let emoji = try EmojiSuggester(catalog: EmojiCatalog.load(url: Fixtures.languageData.appendingPathComponent("emoji.json")))
    let valid = Set(benchmark.validWords)
    let shard = environment["PK_KSR_SHARD"] ?? "0/1"
    let shardParts = shard.split(separator: "/").compactMap { Int($0) }
    try #require(shardParts.count == 2 && shardParts[1] > 0 && shardParts[0] < shardParts[1])
    let casesPath = environment["PK_KSR_CASES"]
    var lines = Data()
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    var sources: [String: Counts] = [:]
    let started = Date()
    for (index, session) in benchmark.sessions.enumerated() where index % shardParts[1] == shardParts[0] {
      let model = LanguageModel(lexicon: lexicon, personal: PersonalDictionary(url: nil))
      let corrector = SpellCorrector(lexicon: lexicon)
      let stack = (Suggester(model: model, corrector: corrector), GlideDecoder(model: model))
      var counts = sources[session.source] ?? Counts()
      counts.sessions += 1
      for (turnIndex, turn) in session.turns.enumerated() {
        let typist = Typist(turn: turn, stack: stack, emoji: emoji, valid: valid, counts: counts,
                            cases: casesPath == nil ? nil : [], source: session.source, session: session.id, turnIndex: turnIndex)
        typist.run()
        counts = typist.counts
        for item in typist.cases ?? [] {
          lines.append(try encoder.encode(item))
          lines.append(0x0A)
        }
      }
      sources[session.source] = counts
    }
    var total = Counts()
    for counts in sources.values { total.add(counts) }
    let report = Report(benchmark: path, partition: benchmark.partition, dictionary: dictionary.path, shard: shard,
                        elapsedSeconds: Date().timeIntervalSince(started), sources: sources)
    if let output = environment["PK_KSR_REPORT"] {
      try encoder.encode(report).write(to: URL(fileURLWithPath: output), options: .atomic)
    }
    if let casesPath { try lines.write(to: URL(fileURLWithPath: casesPath), options: .atomic) }
    let ksr = 100 * (1 - Double(total.keystrokes) / Double(max(total.characters, 1)))
    print(String(format: "Keystroke savings %@ shard %@: %.2f%% over %d characters, %d desyncs, %.1f s",
                 benchmark.partition, shard, ksr, total.characters, total.desyncs, report.elapsedSeconds))
  }
}
