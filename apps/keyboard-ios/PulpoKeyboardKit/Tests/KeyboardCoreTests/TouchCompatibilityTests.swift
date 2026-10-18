import Foundation
import Testing
@testable import KeyboardCore

struct TouchCompatibilityTests {
  private let geometry = LetterGeometry.qwerty

  private func word(_ text: String, known: Int? = nil, dx: Double = 0.12, dy: Double = -0.18) -> TypedWord {
    TypedWord(text: text, taps: text.utf8.enumerated().map { index, byte in
      guard index < (known ?? text.utf8.count), let center = geometry.center(byte) else { return nil }
      return KeyPoint(x: center.x + dx, y: center.y + dy)
    })
  }

  private func directory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("touch-compat-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  private struct FileImage: Equatable {
    let data: Data
    let modified: Date?
    let inode: UInt64?
  }

  private func files(_ directory: URL) throws -> [String: FileImage] {
    var result: [String: FileImage] = [:]
    for path in try FileManager.default.subpathsOfDirectory(atPath: directory.path) {
      let url = directory.appendingPathComponent(path)
      let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
      let data = attributes[.type] as? FileAttributeType == .typeRegular ? try Data(contentsOf: url) : Data()
      result[path] = FileImage(data: data, modified: attributes[.modificationDate] as? Date,
                               inode: (attributes[.systemFileNumber] as? NSNumber)?.uint64Value)
    }
    return result
  }

  @Test(arguments: [40, 41, 64])
  func localDenseLongWordsRetainEveryAlignedSample(length: Int) {
    let text = String(repeating: "asdf", count: 16).prefix(length)
    let model = TouchModel(url: nil)
    #expect(model.learn(word(String(text)), intended: String(text), geometry: geometry))
    #expect(model.weight == Double(length))
    #expect(model.offset(UInt8(ascii: "a")).x > 0)
    #expect(model.offset(UInt8(ascii: "s")).y < 0)
    #expect(model.offsets.allSatisfy { $0.x.isFinite && $0.y.isFinite })
  }

  @Test func longWordKeepsOneClampReferenceForAllSamples() {
    let model = TouchModel(url: nil)
    let text = String(repeating: "a", count: 41)
    #expect(model.learn(word(text, dx: 4, dy: 0), intended: text, geometry: geometry))
    // Every sample clamps to .45 around the initial zero reference. Updating the
    // reference within the word would instead let later samples drift farther.
    let total = 41.0 * 0.45
    let global = total / (41 + 24)
    #expect(abs(model.snapshot.keys[0][0] - total) < 1e-12)
    #expect(abs(model.offset(UInt8(ascii: "a")).x - min(0.4, (total + 12 * global) / (41 + 12))) < 1e-12)
    #expect(abs(model.offset(UInt8(ascii: "q")).x - global) < 1e-12)
    #expect(model.weight == 41)
  }

  @Test(arguments: [41, 64], [1, 40])
  func sparseLongPersistentWordsUseActualSampleCount(length: Int, known: Int) throws {
    let directory = try directory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("TouchModel.json")
    let persistent = TouchModel(url: url)
    let local = TouchModel(url: nil)
    let text = String(String(repeating: "asdf", count: 16).prefix(length))
    let input = word(text, known: known)
    try learningEventually({ persistent.learn(input, intended: text, geometry: geometry) }, result: { persistent.persistenceResult })
    #expect(local.learn(input, intended: text, geometry: geometry))
    #expect(persistent.weight == Double(known))
    #expect(persistent.snapshot == local.snapshot)
    try finishLearning(persistent)
    let reopened = TouchModel(url: url)
    #expect(reopened.persistenceResult == .ok)
    #expect(reopened.snapshot == local.snapshot)
    #expect(reopened.offsets == local.offsets)
  }

  @Test func persistentFortySampleBoundaryRoundTrips() throws {
    let directory = try directory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("TouchModel.json")
    let model = TouchModel(url: url)
    let text = String(repeating: "as", count: 20)
    try learningEventually({ model.learn(word(text), intended: text, geometry: geometry) }, result: { model.persistenceResult })
    #expect(model.weight == 40)
    try finishLearning(model)
    #expect(TouchModel(url: url).snapshot == model.snapshot)
  }

  @Test func normalizedExpansionCountsDuplicatedLetterSamples() throws {
    let directory = try directory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("TouchModel.json")
    let model = TouchModel(url: url)
    let local = TouchModel(url: nil)
    let text = String(repeating: "ﬀ", count: 21)
    let center = try #require(geometry.center(UInt8(ascii: "f")))
    var input = TypedWord(text: text, taps: Array(repeating: center, count: 21))
    #expect(TextNormalizer.key(text).utf8.count == 42)
    #expect(local.learn(input, intended: text, geometry: geometry))
    #expect(local.weight == 42)
    let before = try files(directory)
    #expect(!model.learn(input, intended: text, geometry: geometry))
    #expect(model.persistenceResult == .invalid)
    #expect(model.weight == 0)
    #expect(try files(directory) == before)
    input.taps[20] = nil // One missing Character tap removes two collected entries.
    try learningEventually({ model.learn(input, intended: text, geometry: geometry) }, result: { model.persistenceResult })
    #expect(model.weight == 40)
    try finishLearning(model)
    #expect(TouchModel(url: url).snapshot == model.snapshot)
  }

  @Test(arguments: [41, 64])
  func oversizedPersistentAdmissionChangesNeitherSeedNorFiles(length: Int) throws {
    let directory = try directory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("TouchModel.json")
    let model = TouchModel(url: url)
    try learningEventually({ model.learn(word("as"), intended: "as", geometry: geometry) }, result: { model.persistenceResult })
    try finishLearning(model)
    let snapshot = model.snapshot
    let offsets = model.offsets
    let before = try files(directory)
    let text = String(repeating: "jklm", count: 16).prefix(length)
    #expect(!model.learn(word(String(text)), intended: String(text), geometry: geometry))
    #expect(model.persistenceResult == .invalid)
    #expect(model.snapshot == snapshot)
    #expect(model.offsets == offsets)
    #expect(try files(directory) == before)
    try finishLearning(model)
    #expect(TouchModel(url: url).snapshot == snapshot)
  }

  @Test func rejectionDoesNotAdoptAnotherWritersNewProjection() throws {
    let directory = try directory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let url = directory.appendingPathComponent("TouchModel.json")
    let stale = TouchModel(url: url)
    let writer = TouchModel(url: url)
    try learningEventually({ stale.learn(word("as"), intended: "as", geometry: geometry) }, result: { stale.persistenceResult })
    try finishLearning(stale)
    let snapshot = stale.snapshot
    let offsets = stale.offsets
    try learningEventually({ writer.learn(word("jk"), intended: "jk", geometry: geometry) }, result: { writer.persistenceResult })
    try finishLearning(writer)
    #expect(writer.weight == 4)
    let before = try files(directory)
    let text = String(repeating: "a", count: 41)
    #expect(!stale.learn(word(text), intended: text, geometry: geometry))
    #expect(stale.persistenceResult == .invalid)
    #expect(stale.snapshot == snapshot)
    #expect(stale.offsets == offsets)
    #expect(try files(directory) == before)
    #expect(stale.reloadIfChangedOnDisk())
    #expect(stale.snapshot == writer.snapshot)
  }

  @Test(arguments: [false, true])
  func invalidContributingInputNeverPartiallyTeaches(persistent: Bool) throws {
    let directory = try directory()
    defer { try? FileManager.default.removeItem(at: directory) }
    let model = TouchModel(url: persistent ? directory.appendingPathComponent("TouchModel.json") : nil)
    try learningEventually({ model.learn(word("as"), intended: "as", geometry: geometry) }, result: { model.persistenceResult })
    try finishLearning(model)
    let snapshot = model.snapshot
    let offsets = model.offsets
    let before = try files(directory)
    let invalid: [(TypedWord, String)] = [
      (word(""), ""), (word("a"), "a"), (TypedWord(text: "aaaa"), "aaaa"),
      (word("as"), "asdf"), (TypedWord(text: "---", taps: Array(repeating: KeyPoint(x: 0, y: 0), count: 3)), "---"),
      (TypedWord(text: "asdf", taps: [geometry.center(97), geometry.center(115), geometry.center(100), KeyPoint(x: .nan, y: 0)]), "asdf"),
      (TypedWord(text: "asdf", taps: [geometry.center(97), geometry.center(115), geometry.center(100), KeyPoint(x: 0, y: .infinity)]), "asdf"),
    ]
    for (input, target) in invalid {
      #expect(!model.learn(input, intended: target, geometry: geometry))
      #expect(model.persistenceResult == .invalid)
      #expect(model.snapshot == snapshot)
      #expect(model.offsets == offsets)
      #expect(try files(directory) == before)
    }
    model.isLearning = false
    #expect(!model.learn(word("asdf"), intended: "asdf", geometry: geometry))
    #expect(model.persistenceResult == .invalid)
    #expect(model.snapshot == snapshot)
    #expect(try files(directory) == before)
    try finishLearning(model)
    #expect(model.snapshot == snapshot)
    if !persistent { #expect(try files(directory).isEmpty) }
  }

  @Test func alignmentAndIgnoredTapsKeepExistingNormalizationSemantics() {
    let model = TouchModel(url: nil)
    let a = geometry.center(UInt8(ascii: "a"))!
    let input = TypedWord(text: "á’á-", taps: [a, KeyPoint(x: .nan, y: .nan), a, KeyPoint(x: .infinity, y: 0), KeyPoint(x: .nan, y: .nan)])
    #expect(model.learn(input, intended: "aa-", geometry: geometry))
    #expect(model.weight == 2) // Dropped, nonletter, and extra taps do not contribute.
    #expect(model.learn(word("thw"), intended: "the", geometry: geometry))
    #expect(model.weight == 5) // Same-length corrections need not have equal spelling.
  }
}
