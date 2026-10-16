import Foundation
import Testing
@testable import KeyboardCore

struct LearningPersistenceTests {
  private func domain(_ body: (URL, URL) throws -> Void) throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("learning-v2-\(UUID())")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    try body(root.appendingPathComponent("PersonalDictionary.json"), root.appendingPathComponent("TouchModel.json"))
  }
  private func taps(_ word: String, dx: Double, dy: Double) -> TypedWord {
    TypedWord(text: word, taps: word.utf8.map { byte in
      LetterGeometry.qwerty.center(byte).map { KeyPoint(x: $0.x + dx, y: $0.y + dy) }
    })
  }

  @Test func resetRevokesBothStoresAndNewObservedLearningSurvives() throws {
    try domain { dictionaryURL, touchURL in
      let dictionary = PersonalDictionary(url: dictionaryURL), touch = TouchModel(url: touchURL)
      #expect(dictionary.pin("r33Antiguo"))
      #expect(touch.learn(taps("jasmine", dx: 0.1, dy: 0.2), intended: "jasmine", geometry: .qwerty))
      #expect(LearnedDataPersistence.clear(dictionaryURL: dictionaryURL, touchURL: touchURL) == .ok)
      #expect(dictionary.learn("r33Nuevo", after: "r33Historia", pinned: true))
      #expect(!dictionary.isKnown("r33Antiguo"))
      #expect(touch.learn(taps("ivy", dx: 0, dy: 0.1), intended: "ivy", geometry: .qwerty))
      try finishLearning(dictionary)
      let read = PersonalDictionary(url: dictionaryURL), readTouch = TouchModel(url: touchURL)
      #expect(read.persistenceResult == .ok && readTouch.persistenceResult == .ok)
      #expect(read.count(of: "r33Antiguo") == 0)
      #expect(read.count(of: "r33Nuevo") == 1)
      #expect(read.pairCount("r33historia", "r33Nuevo") == 1)
      #expect(readTouch.weight == 3)
    }
  }

  @Test func forgetRevokesOnlyEarlierMatchingTokensAndRelearnPinsExactlyOnce() throws {
    try domain { url, _ in
      let first = PersonalDictionary(url: url), second = PersonalDictionary(url: url)
      #expect(first.learn("r33Cañón", after: "r33Landscape"))
      #expect(first.pin("r33Meadow"))
      #expect(second.forget("R33CANON"))
      #expect(first.reloadIfChangedOnDisk())
      #expect(first.isBlocked("r33cañón"))
      #expect(first.count(of: "r33Cañón") == 0)
      #expect(first.pin("r33Cañón"))
      #expect(first.forget("r33canon"))
      #expect(first.learn("r33cañón", after: "r33Landscape", pinned: true))
      try finishLearning(first)
      let read = PersonalDictionary(url: url)
      #expect(read.isKnown("r33Meadow"))
      #expect(read.count(of: "r33Cañón") == 0)
      #expect(read.count(of: "r33cañón") == 1)
      #expect(!read.isBlocked("R33CANON"))
      #expect(read.pairCount("r33landscape", "r33cañón") == 1)
      #expect(read.pairCount("r33landscape", "r33Cañón") == 0)
    }
  }

  @Test func capacityFlushKeepsLongTypingAndByteRejectionDoesNotTeach() throws {
    try domain { url, _ in
      let personal = PersonalDictionary(url: url)
      for i in 0..<600 { #expect(personal.learn("r33long\(i)", after: "r33LongHistory")) }
      let oversized = "r33" + String(repeating: "\u{0301}", count: 300)
      #expect(!personal.learn(oversized, after: nil))
      #expect(personal.persistenceResult == .invalid)
      #expect(personal.count(of: oversized) == 0)
      try finishLearning(personal)
      let read = PersonalDictionary(url: url)
      #expect(read.totalCount == 600)
      #expect(read.historyCount("r33longhistory") == 600)
      #expect(read.count(of: "r33long599") == 1)
    }
  }

  @Test func touchMergePreservesWordGroupedClampAndDecay() throws {
    try domain { _, url in
      let a = TouchModel(url: url), b = TouchModel(url: url), oracle = TouchModel(url: nil)
      let word = "sassafras"
      for i in 0..<100 {
        let typed = taps(word, dx: i % 2 == 0 ? 0.7 : -0.5, dy: 0.3)
        let model = i % 2 == 0 ? a : b
        #expect(model.learn(typed, intended: word, geometry: .qwerty))
        #expect(oracle.learn(typed, intended: word, geometry: .qwerty))
      }
      try finishLearning(a)
      let read = TouchModel(url: url)
      #expect(abs(read.weight - oracle.weight) < 1e-9)
      for byte in UInt8(97)...UInt8(122) {
        #expect(abs(read.offset(byte).x - oracle.offset(byte).x) < 1e-12)
        #expect(abs(read.offset(byte).y - oracle.offset(byte).y) < 1e-12)
      }
    }
  }

  @Test func migrationImportsBothV1StoresOnceAndMissingAuthorityFailsClosed() throws {
    try domain { dictionaryURL, touchURL in
      let old = PersonalDictionary.Snapshot(words: ["r33Inherited": .init(count: 2, lastUsed: 1, pinned: false)], pairs: ["r33ancestry\u{1F}r33Inherited": 2])
      try JSONEncoder().encode(old).write(to: dictionaryURL)
      var keys = Array(repeating: [0.0, 0.0, 0.0], count: 26)
      keys[0] = [0.1, 0.2, 1]
      try JSONEncoder().encode(TouchModel.Snapshot(keys: keys)).write(to: touchURL)
      let personal = PersonalDictionary(url: dictionaryURL), touch = TouchModel(url: touchURL)
      #expect(personal.persistenceResult == .ok && touch.persistenceResult == .ok)
      #expect(personal.count(of: "r33Inherited") == 2)
      #expect(touch.weight == 1)
      #expect(LearnedDataPersistence.clear(dictionaryURL: dictionaryURL, touchURL: touchURL) == .ok)
      #expect(!FileManager.default.fileExists(atPath: dictionaryURL.path))
      #expect(!FileManager.default.fileExists(atPath: touchURL.path))
      try JSONEncoder().encode(old).write(to: dictionaryURL)
      try FileManager.default.removeItem(at: LearnedDataPersistence.storageURL(for: dictionaryURL))
      let failed = PersonalDictionary(url: dictionaryURL)
      #expect(failed.persistenceResult == .invalid)
      #expect(!failed.pin("r33MustNotImport"))
      #expect(failed.count(of: "r33Inherited") == 0)
    }
  }

  @Test func malformedSiblingRejectsMigrationWithoutDiscardingValidLegacy() throws {
    try domain { dictionaryURL, touchURL in
      let data = try JSONEncoder().encode(PersonalDictionary.Snapshot(words: ["r33Retained": .init(count: 1, lastUsed: 1, pinned: true)]))
      try data.write(to: dictionaryURL)
      try Data("{invalid".utf8).write(to: touchURL)
      let personal = PersonalDictionary(url: dictionaryURL)
      #expect(personal.persistenceResult == .invalid)
      #expect(try Data(contentsOf: dictionaryURL) == data)
      #expect(!FileManager.default.fileExists(atPath: LearnedDataPersistence.storageURL(for: dictionaryURL).path + ".initialized"))
    }
  }

  @Test func memoryModelsKeepTransientWordsAndNeverNeedAnAuthority() {
    let personal = PersonalDictionary(url: nil), touch = TouchModel(url: nil)
    personal.setTransientWords(["r33Contact"])
    #expect(personal.pin("r33Local"))
    #expect(touch.learn(taps("azalea", dx: 0.1, dy: 0.1), intended: "azalea", geometry: .qwerty))
    #expect(personal.clear() && touch.reset())
    #expect(personal.isKnown("r33Contact"))
    #expect(!personal.isKnown("r33Local"))
    #expect(touch.weight == 0)
    #expect(personal.save() && touch.save())
    #expect(LearnedDataPersistence.clear(dictionaryURL: nil, touchURL: nil) == .invalid)
  }
  @Test func separatorHistoriesAndTargetsRoundTripWithoutChangingTheirIdentity() throws {
    try domain { url, _ in
      let personal = PersonalDictionary(url: url)
      let history = "r33\u{1F}history", target = "r33\u{1F}target"
      #expect(personal.learn(target, after: history, pinned: true))
      #expect(personal.learn("r33other", after: "\u{1F}r33leading"))
      try finishLearning(personal)
      let read = PersonalDictionary(url: url)
      #expect(read.pairCount(history, target) == 1)
      #expect(read.historyCount(history) == 1)
      #expect(read.pairCount("\u{1F}r33leading", "r33other") == 1)
      #expect(read.forget(target))
      #expect(read.pairCount(history, target) == 0)
    }
  }

  @Test func oversizedValidLegacyIsPrunedAndLongBlockPreferencesSurvive() throws {
    try domain { url, _ in
      let words = Dictionary(uniqueKeysWithValues: (0..<5001).map { ("r33inherited\($0)", PersonalDictionary.Word(count: 1, lastUsed: 1, pinned: true)) })
      let pairs = Dictionary(uniqueKeysWithValues: (0..<20001).map { ("r33ancestor\($0)\u{1F}r33descendant", 1) })
      let block = String(repeating: "r33blocked", count: 100)
      try JSONEncoder().encode(PersonalDictionary.Snapshot(words: words, pairs: pairs, blocked: [block])).write(to: url)
      let personal = PersonalDictionary(url: url)
      #expect(personal.persistenceResult == .ok)
      #expect(personal.knownWords.count == 4500)
      #expect(personal.totalCount == 4500)
      #expect(personal.isBlocked(block))
      let read = PersonalDictionary(url: url)
      #expect(read.persistenceResult == .ok && read.isBlocked(block))
      #expect(read.knownWords.count == 4500)
    }
  }

  @Test func overflowRefusesAdmissionOrAtomicMergeWithoutLosingTokens() throws {
    try domain { url, touchURL in
      try JSONEncoder().encode(PersonalDictionary.Snapshot(words: ["r33maximum": .init(count: Int.max - 1, lastUsed: 1, pinned: false)])).write(to: url)
      let a = PersonalDictionary(url: url), b = PersonalDictionary(url: url), touch = TouchModel(url: touchURL)
      #expect(a.learn("r33maximum", after: nil))
      #expect(!a.learn("r33maximum", after: nil))
      #expect(a.persistenceResult == .capacity)
      #expect(b.learn("r33maximum", after: nil))
      #expect(touch.learn(taps("basil", dx: 0.1, dy: 0.1), intended: "basil", geometry: .qwerty))
      #expect(!a.save())
      #expect(a.persistenceResult == .capacity)
      #expect(a.hasUnsavedChanges)
      let read = PersonalDictionary(url: url), readTouch = TouchModel(url: touchURL)
      #expect(read.persistenceResult == .ok && readTouch.persistenceResult == .ok)
      #expect(read.count(of: "r33maximum") == Int.max - 1)
      #expect(readTouch.weight == 0)
      #expect(LearnedDataPersistence.clear(dictionaryURL: url, touchURL: touchURL) == .ok)
      #expect(a.pin("r33afteroverflow"))
      try finishLearning(a)
      #expect(PersonalDictionary(url: url).count(of: "r33afteroverflow") == 1)
    }
  }

  @Test func successfulMemoryOperationsClearAnEarlierInvalidResult() {
    let personal = PersonalDictionary(url: nil), touch = TouchModel(url: nil)
    #expect(!personal.learn("", after: nil))
    #expect(personal.learn("r33memory", after: nil))
    #expect(personal.persistenceResult == .ok)
    #expect(!touch.learn(TypedWord(text: "x"), intended: "x", geometry: .qwerty))
    #expect(touch.learn(taps("rosemary", dx: 0.1, dy: 0), intended: "rosemary", geometry: .qwerty))
    #expect(touch.persistenceResult == .ok)
    #expect(personal.clear() && touch.reset())
    #expect(personal.persistenceResult == .ok && touch.persistenceResult == .ok)
  }

}
