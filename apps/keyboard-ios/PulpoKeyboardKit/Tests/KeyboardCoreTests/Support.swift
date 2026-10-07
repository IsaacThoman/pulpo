import Foundation
@testable import KeyboardCore

enum Fixtures {
  static let languageData = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    .appendingPathComponent("LanguageData")

  static let lexicon: Lexicon = try! Lexicon(url: languageData.appendingPathComponent("en_US.pkdict"))

  static func stack(personal: PersonalDictionary = PersonalDictionary(url: nil)) -> (LanguageModel, Suggester, GlideDecoder) {
    let model = LanguageModel(lexicon: lexicon, personal: personal)
    let corrector = SpellCorrector(lexicon: lexicon)
    return (model, Suggester(model: model, corrector: corrector), GlideDecoder(model: model))
  }

  static func engine(_ text: String = "", settings: KeyboardSettings = KeyboardSettings(), traits: InputTraits = InputTraits()) -> (KeyboardEngine, MockDocument) {
    let document = MockDocument(text)
    let (_, suggester, glide) = stack()
    let engine = KeyboardEngine(document: document, suggester: suggester, glide: glide, settings: settings)
    engine.traits = traits
    engine.documentDidChange()
    return (engine, document)
  }
}

/// A text field with the cursor at `cursor`.
final class MockDocument: TextDocument {
  var text: String
  var cursor: String.Index
  var deletions = 0

  init(_ text: String = "") {
    self.text = text
    cursor = text.endIndex
  }

  /// Simulates the text proxy reporting the document a few characters behind.
  var lag = 0

  var documentContextBeforeInput: String? { String(text[..<cursor].dropLast(lag)) }
  var documentContextAfterInput: String? { String(text[cursor...]) }
  var selectedText: String? { nil }
  var hasText: Bool { !text.isEmpty }

  func insertText(_ inserted: String) {
    let offset = text.distance(from: text.startIndex, to: cursor)
    text.insert(contentsOf: inserted, at: cursor)
    cursor = text.index(text.startIndex, offsetBy: offset + inserted.count)
  }

  func deleteBackward() {
    guard cursor > text.startIndex else { return }
    deletions += 1
    let offset = text.distance(from: text.startIndex, to: cursor)
    text.remove(at: text.index(before: cursor))
    cursor = text.index(text.startIndex, offsetBy: offset - 1)
  }

  func moveCursor(to offset: Int) {
    cursor = text.index(text.startIndex, offsetBy: offset)
  }
}

extension KeyboardEngine {
  /// Types `text` key by key, tapping each letter at its key center.
  func type(_ text: String) {
    for character in text {
      switch character {
      case " ": insertSpace()
      case "\n": insertReturn()
      default:
        let lower = String(character).lowercased()
        if character.isUppercase, !shift.isActive { shiftDown(); shiftUp() }
        let tap = lower.utf8.count == 1 ? LetterGeometry.qwerty.center(lower.utf8.first!) : nil
        insertCharacter(lower == String(character) ? String(character) : lower, tap: tap)
      }
    }
  }
}

/// Deterministic pseudo-random numbers for synthetic gestures.
struct SeededGenerator: RandomNumberGenerator {
  var state: UInt64

  mutating func next() -> UInt64 {
    state = state &* 6364136223846793005 &+ 1442695040888963407
    var z = state
    z = (z ^ (z >> 33)) &* 0xff51afd7ed558ccd
    z = (z ^ (z >> 33)) &* 0xc4ceb93fe5a4d4b4
    return z ^ (z >> 33)
  }

  mutating func gaussian(_ sigma: Double) -> Double {
    let u1 = max(Double.random(in: 0..<1, using: &self), 1e-12)
    let u2 = Double.random(in: 0..<1, using: &self)
    return sigma * (-2 * log(u1)).squareRoot() * cos(2 * .pi * u2)
  }
}

enum SyntheticSwipe {
  /// A human-ish swipe: noisy letter targets joined by a smoothed curve.
  static func points(for word: String, noise: Double, generator: inout SeededGenerator, geometry: LetterGeometry = .qwerty) -> [KeyPoint] {
    var targets: [KeyPoint] = []
    var previous: UInt8 = 0
    for byte in TextNormalizer.key(word).utf8 where byte != previous {
      guard let center = geometry.center(byte) else { continue }
      targets.append(KeyPoint(x: center.x + generator.gaussian(noise), y: center.y + generator.gaussian(noise * 0.8)))
      previous = byte
    }
    guard targets.count >= 2 else { return targets }
    // Dense straight path through the targets, then a moving average that rounds
    // corners off the way a finger does.
    var dense: [KeyPoint] = []
    for index in 1..<targets.count {
      let a = targets[index - 1], b = targets[index]
      let steps = max(2, Int(a.distance(to: b) / 0.08))
      for step in 0..<steps {
        let t = Double(step) / Double(steps)
        dense.append(KeyPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t))
      }
    }
    dense.append(targets[targets.count - 1])
    let radius = 3
    var points: [KeyPoint] = []
    for index in dense.indices {
      let window = dense[max(0, index - radius)...min(dense.count - 1, index + radius)]
      let x = window.reduce(0) { $0 + $1.x } / Double(window.count)
      let y = window.reduce(0) { $0 + $1.y } / Double(window.count)
      points.append(KeyPoint(x: x + generator.gaussian(0.015), y: y + generator.gaussian(0.015)))
    }
    return points
  }
}
