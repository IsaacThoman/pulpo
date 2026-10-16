import Foundation
import Testing
@testable import KeyboardCore

struct LearningPersistenceTests {
  @Test func memoryLongHistoriesPruneTheSamePairsAndQueryIndexes() {
    for length in [30, 257] {
      let value = PersonalDictionary(url: nil)
      let prefix = String(repeating: "h", count: length - 5)
      for i in 0..<20001 {
        #expect(value.learn("r33memory", after: prefix + String(format: "%05d", i)))
      }
      var retained = 0
      for i in 0..<20001 {
        let history = prefix + String(format: "%05d", i)
        retained += value.historyCount(history)
        #expect(value.pairCount(history, "r33memory") == value.historyCount(history))
      }
      #expect(retained == 18000)
      #expect(value.totalCount == 20001)
      #expect(value.historyCount(prefix + "20000") == 0)
      #expect(value.persistenceResult == .ok)
    }
  }

  @Test func stablePairGrammarValidatesEscapesAndQuarantinesUnshippedFormat() throws {
    try domain { url, _ in
      let pairs = ["r33a\u{0897}\u{1F}r33stable": 1]
      try JSONEncoder().encode(PersonalDictionary.Snapshot(pairEncoding: 4, pairs: pairs)).write(to: url)
      let value = PersonalDictionary(url: url)
      #expect(value.persistenceResult == .ok)
      #expect(value.pairCount("r33a\u{0897}", "r33stable") == 1)
      try finishLearning(value)
    }
    for (encoding, key) in [(3, "4:r33a\u{0897}\u{1F}r33stable"), (4, "r33bad\\q\u{1F}r33stable"), (4, "r33bad\u{1F}r33stable\\"), (4, "r33bad\u{1F}extra\u{1F}r33stable")] {
      try domain { url, touchURL in
        let bytes = try JSONEncoder().encode(PersonalDictionary.Snapshot(pairEncoding: encoding, pairs: [key: 1]))
        try bytes.write(to: url)
        #expect(PersonalDictionary(url: url).persistenceResult == .invalid)
        #expect(TouchModel(url: touchURL).persistenceResult == .invalid)
        #expect(LearnedDataPersistence.clear(dictionaryURL: url, touchURL: touchURL) == .invalid)
        #expect(try Data(contentsOf: url) == bytes)
      }
    }
  }

  @Test func canonicalHistoriesPreservePairsAcrossMergeMigrationAndForget() throws {
    let variants = [("r33caf\u{E9}", "r33cafe\u{301}"), ("r33\u{AC00}", "r33\u{1100}\u{1161}")]
    for (composed, decomposed) in variants {
      try domain { url, _ in
        let a = PersonalDictionary(url: url), b = PersonalDictionary(url: url)
        #expect(a.learn("r33canonical", after: composed))
        #expect(a.learn("r33canonical", after: decomposed))
        #expect(a.pairCount(composed, "r33canonical") == 2)
        try finishLearning(a)
        #expect(b.learn("r33canonical", after: decomposed))
        try finishLearning(b)
        try finishLearning(b)
        let read = PersonalDictionary(url: url)
        #expect(read.persistenceResult == .ok)
        #expect(read.pairCount(composed, "r33canonical") == 3)
        #expect(read.historyCount(decomposed) == 3)
        #expect(read.forget("r33canonical"))
        #expect(read.historyCount(composed) == 0)
      }
      for encoding in 1...2 {
        try domain { url, _ in
          let first = encoding == 1 ? composed + "\u{1F}r33migrated" : "\(composed.utf8.count):" + composed + "r33migrated"
          let second = "\(decomposed.utf8.count):" + decomposed + "r33migrated"
          let pairs = encoding == 1 ? [first: 2] : [first: 1, second: 1]
          try JSONEncoder().encode(PersonalDictionary.Snapshot(pairEncoding: encoding, pairs: pairs)).write(to: url)
          let read = PersonalDictionary(url: url)
          #expect(read.persistenceResult == .ok)
          #expect(read.pairCount(composed, "r33migrated") == 2)
          #expect(read.historyCount(decomposed) == 2)
          try finishLearning(read)
          #expect(PersonalDictionary(url: url).pairCount(decomposed, "r33migrated") == 2)
        }
      }
    }
    try domain { url, _ in
      let pairs = ["8:r33caf\u{E9}r33overflow": Int.max, "9:r33cafe\u{301}r33overflow": 1]
      let data = try JSONEncoder().encode(PersonalDictionary.Snapshot(pairEncoding: 2, pairs: pairs))
      try data.write(to: url)
      #expect(PersonalDictionary(url: url).persistenceResult == .invalid)
      #expect(try Data(contentsOf: url) == data)
    }
  }

  @Test func pairEncodingPreservesCombiningAndControlBoundaries() throws {
    try domain { url, _ in
      let value = PersonalDictionary(url: url)
      let pairs = [("r33a", "\u{301}r33target"), ("r33\r", "\nr33target"), ("r33\u{1F}", "\u{1F}r33target"), ("r33\u{200D}", "\u{301}r33target"), ("\u{301}r33history", "r33target"), ("r33\\history", "\\r33target"), ("r33\\\u{1F}history", "r33\u{1F}\\target")]
      for (history, target) in pairs { #expect(value.learn(target, after: history)) }
      try finishLearning(value)
      let read = PersonalDictionary(url: url)
      #expect(read.persistenceResult == .ok)
      for (history, target) in pairs {
        #expect(read.pairCount(history, target) == 1)
        #expect(read.historyCount(history) == 1)
      }
    }
  }

  @Test func embeddedNullKeysKeepDistinctForgetAndRetryIdentities() throws {
    try domain { url, _ in
      let first = PersonalDictionary(url: url), second = PersonalDictionary(url: url)
      let a = "r33null\u{0}alpha", b = "r33null\u{0}beta", leading = "\u{0}r33leading"
      #expect(first.learn(a, after: "r33nullHistory", pinned: true))
      #expect(first.pin(b))
      #expect(first.pin(leading))
      #expect(second.forget("r33null"))
      try finishLearning(first)
      try finishLearning(first)
      let read = PersonalDictionary(url: url)
      #expect(read.persistenceResult == .ok)
      #expect(read.count(of: a) == 1 && read.count(of: b) == 1 && read.count(of: leading) == 1)
      #expect(read.pairCount("r33nullHistory", a) == 1)
      #expect(first.learn(a, after: "r33nullHistory"))
      #expect(first.learn(b, after: "r33nullHistory"))
      #expect(second.forget(a))
      try finishLearning(first)
      let final = PersonalDictionary(url: url)
      #expect(final.persistenceResult == .ok)
      #expect(final.count(of: a) == 0 && final.count(of: b) == 2)
      #expect(final.pairCount("r33nullHistory", a) == 0)
      #expect(final.pairCount("r33nullHistory", b) == 1)
    }
  }

  @Test func registryCapacityStillAllowsSlotlessReadAndCombinedReset() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("r33-registry-\(UUID())")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    var retained: [PersonalDictionary] = []
    for i in 0..<34 {
      retained.append(PersonalDictionary(url: root.appendingPathComponent("\(i)/PersonalDictionary.json")))
    }
    let url = root.appendingPathComponent("33/PersonalDictionary.json")
    let extra = PersonalDictionary(url: url)
    #expect(extra.persistenceResult == .ok)
    #expect(!retained.last!.pin("r33capacity"))
    #expect(retained.last!.persistenceResult == .capacity)
    #expect(LearnedDataPersistence.clear(dictionaryURL: url, touchURL: url.deletingLastPathComponent().appendingPathComponent("TouchModel.json")) == .ok)
    #expect(!extra.reloadIfChangedOnDisk())
    #expect(extra.persistenceResult == .ok)
    #expect(extra.totalCount == 0)
    withExtendedLifetime(retained) {}
  }

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
