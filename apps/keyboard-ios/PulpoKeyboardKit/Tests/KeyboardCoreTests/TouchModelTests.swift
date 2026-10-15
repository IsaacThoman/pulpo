import Foundation
import Testing
@testable import KeyboardCore

/// Personal touch adaptation: per-key tap offsets learned from accepted words.
struct TouchModelTests {
  static let geometry = LetterGeometry.qwerty

  /// Taps aimed at every letter of `word`, each landing `offset` from its key center.
  func taps(_ word: String, offset: KeyPoint) -> TypedWord {
    TypedWord(text: word, taps: word.utf8.map { byte in
      Self.geometry.center(byte).map { KeyPoint(x: $0.x + offset.x, y: $0.y + offset.y) }
    })
  }

  @Test func learnsASystematicOffsetFromAcceptedWords() {
    let model = TouchModel(url: nil)
    let low = KeyPoint(x: 0.1, y: 0.2)
    for _ in 0..<40 { model.learn(taps("the", offset: low), intended: "the", geometry: Self.geometry) }
    let t = model.offset(Character("t").asciiValue!)
    #expect(abs(t.x - 0.1) < 0.03 && abs(t.y - 0.2) < 0.03)
    // A key never typed follows the person's overall offset, shrunk toward zero.
    let q = model.offset(Character("q").asciiValue!)
    #expect(q.y > 0.1 && q.y < 0.2)
  }

  @Test func oneMistapCannotDragAKeyTowardItsNeighbor() {
    let model = TouchModel(url: nil)
    for _ in 0..<30 { model.learn(taps("as", offset: KeyPoint(x: 0, y: 0)), intended: "as", geometry: Self.geometry) }
    // Accepted "as" whose a tap actually landed on s.
    var slip = taps("as", offset: KeyPoint(x: 0, y: 0))
    slip.taps[0] = Self.geometry.center(Character("s").asciiValue!)
    model.learn(slip, intended: "as", geometry: Self.geometry)
    #expect(model.offset(Character("a").asciiValue!).x < 0.03)
  }

  @Test func wordsWhoseLettersDoNotLineUpTeachNothing() {
    let model = TouchModel(url: nil)
    model.learn(taps("thw", offset: KeyPoint(x: 0.3, y: 0.3)), intended: "there", geometry: Self.geometry)
    #expect(model.weight == 0)
  }

  @Test func persistsOnlyOffsetsAndRestoresThem() throws {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("touch-\(UUID().uuidString).json")
    defer { try? FileManager.default.removeItem(at: url) }
    let model = TouchModel(url: url)
    for _ in 0..<20 { model.learn(taps("hello", offset: KeyPoint(x: -0.1, y: 0.15)), intended: "hello", geometry: Self.geometry) }
    model.save()
    let text = try String(contentsOf: url, encoding: .utf8)
    #expect(!text.contains("hello"))
    let restored = TouchModel(url: url)
    #expect(abs(restored.weight - model.weight) < 1e-9)
    #expect(abs(restored.offset(Character("h").asciiValue!).y - model.offset(Character("h").asciiValue!).y) < 1e-9)
  }

  @Test func offsetsApplyOnlyOnceThereIsEnoughEvidence() {
    let (_, suggester, _) = Fixtures.stack()
    let touch = TouchModel(url: nil)
    suggester.corrector.touch = touch
    touch.learn(taps("then", offset: KeyPoint(x: 0, y: 0.3)), intended: "then", geometry: Self.geometry)
    #expect(suggester.corrector.learnedOffsets == nil)
    for _ in 0..<12 { touch.learn(taps("then", offset: KeyPoint(x: 0, y: 0.3)), intended: "then", geometry: Self.geometry) }
    #expect(suggester.corrector.learnedOffsets != nil)
  }

  @Test func aLearnedOffsetMovesWhereAKeyIsMeasuredFrom() {
    let (_, suggester, _) = Fixtures.stack()
    let corrector = suggester.corrector
    // Aimed at t, landed low enough to register g.
    var word = taps("ghe", offset: KeyPoint(x: 0, y: 0))
    word.taps[0] = KeyPoint(x: 4.6, y: 0.55)
    let plain = corrector.cost(of: word, against: "the")
    let touch = TouchModel(url: nil)
    corrector.touch = touch
    // This person lands about 0.4 pitch below every key.
    for _ in 0..<30 { touch.learn(taps("jot", offset: KeyPoint(x: 0, y: 0.4)), intended: "jot", geometry: Self.geometry) }
    #expect(corrector.cost(of: word, against: "the") < plain)
  }

  @Test(arguments: [true, false])
  func privateFieldsNeverTeachTheTouchModel(secure: Bool) {
    var traits = InputTraits()
    if secure { traits.isSecure = true } else { traits.contentType = "password" }
    let (engine, _) = Fixtures.engine(traits: traits)
    let touch = TouchModel(url: nil)
    engine.suggester?.corrector.touch = touch
    engine.type("the quick brown fox jumps over the lazy dog ")
    #expect(touch.weight == 0)
  }

  @Test func ordinaryFieldsLearnFromKeptWords() {
    let (engine, _) = Fixtures.engine()
    let touch = TouchModel(url: nil)
    engine.suggester?.corrector.touch = touch
    engine.type("the quick brown fox jumps over the lazy dog ")
    #expect(touch.weight >= 30)
  }
}
