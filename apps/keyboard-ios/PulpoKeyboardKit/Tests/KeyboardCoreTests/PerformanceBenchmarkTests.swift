import Darwin
import Foundation
import Testing
@testable import KeyboardCore

/// Opt-in responsiveness benchmark for the main-thread work behind each key.
///
///     PK_PERF=1 PK_PERF_REPORT=/tmp/perf.json PK_PERF_TRACE=/tmp/trace.txt \
///       swift test -c release --filter PerformanceBenchmarkTests
///
/// It mirrors what `KeyboardController` does on the main thread: the engine edit
/// for each key, then one suggestion pass for the bar. Letters, spaces and
/// deletes are timed separately, with and without a personal dictionary at its
/// size limit. `PK_HUMAN_SWIPES` adds recorded swipes inserted in sentence context.
/// The trace records every document state and bar so a pure performance change
/// can be checked for identical behavior by comparing two traces.
struct PerformanceBenchmarkTests {
  struct Distribution: Codable {
    let count: Int
    let p50: Double
    let p95: Double
    let p99: Double
    let max: Double
    let mean: Double

    init(_ samples: [Double]) {
      let sorted = samples.sorted()
      count = sorted.count
      func at(_ fraction: Double) -> Double {
        sorted.isEmpty ? 0 : sorted[min(sorted.count - 1, Int(Double(sorted.count) * fraction))]
      }
      p50 = at(0.5)
      p95 = at(0.95)
      p99 = at(0.99)
      max = sorted.last ?? 0
      mean = sorted.isEmpty ? 0 : sorted.reduce(0, +) / Double(sorted.count)
    }
  }

  struct TypingReport: Codable {
    /// Engine edit plus the bar pass that follows it.
    var letters: Distribution
    var spaces: Distribution
    var deletes: Distribution
    var all: Distribution
    /// The host's text-change callback and any bar pass it causes.
    var callbacks: Distribution
    /// Everything one key costs the main thread: edit, bar, callback, bar.
    var keystrokes: Distribution
    var stallsOver16ms: Int
    var stallsOver8ms: Int
    var words: Int
    var keystrokeCount: Int
    var personalWrites: Int
  }

  struct Report: Codable {
    var coldMilliseconds: [String: Double] = [:]
    var typing: [String: TypingReport] = [:]
    var swipes: [String: Distribution] = [:]
    var persistence: [String: Double] = [:]
    var footprintMegabytes: [String: Double] = [:]
  }

  // MARK: Workload

  /// About 500 words of chat-style text. Typos are typed literally at the
  /// wrong key so autocorrection and its edit search run as on a phone.
  static let corpus = """
  hey are you still coming to the party tonight? i think it starts around eight but we can get there a bit later if you want. \
  let me know what you think and i will pick you up on the way. also can you bring the speaker from last time, mine is broken again. \
  i just got out of the meeting and it was so long. the new manager wants everyone to send a weekly update by friday afternoon. \
  honestly i dont mind but it feels like more work for nothing. anyway how was your day? did you finish the report for the client? \
  we should grab lunch tomorrow if you are free. there is a new place near the office that makes really good sandwiches and soup. \
  my sister is visiting this weekend so i might be busy on saturday, but sunday works for me. maybe we can go for a walk in the park. \
  the weather is supposed to be nice and sunny. i need to buy groceries tonight because the fridge is basically empty right now. \
  do you need anything from the store? i can get milk and eggs and bread if you want. oh and i forgot to tell you, my phone fell \
  in the water yesterday and the screen still works but the speaker sounds weird. i have to take it in for repair next week. \
  thanks for helping me move last month, i really appreciate it. the new apartment is great and the neighbors are very friendly. \
  we finally put up the shelves and hung the pictures in the living room. you should come over for dinner sometime soon. \
  i am going to make pasta with tomato sauce and a big salad. bring your brother too if he is around. what time works for you? \
  i was thinking seven would be good because i get home from work at six. sorry for the late reply, i was driving. \
  the traffic was terrible on the highway because of an accident near the bridge. it took me almost an hour to get home. \
  did you see the game last night? that last minute goal was amazing and the whole stadium went crazy. i still cant believe it. \
  we should watch the next one together at the bar downtown. they have a huge screen and the food is not bad either. \
  by the way, the package you sent arrived this morning. thank you so much, the books look really interesting. \
  i started reading the first one already and it is hard to put down. let me know when you want them back. \
  also remember that the rent is due on the first of the month, so please send me your half before then. \
  i will be out of town from wednesday to friday for a conference, so text me if anything comes up. \
  the hotel has wifi so i should be able to answer emails in the evening. good luck with your interview tomorrow, you will do great. \
  call me after and tell me how it went. i hope they offer you the job because you deserve it. see you soon and take care.
  """

  /// Deterministic typing errors: adjacent-key substitutions and transpositions.
  static let typos: [String: String] = [
    "think": "thibk", "because": "becuase", "really": "realy", "tomorrow": "tomorow", "weekend": "weekwnd",
    "manager": "manageer", "afternoon": "afternoom", "groceries": "grocerues", "yesterday": "yesterdya",
    "apartment": "apartmemt", "friendly": "freindly", "pictures": "pictuers", "dinner": "dinnet",
    "traffic": "trafic", "accident": "acident", "amazing": "amaizng", "interesting": "intresting",
    "conference": "conferance", "interview": "interveiw", "deserve": "desrve", "with": "eith", "about": "abiut",
  ]

  enum Step {
    case character(String, KeyPoint?)
    case space
    case delete
    case punctuation(String)
  }

  static func steps() -> (steps: [Step], words: Int) {
    var steps: [Step] = []
    var words = 0
    var deletesDue = 0
    for (index, rawWord) in corpus.split(separator: " ").enumerated() {
      var word = String(rawWord)
      var trailing: [Character] = []
      while let last = word.last, !last.isLetter, last != "'" {
        trailing.insert(last, at: 0)
        word.removeLast()
      }
      words += 1
      let lowered = word.lowercased()
      let typed = typos[lowered] ?? word
      // Every 37th word: two stray letters, deleted before the word continues.
      if index % 37 == 11 {
        deletesDue = 2
      }
      for (offset, character) in typed.enumerated() {
        let lower = String(character).lowercased()
        let tap = lower.utf8.count == 1 ? LetterGeometry.qwerty.center(lower.utf8.first!) : nil
        // A small deterministic offset from the key center, like a real tap.
        let jitter = tap.map { KeyPoint(x: $0.x + Double((index * 31 + offset * 17) % 9 - 4) * 0.05,
                                        y: $0.y + Double((index * 13 + offset * 7) % 7 - 3) * 0.05) }
        steps.append(.character(String(character), jitter))
        if deletesDue > 0, offset == typed.count / 2 {
          for stray in ["k", "j"].prefix(deletesDue) { steps.append(.character(stray, LetterGeometry.qwerty.center(stray.utf8.first!))) }
          for _ in 0..<deletesDue { steps.append(.delete) }
          deletesDue = 0
        }
      }
      for mark in trailing { steps.append(.punctuation(String(mark))) }
      steps.append(.space)
    }
    return (steps, words)
  }

  // MARK: Personal dictionary at its limit

  /// A personal dictionary at `maximumWords` words and `maximumPairs` pairs, as a
  /// heavy keyboard user reaches: mostly dictionary words (every committed word is
  /// learned) plus names and slang, with heavy-tailed successor lists.
  static func fullPersonalSnapshot(lexicon: Lexicon, words wordCount: Int = PersonalDictionary.maximumWords,
                                   pairs pairCount: Int = PersonalDictionary.maximumPairs) -> Data {
    var generator = SeededGenerator(state: 2_026)
    var vocabulary: [String] = []
    var seen = Set<String>()
    // The most frequent lowercase dictionary words, in frequency order.
    var ranked: [(Int, UInt8)] = []
    for id in 0..<lexicon.wordCount where !lexicon.flags(id).contains(.neverSuggest) && !lexicon.flags(id).contains(.notAWord) {
      ranked.append((id, lexicon.frequency(id)))
    }
    ranked.sort { $0.1 != $1.1 ? $0.1 > $1.1 : $0.0 < $1.0 }
    for (id, _) in ranked where vocabulary.count < wordCount * 4 / 5 {
      let display = lexicon.display(id)
      if display.count > 1, display.allSatisfy({ $0.isLetter || $0 == "'" }), seen.insert(display).inserted { vocabulary.append(display) }
    }
    let syllables = ["ka", "zo", "ri", "mel", "tan", "vex", "lu", "qui", "bra", "dor", "fen", "yi", "sha", "nox", "pel"]
    while vocabulary.count < wordCount {
      var word = ""
      for _ in 0..<Int.random(in: 2...4, using: &generator) { word += syllables.randomElement(using: &generator)! }
      if Bool.random(using: &generator) { word = word.prefix(1).uppercased() + word.dropFirst() }
      if seen.insert(word).inserted { vocabulary.append(word) }
    }
    var words: [String: PersonalDictionary.Word] = [:]
    let now = Date().timeIntervalSince1970
    for (rank, word) in vocabulary.enumerated() {
      let count = max(1, Int(400 / Double(rank + 1).squareRoot()) + Int.random(in: 0...3, using: &generator))
      // Distinct ages, so pruning ranks the same words first in every run. The
      // eviction order only depends on relative age, not on when the run starts.
      let age = Double((rank * 7_919) % vocabulary.count) * 2_000 + 3_600
      words[word] = PersonalDictionary.Word(count: count, lastUsed: now - age, pinned: rank % 23 == 0)
    }
    var pairs: [String: Int] = [:]
    // Zipf-like histories: frequent words such as "the" and "i" gather long lists.
    while pairs.count < pairCount {
      let historyRank = Int(pow(Double.random(in: 0..<1, using: &generator), 3) * Double(vocabulary.count))
      let targetRank = Int(pow(Double.random(in: 0..<1, using: &generator), 2) * Double(vocabulary.count))
      let key = vocabulary[historyRank].lowercased() + "\u{1F}" + vocabulary[targetRank]
      pairs[key, default: 0] += Int.random(in: 1...6, using: &generator)
    }
    let snapshot = PersonalDictionary.Snapshot(words: words, pairs: pairs, blocked: ["ducking", "zorbex"])
    return try! JSONEncoder().encode(snapshot)
  }

  // MARK: Measurement helpers

  @inline(__always) static func now() -> UInt64 { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }
  static func milliseconds(since start: UInt64) -> Double { Double(now() - start) / 1_000_000 }

  static func footprintMegabytes() -> Double {
    var info = task_vm_info_data_t()
    var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(task_self_trap(), task_flavor_t(TASK_VM_INFO), $0, &count) }
    }
    return result == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
  }

  final class Trace {
    var lines: [String] = []
    func record(_ label: String, _ engine: KeyboardEngine, _ document: MockDocument) {
      let bar = engine.suggestions
      let slots = bar.slots.map { "\($0.text)|\($0.kind)|\($0.isAutocorrection ? 1 : 0)" }.joined(separator: ",")
      lines.append("\(label)\t\(document.text.suffix(48))\t\(slots)\t\(bar.autocorrection ?? "-")\t\(engine.shift)")
    }
  }

  /// Types the corpus as the controller does: an engine edit, then one bar pass.
  static func type(stack: LanguageStack, label: String, trace: Trace?) -> TypingReport {
    let document = MockDocument()
    let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide)
    var time = 1_000.0
    engine.clock = { time }
    engine.documentDidChange()
    _ = engine.suggestions
    let (steps, words) = steps()
    var letters: [Double] = [], spaces: [Double] = [], deletes: [Double] = [], all: [Double] = []
    var callbacks: [Double] = [], keystrokes: [Double] = []
    for (index, step) in steps.enumerated() {
      time += 0.18
      let start = now()
      switch step {
      case let .character(text, tap):
        let lower = text.lowercased()
        if lower != text, !engine.shift.isActive { engine.shiftDown(); engine.shiftUp() }
        engine.insertCharacter(lower, tap: tap)
      case .space: engine.insertSpace()
      case .delete: engine.deleteBackward()
      case let .punctuation(mark): engine.insertCharacter(mark)
      }
      _ = engine.suggestions
      let elapsed = milliseconds(since: start)
      trace?.record(label, engine, document)
      // The host then reports the edit through textDidChange, and the controller
      // reconciles the document and refreshes the bar again if it went stale.
      let callbackStart = now()
      engine.documentDidChange()
      _ = engine.suggestions
      let callback = milliseconds(since: callbackStart)
      if index > 0 {
        all.append(elapsed)
        callbacks.append(callback)
        keystrokes.append(elapsed + callback)
        switch step {
        case .character, .punctuation: letters.append(elapsed)
        case .space: spaces.append(elapsed)
        case .delete: deletes.append(elapsed)
        }
      }
      trace?.record(label + "+cb", engine, document)
    }
    return TypingReport(letters: Distribution(letters), spaces: Distribution(spaces), deletes: Distribution(deletes),
                        all: Distribution(all), callbacks: Distribution(callbacks), keystrokes: Distribution(keystrokes),
                        stallsOver16ms: keystrokes.filter { $0 > 16 }.count,
                        stallsOver8ms: keystrokes.filter { $0 > 8 }.count, words: words, keystrokeCount: steps.count, personalWrites: 0)
  }

  struct HumanItem: Decodable {
    let word: String
    let points: [[Double]]
    let times: [Double]?
    let sentence: String?
  }

  /// Recorded swipes inserted after their sentence's earlier words, then one bar pass.
  static func swipe(stack: LanguageStack, items: [HumanItem], label: String, trace: Trace?) -> Distribution {
    var samples: [Double] = []
    for item in items {
      let document = MockDocument()
      let engine = KeyboardEngine(document: document, suggester: stack.suggester, glide: stack.glide)
      engine.documentDidChange()
      if let sentence = item.sentence {
        let words = sentence.split(separator: " ").map(String.init)
        if let position = words.firstIndex(of: item.word), position > 0 {
          engine.type(words[..<position].joined(separator: " ") + " ")
        }
      }
      _ = engine.suggestions
      let points = item.points.map { KeyPoint(x: $0[0], y: $0[1]) }
      let start = now()
      engine.insertGlide(points, times: item.times)
      _ = engine.suggestions
      samples.append(milliseconds(since: start))
      trace?.record(label, engine, document)
    }
    return Distribution(samples)
  }

  // MARK: Benchmark

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_PERF"] != nil))
  func measureKeyboardResponsiveness() throws {
    let environment = ProcessInfo.processInfo.environment
    let dictionaryURL = Fixtures.languageData.appendingPathComponent("en_US.pkdict")
    let emojiURL = Fixtures.languageData.appendingPathComponent("emoji.json")
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pk-perf-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let trace = environment["PK_PERF_TRACE"] != nil ? Trace() : nil
    var report = Report()
    let baseFootprint = Self.footprintMegabytes()

    // Cold path. The first construction in the process pays for page faults in
    // the mapped dictionary; later ones show the warm (re-show) cost.
    var start = Self.now()
    let firstLexicon = try Lexicon(url: dictionaryURL)
    report.coldMilliseconds["lexiconFirst"] = Self.milliseconds(since: start)
    _ = firstLexicon
    var lexiconTimes: [Double] = []
    for _ in 0..<15 {
      start = Self.now()
      _ = try Lexicon(url: dictionaryURL)
      lexiconTimes.append(Self.milliseconds(since: start))
    }
    report.coldMilliseconds["lexiconMedian"] = Distribution(lexiconTimes).p50

    let emptyURL = directory.appendingPathComponent("empty.json")
    start = Self.now()
    let emptyStack = try LanguageStack(dictionaryURL: dictionaryURL, personalURL: emptyURL)
    report.coldMilliseconds["stackEmptyPersonal"] = Self.milliseconds(since: start)
    start = Self.now()
    _ = emptyStack.suggester.predictions(context: emptyStack.model.context(previousWord: nil, sentenceStart: true))
    report.coldMilliseconds["firstPrediction"] = Self.milliseconds(since: start)
    start = Self.now()
    _ = emptyStack.suggester.suggestions(for: TypedWord(text: "hel"), context: .unknown, autocorrect: true)
    report.coldMilliseconds["firstSuggestion"] = Self.milliseconds(since: start)
    var generator = SeededGenerator(state: 9)
    let probe = SyntheticSwipe.points(for: "hello", noise: 0.1, generator: &generator)
    start = Self.now()
    _ = emptyStack.glide.decode(probe, context: .unknown)
    report.coldMilliseconds["firstGlide"] = Self.milliseconds(since: start)
    report.footprintMegabytes["afterStack"] = Self.footprintMegabytes() - baseFootprint

    start = Self.now()
    let catalog = try EmojiCatalog.load(url: emojiURL)
    report.coldMilliseconds["emojiCatalog"] = Self.milliseconds(since: start)
    start = Self.now()
    let emojiSuggester = EmojiSuggester(catalog: catalog)
    report.coldMilliseconds["emojiIndex"] = Self.milliseconds(since: start)
    report.footprintMegabytes["afterEmojiIndex"] = Self.footprintMegabytes() - baseFootprint

    // A full personal dictionary: load, typing, save.
    let fullURL = directory.appendingPathComponent("full.json")
    let snapshot = Self.fullPersonalSnapshot(lexicon: firstLexicon)
    try snapshot.write(to: fullURL)
    report.persistence["fullFileKilobytes"] = Double(snapshot.count) / 1024
    var loadTimes: [Double] = []
    for _ in 0..<5 {
      start = Self.now()
      _ = PersonalDictionary(url: fullURL)
      loadTimes.append(Self.milliseconds(since: start))
    }
    report.coldMilliseconds["personalFullLoadMedian"] = Distribution(loadTimes).p50
    let beforeFull = Self.footprintMegabytes()
    start = Self.now()
    let fullStack = try LanguageStack(dictionaryURL: dictionaryURL, personalURL: fullURL)
    report.coldMilliseconds["stackFullPersonal"] = Self.milliseconds(since: start)
    report.footprintMegabytes["fullPersonalDelta"] = Self.footprintMegabytes() - beforeFull

    // Typing: empty personal dictionary, then the full one (which learns and prunes).
    let mtimeBefore = (try? FileManager.default.attributesOfItem(atPath: fullURL.path)[.modificationDate]) as? Date
    for repetition in 0..<3 {
      let stack = try LanguageStack(dictionaryURL: dictionaryURL, personalURL: directory.appendingPathComponent("typing-\(repetition).json"))
      let result = Self.type(stack: stack, label: "empty", trace: repetition == 0 ? trace : nil)
      report.typing["empty-\(repetition)"] = result
    }
    report.footprintMegabytes["afterTypingEmpty"] = Self.footprintMegabytes() - baseFootprint
    for repetition in 0..<3 {
      let stack = repetition == 0 ? fullStack : try LanguageStack(dictionaryURL: dictionaryURL, personalURL: fullURL)
      var result = Self.type(stack: stack, label: "full", trace: repetition == 0 ? trace : nil)
      let mtimeAfter = (try? FileManager.default.attributesOfItem(atPath: fullURL.path)[.modificationDate]) as? Date
      result.personalWrites = mtimeAfter == mtimeBefore ? 0 : 1
      report.typing["full-\(repetition)"] = result
      if repetition == 0 { report.footprintMegabytes["afterTypingFull"] = Self.footprintMegabytes() - baseFootprint }
    }

    // Saving the full dictionary, as the keyboard does when it is dismissed.
    let saveURL = directory.appendingPathComponent("save.json")
    try snapshot.write(to: saveURL)
    var saveTimes: [Double] = []
    for _ in 0..<5 {
      let personal = PersonalDictionary(url: saveURL)
      personal.learn("benchmark", after: "the")
      start = Self.now()
      personal.save()
      saveTimes.append(Self.milliseconds(since: start))
    }
    report.persistence["fullSaveMedianMs"] = Distribution(saveTimes).p50
    // The first new word past the limit prunes the vocabulary on the main thread.
    var pruneTimes: [Double] = []
    for index in 0..<5 {
      let personal = PersonalDictionary(url: fullURL)
      start = Self.now()
      personal.learn("unseenword\(Character(UnicodeScalar(97 + index)!))", after: "the")
      pruneTimes.append(Self.milliseconds(since: start))
    }
    report.persistence["pruneMedianMs"] = Distribution(pruneTimes).p50
    report.persistence["savedKilobytes"] = Double((try? Data(contentsOf: saveURL).count) ?? 0) / 1024

    // Swipes in sentence context.
    if let path = environment["PK_HUMAN_SWIPES"] {
      var items = try JSONDecoder().decode([HumanItem].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
      items = Array(items.prefix(Int(environment["PK_PERF_SWIPES"] ?? "300") ?? 300))
      report.swipes["empty"] = Self.swipe(stack: emptyStack, items: items, label: "swipe-empty", trace: trace)
      let swipeFull = try LanguageStack(dictionaryURL: dictionaryURL, personalURL: fullURL)
      report.swipes["full"] = Self.swipe(stack: swipeFull, items: items, label: "swipe-full", trace: trace)
    }
    _ = emojiSuggester

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(report)
    if let output = environment["PK_PERF_REPORT"] { try data.write(to: URL(fileURLWithPath: output)) }
    if let output = environment["PK_PERF_TRACE"], let trace { try trace.lines.joined(separator: "\n").write(toFile: output, atomically: true, encoding: .utf8) }
    print("PERF " + String(decoding: data, as: UTF8.self))
  }
}
