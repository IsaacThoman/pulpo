import Foundation
import Testing
@testable import KeyboardCore

/// Everything around a swipe except the decoder's scoring: spacing, the bar's
/// alternatives, deletion, capitalization, punctuation, mixing with taps, words
/// the decoder cannot produce yet, learning and privacy. Each case is one
/// person-visible scenario, written down before the engine code was read.
/// Paths are ideal center-to-center traces, so the cases test the workflow
/// rather than recognition. `PK_SWIPE_WORKFLOW_REPORT` prints every case,
/// including the ones decoder scoring decides, without failing.
struct SwipeWorkflowTests {
  final class Session {
    let engine: KeyboardEngine
    let document: MockDocument
    var time = 100.0

    init(_ text: String = "", cursor: Int? = nil, traits: InputTraits = InputTraits(),
         personal: PersonalDictionary = PersonalDictionary(url: nil)) {
      document = MockDocument(text)
      if let cursor { document.moveCursor(to: cursor) }
      let (_, suggester, glide) = Fixtures.stack(personal: personal)
      engine = KeyboardEngine(document: document, suggester: suggester, glide: glide)
      engine.traits = traits
      engine.documentDidChange()
      engine.clock = { [unowned self] in self.time }
    }

    var text: String { SwipeWorkflowTests.plain(document.text) }
    var personal: PersonalDictionary { engine.suggester!.model.personal }
    var slots: [Suggestion] { engine.suggestions.slots }
    /// Bar choices strongest first; the bar shows the strongest in the middle.
    var ranked: [Suggestion] {
      let slots = slots
      return slots.count == 3 ? [slots[1], slots[0], slots[2]] : slots.count == 2 ? [slots[1], slots[0]] : slots
    }

    private func tick(_ seconds: Double = 0.3) { time += seconds }

    @discardableResult
    func swipe(_ word: String) -> [String] {
      tick()
      return engine.insertGlide(SwipeWorkflowTests.path(word)).map(\.text)
    }

    func type(_ text: String) {
      for character in text {
        tick()
        engine.type(String(character))
      }
    }

    func backspace() {
      tick()
      engine.deleteBackward()
    }

    func shift() {
      tick()
      engine.shiftDown()
      engine.shiftUp()
    }

    func capsLock() {
      shift()
      time += 0.1
      engine.shiftDown()
      engine.shiftUp()
    }

    /// Taps the first bar choice that differs from `word`, returning its text.
    func pickAlternative(otherThan word: String) -> String? {
      guard let choice = ranked.first(where: { $0.kind == .alternative && SwipeWorkflowTests.plain($0.text) != word }) else { return nil }
      tick()
      engine.select(choice)
      return SwipeWorkflowTests.plain(choice.text)
    }

    /// Moves the cursor as a tap in the text would.
    func moveCursor(to offset: Int) {
      document.moveCursor(to: offset)
      engine.documentDidChange()
    }
  }

  static func path(_ word: String) -> [KeyPoint] { HumanSwipeContextTests.idealPath(word) }

  /// Straight apostrophes and quotes, so expectations read as typed.
  static func plain(_ text: String) -> String {
    text.replacingOccurrences(of: "\u{2019}", with: "'").replacingOccurrences(of: "\u{2018}", with: "'")
      .replacingOccurrences(of: "\u{201C}", with: "\"").replacingOccurrences(of: "\u{201D}", with: "\"")
  }

  static func same(_ actual: String, _ expected: String) -> String? {
    actual == expected ? nil : "got \(actual.debugDescription), expected \(expected.debugDescription)"
  }

  /// The swiped text plus its automatic space, owed or already typed.
  static func spaced(_ session: Session, _ expected: String) -> String? {
    if session.text == expected + " " || (session.text == expected && session.engine.phantomSpace) { return nil }
    return "got \(session.text.debugDescription) (owed space \(session.engine.phantomSpace)), expected \(expected.debugDescription) + space"
  }

  static func first(_ results: String?...) -> String? { results.compactMap { $0 }.first }

  /// Types a new word until it is kept, reverting an autocorrection with one delete.
  static func typeKept(_ word: String, in session: Session) {
    session.type(word + " ")
    if !session.text.hasSuffix(word + " ") {
      session.backspace()
      session.type(" ")
    }
  }

  // MARK: Scenarios

  static let ids: [String] = [
    "A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12", "A13", "A14", "A15", "A16", "A17", "A18", "A19",
    "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14", "B15", "B16",
    "C1", "C2", "C3", "C4", "C5", "C7", "C8", "C9",
    "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12",
    "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E12",
    "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
    "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10",
    "H8", "H10",
    "I1", "I2", "I3", "I4", "I5", "I6", "I7",
    "J1", "J2", "J3", "J4",
    // Added after reading the code: the same properties with a word whose ideal
    // path decodes unambiguously, and behavior the fixes introduced.
    "A20", "B17", "B18", "B19", "C10", "C11", "D1v", "D4v", "D8v", "D13", "G2v", "G3v", "G4v", "G11", "G12", "I8",
  ]

  /// Cases whose outcome is the decoder's ranking for an ideal path, which this
  /// suite reports but does not own. The ideal path for "there" retraces e-r-e
  /// and decodes as "the"; the `v` variants check the same workflow.
  static let decoderOwned: Set<String> = [
    "D1", "D4", "D6", "D8", "D12", "E3", "E5", "E6", "E8", "E9", "E10", "E11", "E12", "G2", "G3", "G4",
  ]
  /// A word typed once is offered as a completion but becomes a swipe candidate
  /// only once known: typed twice, kept over an autocorrection, picked as typed,
  /// or typed in place of a deleted swipe (C10).
  static let productDecisions: Set<String> = ["C1"]
  static let asserted = ids.filter { !decoderOwned.contains($0) && !productDecisions.contains($0) }

  // swiftlint:disable:next cyclomatic_complexity function_body_length
  static func run(_ id: String) -> String? {
    switch id {
    // A. Insertion and spacing
    case "A1":
      let s = Session(); s.swipe("hello")
      return spaced(s, "Hello")
    case "A2":
      let s = Session(); s.swipe("hello"); s.swipe("world")
      return spaced(s, "Hello world")
    case "A3":
      let s = Session("Hello "); s.swipe("world")
      return spaced(s, "Hello world")
    case "A4":
      let s = Session("Hello"); s.swipe("world")
      return spaced(s, "Hello world")
    case "A5":
      let s = Session("Hello."); s.swipe("how")
      return spaced(s, "Hello. How")
    case "A6":
      let s = Session("Hello,"); s.swipe("how")
      return spaced(s, "Hello, how")
    case "A7":
      // A tapped quote (curly) and a straight one already in a field without smart quotes.
      let typed = Session(); typed.type("\""); typed.swipe("hello")
      var traits = InputTraits(); traits.smartQuotes = false
      let straight = Session("\"", traits: traits); straight.swipe("hello")
      return first(spaced(typed, "\"Hello"), spaced(straight, "\"Hello"))
    case "A8":
      let typed = Session("He said "); typed.type("\""); typed.swipe("hello")
      var traits = InputTraits(); traits.smartQuotes = false
      let straight = Session("He said \"", traits: traits); straight.swipe("hello")
      return first(spaced(typed, "He said \"hello"), spaced(straight, "He said \"hello"))
    case "A9":
      let s = Session("I think ("); s.swipe("maybe")
      return spaced(s, "I think (maybe")
    case "A10":
      let s = Session("Nice 😀"); s.swipe("cool")
      return spaced(s, "Nice 😀 cool")
    case "A11":
      let s = Session("Hello world", cursor: 6); s.swipe("big")
      return first(same(s.text, "Hello big world"), same(String(s.document.text[..<s.document.cursor]), "Hello big "))
    case "A12":
      let s = Session("Hello world", cursor: 5); s.swipe("there")
      return same(s.text, "Hello there world")
    case "A13":
      let s = Session("world", cursor: 0); s.swipe("hello")
      return first(same(s.text, "Hello world"), same(String(s.document.text[..<s.document.cursor]), "Hello "))
    case "A14":
      let s = Session("Hi\n"); s.swipe("there")
      return spaced(s, "Hi\nThere")
    case "A15":
      var traits = InputTraits(); traits.capitalization = .none
      let s = Session(traits: traits); s.swipe("hello")
      return spaced(s, "hello")
    case "A16":
      let s = Session("I have 3"); s.swipe("cats")
      return spaced(s, "I have 3 cats")
    case "A17":
      let s = Session("Hello.", cursor: 5); s.swipe("world")
      return same(s.text, "Hello world.")
    case "A18":
      let s = Session("well-"); s.swipe("known")
      return spaced(s, "well-known")
    case "A19":
      let s = Session("and/"); s.swipe("or")
      return spaced(s, "and/or")

    // B. Alternatives and backspace
    case "B1":
      for (prefix, word) in [("It is ", "good"), ("I want ", "to"), ("Say ", "hello")] {
        let s = Session(prefix); s.swipe(word)
        let texts = s.slots.map(\.text)
        if texts.count != 3 || Set(texts).count != 3 { return "\(word): bar \(texts)" }
      }
      return nil
    case "B2":
      let s = Session("Hello "); s.swipe("good")
      guard let alternative = s.pickAlternative(otherThan: String(s.text.dropFirst(6))) else { return "no alternative" }
      s.swipe("day")
      return spaced(s, "Hello \(alternative) day")
    case "B3":
      let s = Session(); s.swipe("good")
      guard let alternative = s.pickAlternative(otherThan: s.text) else { return "no alternative" }
      return first(alternative.first?.isUppercase == true ? nil : "alternative \(alternative) not capitalized", spaced(s, alternative))
    case "B4":
      let s = Session("Hi "); s.shift(); s.swipe("good")
      guard let alternative = s.pickAlternative(otherThan: String(s.text.dropFirst(3))) else { return "no alternative" }
      return first(alternative.first?.isUppercase == true ? nil : "alternative \(alternative) not capitalized", spaced(s, "Hi " + alternative))
    case "B5":
      let s = Session("Hi "); s.capsLock(); s.swipe("good")
      guard let alternative = s.pickAlternative(otherThan: String(s.text.dropFirst(3))) else { return "no alternative" }
      return first(alternative == alternative.uppercased() ? nil : "alternative \(alternative) not all caps", spaced(s, "Hi " + alternative))
    case "B6":
      let s = Session("Hello "); s.swipe("good")
      let committed = String(s.text.dropFirst(6))
      guard let alternative = s.pickAlternative(otherThan: committed) else { return "no alternative" }
      s.type(" ")
      let learned = s.personal.pairCount("hello", alternative)
      let wrong = s.personal.count(of: committed) + s.personal.count(of: committed.lowercased())
      return learned == 1 && wrong == 0 ? nil : "pair(hello,\(alternative))=\(learned), \(committed) count \(wrong)"
    case "B7":
      let s = Session("Hello "); s.swipe("world"); s.backspace()
      return same(s.text, "Hello ")
    case "B8":
      let s = Session("Hello "); s.swipe("world"); s.backspace(); s.backspace()
      return same(s.text, "Hello")
    case "B9":
      let s = Session(); s.swipe("hello"); s.backspace()
      return same(s.text, "")
    case "B10":
      let s = Session("Hello "); s.swipe("good")
      guard s.pickAlternative(otherThan: String(s.text.dropFirst(6))) != nil else { return "no alternative" }
      s.backspace()
      return same(s.text, "Hello ")
    case "B11":
      let s = Session("Hello "); s.swipe("good")
      let before = s.text
      guard let current = s.slots.first(where: { plain($0.text) == String(before.dropFirst(6)) }) else { return "committed word not in bar" }
      s.engine.select(current)
      s.type(" ")
      let committed = String(before.dropFirst(6))
      return first(same(s.text, before + " "), s.personal.pairCount("hello", committed) == 1 ? nil : "pair count \(s.personal.pairCount("hello", committed))")
    case "B12":
      let s = Session("Hello "); s.swipe("good"); s.type("a")
      return s.slots.contains(where: { $0.kind == .alternative }) ? "alternatives still offered: \(s.slots.map(\.text))" : nil
    case "B13":
      let s = Session("Hello "); s.swipe("world"); s.type("a"); s.backspace()
      return same(s.text, "Hello world ")
    case "B14":
      let s = Session("We "); s.swipe("were")
      let texts = s.slots.map { plain($0.text).lowercased() }
      return texts.contains("we're") ? nil : "bar \(texts)"
    case "B15":
      let s = Session("Hello "); s.swipe("world")
      let stale = s.ranked.first { $0.kind == .alternative && plain($0.text) != "world" }
      let before = s.text
      s.moveCursor(to: 0)
      if let stale { s.engine.select(stale) }
      return same(s.text, before)
    case "B16":
      let s = Session("Hello "); s.swipe("world"); s.backspace(); s.swipe("world")
      return spaced(s, "Hello world")

    // C. Words the decoder cannot produce yet
    case "C1":
      let s = Session("I saw ")
      typeKept("zorblax", in: s)
      s.type("and ")
      s.swipe("zorblax")
      return s.slots.contains(where: { plain($0.text) == "zorblax" }) ? nil : "after one use: bar \(s.slots.map(\.text)), text \(s.text.debugDescription)"
    case "C2":
      let s = Session("I saw ")
      typeKept("zorblax", in: s); s.type("and "); typeKept("zorblax", in: s); s.type("and ")
      s.swipe("zorblax")
      return s.text.hasSuffix("and zorblax") ? nil : "after two uses: \(s.text.debugDescription)"
    case "C3":
      let s = Session("I met ")
      typeKept("Isaac", in: s); s.type("and "); typeKept("Isaac", in: s); s.type("with ")
      s.swipe("isaac")
      return s.text.hasSuffix("with Isaac") ? nil : "got \(s.text.debugDescription)"
    case "C4":
      let personal = PersonalDictionary(url: nil)
      personal.pin("zorblax")
      let s = Session("I saw ", personal: personal); s.swipe("zorblax")
      return s.slots.contains(where: { plain($0.text) == "zorblax" }) ? nil : "bar \(s.slots.map(\.text))"
    case "C5":
      let s = Session("Just ")
      typeKept("yeet", in: s); s.type("it "); typeKept("yeet", in: s); s.type("it ")
      s.swipe("yeet")
      return s.slots.contains(where: { plain($0.text) == "yeet" }) ? nil : "bar \(s.slots.map(\.text)), text \(s.text.debugDescription)"
    case "C7":
      let s = Session("I saw "); s.swipe("zorblax"); s.backspace()
      return same(s.text, "I saw ")
    case "C8":
      var traits = InputTraits(); traits.contentType = "username"
      let personal = PersonalDictionary(url: nil)
      let hidden = Session(personal: personal); hidden.engine.traits = traits; hidden.engine.documentDidChange()
      hidden.type("zorblax zorblax ")
      let s = Session("I saw ", personal: personal); s.swipe("zorblax")
      return personal.count(of: "zorblax") == 0 && !s.slots.contains(where: { plain($0.text) == "zorblax" }) ? nil : "learned in a private field"
    case "C9":
      let s = Session("Just ")
      s.type("yeet ")
      if s.text.hasSuffix("yeet ") { return nil }  // not autocorrected; C5 covers it
      s.backspace()
      s.type(" it ")
      s.swipe("yeet")
      return s.slots.contains(where: { plain($0.text) == "yeet" }) ? nil : "reverted word not swipeable: bar \(s.slots.map(\.text))"

    // D. Capitalization
    case "D1":
      let s = Session("Hi "); s.shift(); s.swipe("there")
      return first(spaced(s, "Hi There"), s.engine.shift == .off ? nil : "shift \(s.engine.shift)")
    case "D2":
      let s = Session(); s.capsLock(); s.swipe("hello")
      return first(spaced(s, "HELLO"), s.engine.shift == .locked ? nil : "shift \(s.engine.shift)")
    case "D3":
      let s = Session("Hi. "); s.swipe("there")
      return spaced(s, "Hi. There")
    case "D4":
      let s = Session("Hi "); s.swipe("there")
      return spaced(s, "Hi there")
    case "D5":
      let s = Session("I live in "); s.swipe("london")
      return spaced(s, "I live in London")
    case "D6":
      let s = Session("I work at "); s.swipe("nasa")
      return spaced(s, "I work at NASA")
    case "D7":
      var traits = InputTraits(); traits.capitalization = .words
      let s = Session(traits: traits); s.swipe("hello"); s.swipe("world")
      return spaced(s, "Hello World")
    case "D8":
      let s = Session("Hi "); s.shift(); s.swipe("there"); s.swipe("again")
      return spaced(s, "Hi There again")
    case "D9":
      let s = Session(); s.capsLock(); s.swipe("dont")
      return spaced(s, "DON'T")
    case "D10":
      let s = Session("I live in "); s.shift(); s.swipe("london")
      return spaced(s, "I live in London")
    case "D11":
      let s = Session(); s.swipe("im")
      return spaced(s, "I'm")
    case "D12":
      let s = Session("my new "); s.swipe("iphone")
      return spaced(s, "my new iPhone")

    // E. Apostrophes and contractions
    case "E1": let s = Session("I "); s.swipe("dont"); return spaced(s, "I don't")
    case "E2": let s = Session(); s.swipe("im"); return spaced(s, "I'm")
    case "E3": let s = Session(); s.swipe("youre"); return spaced(s, "You're")
    case "E4": let s = Session("We "); s.swipe("were"); return spaced(s, "We were")
    case "E5": let s = Session("I'm doing "); s.swipe("well"); return spaced(s, "I'm doing well")
    case "E6": let s = Session("The dog wagged "); s.swipe("its"); return spaced(s, "The dog wagged its")
    case "E7": let s = Session("I "); s.swipe("cant"); return spaced(s, "I can't")
    case "E8": let s = Session("I "); s.swipe("wont"); return spaced(s, "I won't")
    case "E9": let s = Session(); s.swipe("ill"); return spaced(s, "I'll")
    case "E10": let s = Session("I feel "); s.swipe("ill"); return spaced(s, "I feel ill")
    case "E11": let s = Session(); s.swipe("lets"); return spaced(s, "Let's")
    case "E12": let s = Session("He said "); s.swipe("theyre"); return spaced(s, "He said they're")

    // F. Punctuation after a swipe
    case "F1": let s = Session(); s.swipe("word"); s.type("."); return same(s.text, "Word.")
    case "F2": let s = Session(); s.swipe("word"); s.type(","); return same(s.text, "Word,")
    case "F3":
      let a = Session(); a.swipe("word"); a.type("?")
      let b = Session(); b.swipe("word"); b.type("!")
      return first(same(a.text, "Word?"), same(b.text, "Word!"))
    case "F4": let s = Session(); s.swipe("hello"); s.type("."); s.swipe("how"); return spaced(s, "Hello. How")
    case "F5": let s = Session(); s.swipe("hello"); s.type(","); s.swipe("how"); return spaced(s, "Hello, how")
    case "F6": let s = Session("I think ("); s.swipe("maybe"); s.type(")"); return same(s.text, "I think (maybe)")
    case "F7":
      let s = Session(); s.swipe("word"); s.type(" ")
      return first(same(s.text, "Word "), s.engine.phantomSpace ? "still owes a space" : nil)
    case "F8": let s = Session(); s.swipe("word"); s.type("  "); return same(s.text, "Word. ")
    case "F9": let s = Session(); s.swipe("word"); s.type(". "); return same(s.text, "Word. ")
    case "F10": let s = Session(); s.swipe("note"); s.type(":"); s.swipe("this"); return spaced(s, "Note: this")
    case "F11":
      let s = Session("The "); s.swipe("dog"); s.type("'s")
      return same(s.text, "The dog's")
    case "F12": let s = Session("Say "); s.swipe("hello"); s.type("\""); return same(s.text, "Say hello\"")

    // G. Mixing taps and swipes
    case "G1": let s = Session(); s.swipe("hello"); s.type("world "); return same(s.text, "Hello world ")
    case "G2": let s = Session(); s.type("hi"); s.swipe("there"); return spaced(s, "Hi there")
    case "G3": let s = Session(); s.type("th"); s.swipe("there"); return spaced(s, "Th there")
    case "G4": let s = Session(); s.type("hi "); s.swipe("there"); return spaced(s, "Hi there")
    case "G5": let s = Session(); s.swipe("hello"); s.type("s"); return same(s.text, "Hello s")
    case "G6": let s = Session(); s.swipe("hello"); s.backspace(); s.type("hey "); return same(s.text, "Hey ")
    case "G7": let s = Session(); s.swipe("hello"); s.type("big "); s.swipe("world"); return spaced(s, "Hello big world")
    case "G8": let s = Session(); s.type("hi"); s.swipe("there"); s.backspace(); return same(s.text, "Hi ")
    case "G9": let s = Session(); s.swipe("good"); s.swipe("morning"); return spaced(s, "Good morning")
    case "G10": let s = Session("Hello "); s.type("wo"); s.swipe("world"); return spaced(s, "Hello wo world")

    // H. Gesture robustness the engine sees
    case "H8":
      // Lifting a key above the top row after the last letter.
      var points = path("hello")
      let last = points[points.count - 1]
      points.append(KeyPoint(x: last.x, y: last.y - 0.5))
      points.append(KeyPoint(x: last.x, y: last.y - 0.9))
      let s = Session("Say ")
      s.engine.insertGlide(points)
      return spaced(s, "Say hello")
    case "H10":
      for (prefix, word) in [("I want ", "to"), ("I live ", "in"), ("One ", "of")] {
        let s = Session(prefix); s.swipe(word)
        if let failure = spaced(s, prefix + word) { return failure }
      }
      return nil

    // I. Learning
    case "I1":
      let s = Session("I said "); s.swipe("hello"); s.type(" ")
      return s.personal.pairCount("said", "hello") == 1 ? nil : "pair count \(s.personal.pairCount("said", "hello"))"
    case "I2":
      let s = Session("It is "); s.swipe("good")
      let committed = String(s.text.dropFirst(6))
      guard let alternative = s.pickAlternative(otherThan: committed) else { return "no alternative" }
      s.type(" ")
      return s.personal.pairCount("is", alternative) == 1 && s.personal.pairCount("is", committed) == 0
        ? nil : "pair(is,\(alternative))=\(s.personal.pairCount("is", alternative)) pair(is,\(committed))=\(s.personal.pairCount("is", committed))"
    case "I3":
      let s = Session("I said "); s.swipe("hello"); s.backspace(); s.engine.save()
      return s.personal.count(of: "hello") == 0 ? nil : "learned a deleted swipe"
    case "I4", "I5":
      let s = Session("It is ")
      let rejected = s.swipe("good").first ?? ""
      s.backspace(); s.swipe("good"); s.backspace()
      s.swipe("good")
      let thirdText = String(s.text.dropFirst(6))
      if id == "I4" {
        return plain(thirdText) != rejected ? nil : "third swipe still \(thirdText)"
      }
      // The same keyboard session, another context, nothing kept in between.
      s.backspace()
      s.type("so ")
      let expected = Session("It is so ").swipe("good").first ?? ""
      s.swipe("good")
      return first(expected == rejected ? nil : "precondition: fresh decode \(expected)", spaced(s, "It is so " + rejected))
    case "I6":
      let url = FileManager.default.temporaryDirectory.appendingPathComponent("swipe-workflow-\(UUID().uuidString).json")
      defer { try? FileManager.default.removeItem(at: url) }
      let s = Session("I said ", personal: PersonalDictionary(url: url)); s.swipe("hello"); s.type(" "); s.engine.save()
      return PersonalDictionary(url: url).pairCount("said", "hello") == 1 ? nil : "not persisted"
    case "I7":
      let s = Session("I said "); s.swipe("hello"); s.backspace(); s.swipe("hello"); s.type(" ")
      return s.personal.count(of: "hello") == 1 ? nil : "count \(s.personal.count(of: "hello"))"

    // J. Privacy
    case "J1":
      var secure = InputTraits(); secure.isSecure = true
      let a = Session(traits: secure); a.swipe("hello"); a.type(" "); a.engine.save()
      var named = InputTraits(); named.contentType = "username"
      let b = Session(traits: named); b.swipe("hello"); b.type(" x "); b.engine.save()
      return a.personal.totalCount == 0 && b.personal.totalCount == 0 ? nil : "learned in a private field"
    case "J2":
      var named = InputTraits(); named.contentType = "username"
      let s = Session("It is ", traits: named)
      let decoded = s.swipe("good").first ?? ""
      s.backspace()
      for _ in 0..<2 { s.swipe("good"); s.backspace() }
      // The same keyboard in an ordinary field: private deletions left no rejection.
      s.engine.traits = InputTraits()
      s.engine.documentDidChange()
      s.swipe("good")
      return first(spaced(s, "It is " + decoded), s.personal.totalCount == 0 ? nil : "learned in a private field")
    case "J3":
      var named = InputTraits(); named.contentType = "username"
      let s = Session(traits: named); s.type("zorblax zorblax ")
      return s.personal.count(of: "zorblax") == 0 ? nil : "learned"
    case "J4":
      var named = InputTraits(); named.contentType = "username"
      let s = Session(traits: named); s.swipe("good")
      if let choice = s.slots.first { s.engine.select(choice) }
      s.type(" x ")
      return s.personal.totalCount == 0 ? nil : "learned"

    // Added after reading the code
    case "A20":
      // Sentence capitalization reaches past an opening quote or bracket, for taps too.
      let a = Session(); a.type("\"h")
      let b = Session("Done. "); b.type("(s")
      let c = Session("He said "); c.type("\"h")
      return first(same(a.text, "\"H"), same(b.text, "Done. (S"), same(c.text, "He said \"h"))
    case "B17":
      let s = Session("Hello world", cursor: 6); s.swipe("good")
      let committed = String(s.text.dropFirst(6).prefix { $0 != " " })
      guard let alternative = s.pickAlternative(otherThan: committed) else { return "no alternative before a following word: \(s.slots.map(\.text))" }
      let replaced = same(s.text, "Hello \(alternative) world")
      s.backspace()
      return first(replaced, same(s.text, "Hello world"))
    case "B18":
      // A proper noun picked from the bar is learned as spelled; a caps-lock swipe is not learned shouting.
      let s = Session("Hello "); s.swipe("good")
      guard let alternative = s.ranked.first(where: { plain($0.text) == "God" }) else { return "no God alternative: \(s.slots.map(\.text))" }
      s.engine.select(alternative); s.type(" ")
      let caps = Session("Say "); caps.capsLock(); caps.swipe("hello"); caps.type(" ")
      return first(s.personal.pairCount("hello", "God") == 1 ? nil : "God learned as \(s.personal.successors(of: "hello"))",
                   caps.personal.count(of: "hello") == 1 && caps.personal.count(of: "HELLO") == 0 ? nil : "caps-lock swipe learned as HELLO")
    case "B19":
      // Punctuation after a word swiped in front of another moves the typed space after it.
      let s = Session("Hello world", cursor: 6); s.swipe("big"); s.type(",")
      return first(same(s.text, "Hello big, world"), same(String(s.document.text[..<s.document.cursor]), "Hello big, "))
    case "C10":
      // Swipe fails, delete it, tap the word: the next swipe produces it.
      let s = Session("I saw ")
      let failed = s.swipe("zorblax").first ?? ""
      s.backspace()
      s.type("zorblax and ")
      s.swipe("zorblax")
      return failed == "zorblax" ? "decoder already knew it" : spaced(s, "I saw zorblax and zorblax")
    case "C11":
      // An unrelated word typed after deleting a swipe is not made swipeable.
      let s = Session("I saw ")
      s.swipe("hello"); s.backspace()
      s.type("zorblax ")
      return s.personal.isKnown("zorblax") ? "pinned a word the swipe was not aimed at" : nil
    case "D1v":
      let s = Session("Hi "); s.shift(); s.swipe("friend")
      return first(spaced(s, "Hi Friend"), s.engine.shift == .off ? nil : "shift \(s.engine.shift)")
    case "D4v": let s = Session("Hi "); s.swipe("friend"); return spaced(s, "Hi friend")
    case "D8v": let s = Session("Hi "); s.shift(); s.swipe("friend"); s.swipe("again"); return spaced(s, "Hi Friend again")
    case "D13":
      var traits = InputTraits(); traits.capitalization = .allCharacters
      let s = Session(traits: traits); s.swipe("hello"); s.swipe("world")
      return spaced(s, "HELLO WORLD")
    case "G2v": let s = Session(); s.type("hi"); s.swipe("friend"); return spaced(s, "Hi friend")
    case "G3v": let s = Session(); s.type("th"); s.swipe("friend"); return spaced(s, "Th friend")
    case "G4v": let s = Session(); s.type("hi "); s.swipe("friend"); return spaced(s, "Hi friend")
    case "G11":
      // A swipe corrects the word typed before it as a space would, and deleting
      // the swipe makes that correction undoable again.
      let s = Session("Just ")
      s.type("yeet"); s.swipe("hello")
      guard s.text == "Just yet hello" else { return "precondition: \(s.text.debugDescription)" }
      s.backspace()
      let afterSwipe = same(s.text, "Just yet ")
      s.backspace()
      s.type(" ")
      return first(afterSwipe, same(s.text, "Just yeet "), s.personal.count(of: "yet") == 0 ? nil : "learned the undone correction")
    case "G12":
      // Kept, the swipe and the correction before it are both learned.
      let s = Session("Just ")
      s.type("teh"); s.swipe("world"); s.type(" ")
      return first(same(s.text, "Just the world "), s.personal.pairCount("the", "world") == 1 && s.personal.pairCount("just", "the") == 1
                   ? nil : "pairs just-the \(s.personal.pairCount("just", "the")) the-world \(s.personal.pairCount("the", "world"))")
    case "I8":
      // A demoted word is the first alternative; picking it restores it.
      let s = Session("It is ")
      let rejected = s.swipe("good").first ?? ""
      s.backspace(); s.swipe("good"); s.backspace(); s.swipe("good")
      guard s.ranked.dropFirst().first.map({ plain($0.text) }) == rejected else { return "demoted word not first alternative: \(s.slots.map(\.text))" }
      _ = s.pickAlternative(otherThan: String(s.text.dropFirst(6)))
      s.type(" and it is ")
      s.swipe("good")
      return spaced(s, "It is \(rejected) and it is \(rejected)")
    default:
      return "unknown scenario"
    }
  }

  @Test(arguments: asserted)
  func scenario(_ id: String) {
    let failure = Self.run(id)
    #expect(failure == nil, "\(id): \(failure ?? "")")
  }

  /// Recorded human swipes replayed as a person would recover from a wrong word.
  /// `PK_WORKFLOW_SWIPES` takes the in-context file `HumanSwipeContextTests` reads.
  /// - Retries: recordings of one word after one prefix are successive attempts.
  ///   A wrong word is fixed with one bar tap when offered, else deleted and the
  ///   word swiped again; reports words entered and attempts spent.
  /// - New words: for words the decoder cannot produce, the first recording is
  ///   swiped and deleted and the word tap-typed in its place, then the second
  ///   recording is swiped later in the same session.
  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_WORKFLOW_SWIPES"] != nil))
  func replayRecordedRecovery() throws {
    let path = ProcessInfo.processInfo.environment["PK_WORKFLOW_SWIPES"]!
    let items = try JSONDecoder().decode([HumanSwipeContextTests.Item].self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    func gesture(_ item: HumanSwipeContextTests.Item) -> (points: [KeyPoint], times: [Double]?) {
      let points = (item.points ?? []).map { KeyPoint(x: $0[0], y: $0[1]) }
      return (points, item.times.flatMap { $0.count == points.count ? $0 : nil })
    }
    func matches(_ text: String, _ word: String) -> Bool { TextNormalizer.key(text) == word }

    var groups: [String: [HumanSwipeContextTests.Item]] = [:]
    var order: [String] = []
    for item in items {
      guard let prefix = item.prefix else { continue }
      let key = prefix + "\u{1F}" + item.word
      if groups[key] == nil { order.append(key) }
      groups[key, default: []].append(item)
    }
    var retryGroups = 0, firstTry = 0, oneTap = 0, entered = 0, attempts = 0, taps = 0, deletes = 0
    for key in order {
      guard let group = groups[key], group.count >= 3, let prefix = group[0].prefix else { continue }
      retryGroups += 1
      let session = Session(prefix)
      for (index, item) in group.enumerated() {
        let (points, times) = gesture(item)
        attempts += 1
        session.engine.insertGlide(points, times: times)
        let committed = String(session.text.dropFirst(prefix.count))
        if matches(committed, item.word) {
          if index == 0 { firstTry += 1 }
          entered += 1
          break
        }
        if let choice = session.ranked.first(where: { $0.kind == .alternative && matches(Self.plain($0.text), item.word) }) {
          session.engine.select(choice)
          taps += 1
          if index == 0 { oneTap += 1 }
          entered += 1
          break
        }
        session.backspace()
        deletes += 1
      }
    }
    print("WORKFLOW retries: \(retryGroups) words with 3+ attempts; entered \(entered) (first swipe \(firstTry), first swipe + one tap \(oneTap)); \(attempts) swipes, \(taps) bar taps, \(deletes) deletes")

    var byWord: [String: [HumanSwipeContextTests.Item]] = [:]
    var words: [String] = []
    for item in items where item.prefix != nil {
      if byWord[item.word] == nil { words.append(item.word) }
      byWord[item.word, default: []].append(item)
    }
    var unproducible = 0, learnedCommitted = 0, learnedReachable = 0
    for word in words {
      guard let recordings = byWord[word], recordings.count >= 2 else { continue }
      let lexicon = Fixtures.lexicon
      guard !lexicon.words(forKey: word).contains(where: { lexicon.flags($0).contains(.glide) }) else { continue }
      let first = recordings[0], second = recordings[1]
      let personal = PersonalDictionary(url: nil)
      let session = Session(first.prefix!, personal: personal)
      let (points, times) = gesture(first)
      guard !session.engine.insertGlide(points, times: times).isEmpty,
            !matches(String(session.text.dropFirst(first.prefix!.count)), word) else { continue }
      unproducible += 1
      session.backspace()
      session.type(word + " ")
      let later = Session(second.prefix!, personal: personal)
      let (again, againTimes) = gesture(second)
      later.engine.insertGlide(again, times: againTimes)
      let committed = String(later.text.dropFirst(second.prefix!.count))
      if matches(committed, word) { learnedCommitted += 1 }
      if matches(committed, word) || later.slots.contains(where: { matches(Self.plain($0.text), word) }) { learnedReachable += 1 }
    }
    print("WORKFLOW new words: \(unproducible) swiped wrong, deleted and typed once; next swipe committed \(learnedCommitted), reachable \(learnedReachable)")
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["PK_SWIPE_WORKFLOW_REPORT"] != nil))
  func reportScenarios() {
    var failures = 0
    for id in Self.ids {
      let failure = Self.run(id)
      if failure != nil { failures += 1 }
      print("SCENARIO \(id) \(failure == nil ? "PASS" : "FAIL") \(failure ?? "")")
    }
    print("SCENARIOS \(Self.ids.count - failures)/\(Self.ids.count) pass")
  }
}
