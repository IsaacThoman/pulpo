import Foundation
import Testing
@testable import KeyboardCore

/// An opt-in, deterministic audit. Reports stay outside the repository; the corpus
/// and generator are versioned so changes can be compared on identical inputs.
struct KeyboardQualityTests {
  static let typos: [(String, String)] = [
    ("teh", "the"), ("thw", "the"), ("hwllo", "hello"), ("recieve", "receive"),
    ("becuase", "because"), ("adress", "address"), ("definately", "definitely"),
    ("wierd", "weird"), ("tommorow", "tomorrow"), ("dont", "don't"), ("im", "I'm"),
    ("cant", "can't"), ("somthing", "something"), ("wouldnt", "wouldn't"),
    ("thier", "their"), ("yuo", "you"), ("acheive", "achieve"), ("goign", "going"),
    ("wnat", "want"), ("hwo", "how"), ("abotu", "about"), ("peopel", "people"),
    ("freind", "friend"), ("mesage", "message"), ("pleaase", "please"),
    ("keybaord", "keyboard"), ("gogle", "Google"), ("thnaks", "thanks"),
    ("togther", "together"), ("seperate", "separate"), ("occured", "occurred"),
    ("untill", "until"), ("beleive", "believe"), ("mispelled", "misspelled"),
    ("arguement", "argument"), ("enviroment", "environment"), ("accomodate", "accommodate"),
    ("embarass", "embarrass"), ("neccessary", "necessary"), ("begining", "beginning"),
    ("sucess", "success"), ("comming", "coming"), ("agian", "again"),
    ("alot", "a lot"), ("ill", "ill"), ("lets", "lets"), ("were", "were"),
    ("theres", "there's"), ("youre", "you're"), ("weve", "we've"),
    ("shouldnt", "shouldn't"), ("doesnt", "doesn't"), ("isnt", "isn't"),
    ("didnt", "didn't"), ("couldnt", "couldn't"), ("wasnt", "wasn't"),
    ("woudl", "would"), ("taht", "that"), ("wiht", "with"), ("hte", "the"),
  ]

  static let literals = [
    "hello", "form", "its", "well", "were", "lol", "ok", "the", "a", "Monday",
    "email", "app", "AI", "ill", "lets", "hell", "I'll", "we're",
    "OpenAI", "ChatGPT", "Pulpo", "Isaac", "Thoman", "Zorbly", "Mireya", "Siobhan",
    "Kubernetes", "TypeScript", "SwiftUI", "PostgreSQL", "Supabase", "xcodebuild",
    "npm", "pnpm", "git", "asdf", "qwerty", "brb", "idk", "tbh", "lmao", "ngl",
    "fooBar", "myVariable", "README", "user123", "v2", "résumé", "café", "naïve",
  ]

  static let predictions: [(String, String)] = [
    ("thank", "you"), ("going", "to"), ("see", "you"), ("good", "morning"),
    ("happy", "birthday"), ("how", "are"), ("love", "you"), ("on", "my"),
    ("my", "way"), ("talk", "to"), ("let", "me"), ("do", "you"),
    ("are", "you"), ("you", "want"), ("sounds", "good"), ("no", "problem"),
    ("looking", "forward"), ("forward", "to"), ("have", "a"), ("a", "great"),
    ("what", "time"), ("at", "home"), ("next", "week"), ("last", "night"),
    ("right", "now"), ("see", "you"), ("you", "soon"), ("take", "care"),
    ("of", "course"), ("as", "soon"), ("soon", "as"), ("be", "there"),
    ("just", "got"), ("got", "home"), ("can", "you"), ("please", "send"),
    ("send", "me"), ("need", "help"), ("works", "great"), ("looks", "good"),
  ]
  static let contextualPredictions: [(String, String)] = [
    ("on my", "way"), ("how are", "you"), ("would you", "like"), ("thank you", "for"),
    ("I love", "you"), ("I want", "to"), ("I need", "to"), ("I have", "a"),
    ("I am", "going"), ("do you", "know"), ("can you", "help"), ("let me", "know"),
    ("looking forward", "to"), ("see you", "tomorrow"), ("have a", "good"), ("a lot", "of"),
    ("as soon", "as"), ("what do", "you"), ("where are", "you"), ("are you", "sure"),
    ("it's a", "good"), ("want to", "go"), ("going to", "be"), ("you for", "your"),
  ]

  struct WordResult: Codable {
    var input: String
    var expected: String
    var output: String
    var suggestions: [String]
  }
  struct Swipe: Codable {
    var word: String
    var points: [[Double]]
  }
  struct Report: Codable {
    var typos: [WordResult]
    var literals: [WordResult]
    var predictions: [WordResult]
    var contextualPredictions: [WordResult]? = nil
    var swipes: [String: [WordResult]]
    var latencyMilliseconds: [String: Double]
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_PREDICTION_HOLDOUT"] != nil))
  func evaluateExternalPredictionHoldout() throws {
    struct Item: Codable { var prefix: String; var expected: String }
    let path = ProcessInfo.processInfo.environment["PK_PREDICTION_HOLDOUT"]!
    let items = try JSONDecoder().decode([Item].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    let dictionary = ProcessInfo.processInfo.environment["PK_HOLDOUT_DICTIONARY"].map { URL(fileURLWithPath: $0) }
      ?? Fixtures.languageData.appendingPathComponent("en_US.pkdict")
    let lexicon = try Lexicon(url: dictionary)
    let model = LanguageModel(lexicon: lexicon, personal: PersonalDictionary(url: nil))
    var top1 = 0, top3 = 0, total = 0
    for item in items {
      guard let expected = lexicon.id(of: item.expected), !lexicon.flags(expected).contains(.neverSuggest) else { continue }
      let parts = item.prefix.split(separator: " ").map(String.init)
      let context = model.context(previousWord: parts.last, sentenceStart: false, precedingWord: parts.count > 1 ? parts[parts.count - 2] : nil)
      let words = model.predictions(in: context, limit: 3).map { $0.word.lowercased() }
      total += 1
      if words.first == item.expected.lowercased() { top1 += 1 }
      if words.contains(item.expected.lowercased()) { top3 += 1 }
    }
    print("Prediction holdout: \(top1)/\(total) top1, \(top3)/\(total) top3; dictionary \(dictionary.path)")
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_QUALITY_REPORT"] != nil))
  func auditQuality() throws {
    let (model, suggester, glide) = Fixtures.stack()
    let lexicon = model.lexicon
    let context = model.context(previousWord: "and", sentenceStart: false)
    func spelling(_ cases: [(String, String)]) -> [WordResult] {
      cases.map { input, expected in
        let set = suggester.suggestions(for: TypedWord(text: input), context: context, autocorrect: true)
        return WordResult(input: input, expected: expected, output: set.autocorrection ?? input, suggestions: set.slots.map(\.text))
      }
    }
    let predictions = Self.predictions.map { previous, expected in
      let words = model.predictions(in: model.context(previousWord: previous, sentenceStart: false), limit: 3).map(\.word)
      return WordResult(input: previous, expected: expected, output: words.first ?? "", suggestions: words)
    }
    let contextualPredictions = Self.contextualPredictions.map { prefix, expected in
      let parts = prefix.split(separator: " ").map(String.init)
      let words = model.predictions(in: model.context(previousWord: parts.last, sentenceStart: false, precedingWord: parts.first), limit: 3).map(\.word)
      return WordResult(input: prefix, expected: expected, output: words.first ?? "", suggestions: words)
    }
    let ids = (0..<lexicon.wordCount).filter { lexicon.flags($0).contains(.glide) && lexicon.keyLength($0) >= 3 }
      .sorted { lexicon.frequency($0) != lexicon.frequency($1) ? lexicon.frequency($0) > lexicon.frequency($1) : $0 < $1 }
    var seen = Set<String>()
    var words = Array(ids.compactMap { id -> String? in
      let word = lexicon.display(id)
      return word == word.lowercased() && seen.insert(word).inserted ? word : nil
    }.prefix(3000))
    if let baselinePath = ProcessInfo.processInfo.environment["PK_QUALITY_BASELINE"] {
      let baseline = try JSONDecoder().decode(Report.self, from: Data(contentsOf: URL(fileURLWithPath: baselinePath)))
      words = baseline.swipes["standard"]!.map(\.input)
    }
    var swipes: [String: [WordResult]] = [:]
    var latency: [String: Double] = [:]
    for (profile, noise, seed) in [("standard", 0.2, UInt64(7)), ("stress", 0.35, UInt64(103))] {
      var elapsed: [Double] = []
      let results = words.enumerated().map { index, word in
        var generator = SeededGenerator(state: UInt64(index) + seed)
        let points = SyntheticSwipe.points(for: word, noise: noise, generator: &generator)
        let start = ProcessInfo.processInfo.systemUptime
        let candidates = glide.decode(points, context: .unknown, limit: 3).map(\.text)
        elapsed.append((ProcessInfo.processInfo.systemUptime - start) * 1000)
        return WordResult(input: word, expected: word, output: candidates.first ?? "", suggestions: candidates)
      }
      swipes[profile] = results
      elapsed.sort()
      latency[profile + "P50"] = elapsed[elapsed.count / 2]
      latency[profile + "P95"] = elapsed[elapsed.count * 95 / 100]
      latency[profile + "Max"] = elapsed.last!
    }
    let report = Report(typos: spelling(Self.typos), literals: spelling(Self.literals.map { ($0, $0) }), predictions: predictions, contextualPredictions: contextualPredictions, swipes: swipes, latencyMilliseconds: latency)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let output = URL(fileURLWithPath: ProcessInfo.processInfo.environment["PK_QUALITY_REPORT"]!)
    try encoder.encode(report).write(to: output)
    // These exact paths can be replayed on another keyboard. Use an independent
    // fixed vocabulary rather than selecting cases from this decoder's mistakes.
    let comparisonWords = ["hello", "world", "keyboard", "the", "and", "because", "people", "something", "thanks", "tomorrow", "pizza", "quick", "there", "their", "three", "four", "off", "here", "too", "our", "lost", "party", "soon", "power", "top", "east", "needs", "past", "door", "meet", "art", "fell", "beautiful", "message", "friend", "family", "together", "morning", "birthday", "weekend", "tonight", "really", "little", "better", "happy", "coffee", "please", "sorry", "great", "awesome", "home", "work", "time", "good", "love", "right", "about", "after", "before", "question", "answer", "computer", "internet", "application", "important", "different", "remember", "restaurant", "favorite", "weather", "actually", "probably", "definitely", "receive", "address", "environment", "separate", "necessary", "beginning", "success", "tomato", "banana", "mississippi", "minimum", "maximum", "example", "available", "interesting", "international", "opportunity", "development", "experience", "conversation", "prediction", "autocorrect", "accuracy", "performance", "settings", "privacy", "language"]
    let replay = comparisonWords.enumerated().map { index, word in
      var generator = SeededGenerator(state: UInt64(index + 917))
      let points = SyntheticSwipe.points(for: word, noise: 0.2, generator: &generator)
      return Swipe(word: word, points: GlideDecoder.resample(points, count: 64).map { [$0.x, $0.y] })
    }
    try encoder.encode(replay).write(to: output.deletingLastPathComponent().appendingPathComponent("comparison-paths.json"))
    try encoder.encode(["typos": report.typos, "literals": report.literals,
                        "predictions": report.predictions, "contextualPredictions": contextualPredictions])
      .write(to: output.deletingLastPathComponent().appendingPathComponent("comparison-cases.json"))
    print("Quality report: \(output.path)")
  }
}
