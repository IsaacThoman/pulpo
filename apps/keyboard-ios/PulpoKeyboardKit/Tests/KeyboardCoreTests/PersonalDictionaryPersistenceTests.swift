import Foundation
import Testing
@testable import KeyboardCore

/// Saving off the typing thread must keep learned words exactly as a synchronous
/// save does, and a shared instance must notice another writer.
struct PersonalDictionaryPersistenceTests {
  private func temporaryURL() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent("pk-personal-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("PersonalDictionary.json")
  }

  @Test func backgroundSavesAreVisibleToTheNextLoad() throws {
    let url = try temporaryURL()
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let personal = PersonalDictionary(url: url)
    for round in 0..<20 {
      personal.learn("zorbex\(round)", after: "the")
      personal.learn("zorbex\(round)", after: "the")
      personal.saveInBackground()
    }
    #expect(!personal.hasUnsavedChanges)
    // Loading waits for queued writes.
    let reloaded = PersonalDictionary(url: url)
    #expect((0..<20).allSatisfy { reloaded.isKnown("zorbex\($0)") })
    #expect(reloaded.pairCount("the", "zorbex19") == 2)
    #expect(reloaded.historyCount("the") == 40)
  }

  @Test func backgroundAndSynchronousSavesWriteTheSameFile() throws {
    let first = try temporaryURL(), second = try temporaryURL()
    defer {
      try? FileManager.default.removeItem(at: first.deletingLastPathComponent())
      try? FileManager.default.removeItem(at: second.deletingLastPathComponent())
    }
    let a = PersonalDictionary(url: first), b = PersonalDictionary(url: second)
    for word in ["hello", "there", "hello", "zorbex"] {
      a.learn(word, after: "oh")
      b.learn(word, after: "oh")
    }
    a.forget("there")
    b.forget("there")
    a.save()
    b.saveInBackground()
    let reloadedA = PersonalDictionary(url: first), reloadedB = PersonalDictionary(url: second)
    #expect(reloadedA.knownWords == reloadedB.knownWords)
    #expect(reloadedA.totalCount == reloadedB.totalCount)
    #expect(reloadedA.isBlocked("there") && reloadedB.isBlocked("there"))
    #expect(reloadedA.successors(of: "oh").map(\.word) == reloadedB.successors(of: "oh").map(\.word))
  }

  @Test func reloadsOnlyWhenAnotherWriterReplacedTheFile() throws {
    let url = try temporaryURL()
    defer { try? FileManager.default.removeItem(at: url.deletingLastPathComponent()) }
    let shared = PersonalDictionary(url: url)
    shared.learn("zorbex", after: nil)
    shared.learn("zorbex", after: nil)
    shared.saveInBackground()
    // Its own save is not a change.
    #expect(!shared.reloadIfChangedOnDisk())
    #expect(shared.isKnown("zorbex"))
    // The app clears learned words through its own instance.
    PersonalDictionary(url: url).clear()
    #expect(shared.reloadIfChangedOnDisk())
    #expect(!shared.isKnown("zorbex"))
    #expect(shared.totalCount == 0)
    #expect(!shared.reloadIfChangedOnDisk())
  }
}
