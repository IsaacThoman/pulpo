import Foundation

/// Words and word pairs learned from what the person types. Stored on device only.
public final class PersonalDictionary {
  struct Word: Codable {
    var count: Int
    var lastUsed: Double
    /// Set when the person explicitly kept the word (reverted an autocorrection
    /// or picked their literal spelling), which makes it valid immediately.
    var pinned: Bool
  }

  struct Snapshot: Codable {
    var version = 1
    var words: [String: Word] = [:]
    var pairs: [String: Int] = [:]
    var blocked: [String] = []
  }

  public static let maximumWords = 5_000
  public static let maximumPairs = 20_000

  private var words: [String: Word] = [:]
  private var pairs: [String: Int] = [:]
  private var successors: [String: [String: Int]] = [:]
  private var blocked: Set<String> = []
  private var byKey: [String: [String]] = [:]
  private(set) public var totalCount = 0
  private var dirty = false
  private let url: URL?
  /// Names and other words that are valid but never persisted (contacts, text replacements).
  private var transientWords: Set<String> = []
  private var transientByKey: [String: [String]] = [:]

  public init(url: URL?) {
    self.url = url
    guard let url, let data = try? Data(contentsOf: url),
          let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
    words = snapshot.words
    pairs = snapshot.pairs
    blocked = Set(snapshot.blocked)
    rebuildIndexes()
  }

  private func rebuildIndexes() {
    byKey = [:]
    totalCount = 0
    for (word, entry) in words {
      byKey[TextNormalizer.key(word), default: []].append(word)
      totalCount += entry.count
    }
    successors = [:]
    for (pair, count) in pairs {
      let parts = pair.split(separator: "\u{1F}", maxSplits: 1)
      if parts.count == 2 { successors[String(parts[0]), default: [:]][String(parts[1])] = count }
    }
  }

  // MARK: Learning

  public func learn(_ word: String, after previous: String?, pinned: Bool = false) {
    guard !word.isEmpty, word.count <= 40 else { return }
    let now = Date().timeIntervalSince1970
    if var entry = words[word] {
      entry.count += 1
      entry.lastUsed = now
      entry.pinned = entry.pinned || pinned
      words[word] = entry
    } else {
      words[word] = Word(count: 1, lastUsed: now, pinned: pinned)
      byKey[TextNormalizer.key(word), default: []].append(word)
    }
    totalCount += 1
    blocked.remove(word)
    if let previous, !previous.isEmpty {
      let history = previous.lowercased()
      pairs[history + "\u{1F}" + word, default: 0] += 1
      successors[history, default: [:]][word, default: 0] += 1
    }
    dirty = true
    if words.count > Self.maximumWords || pairs.count > Self.maximumPairs { prune() }
  }

  public func pin(_ word: String) {
    if words[word] == nil {
      learn(word, after: nil, pinned: true)
    } else {
      words[word]?.pinned = true
      dirty = true
    }
  }

  /// Removes a learned word and hides it from suggestions, including dictionary words.
  public func forget(_ word: String) {
    if let entry = words.removeValue(forKey: word) {
      totalCount -= entry.count
      let key = TextNormalizer.key(word)
      byKey[key]?.removeAll { $0 == word }
    }
    pairs = pairs.filter { !$0.key.hasSuffix("\u{1F}" + word) }
    for history in successors.keys { successors[history]?.removeValue(forKey: word) }
    blocked.insert(word)
    dirty = true
  }

  public func clear() {
    words = [:]
    pairs = [:]
    blocked = []
    rebuildIndexes()
    dirty = true
    save()
  }

  private func prune() {
    let keptWords = words.sorted { score($0.value) > score($1.value) }.prefix(Self.maximumWords * 9 / 10)
    words = Dictionary(uniqueKeysWithValues: keptWords.map { ($0.key, $0.value) })
    let keptPairs = pairs.sorted { $0.value > $1.value }.prefix(Self.maximumPairs * 9 / 10)
    pairs = Dictionary(uniqueKeysWithValues: keptPairs.map { ($0.key, $0.value) })
    rebuildIndexes()
  }

  private func score(_ word: Word) -> Double {
    let ageDays = (Date().timeIntervalSince1970 - word.lastUsed) / 86_400
    return Double(word.count) * (word.pinned ? 4 : 1) / (1 + ageDays / 30)
  }

  // MARK: Queries

  /// A learned word counts as valid once it was typed twice or explicitly kept.
  public func isKnown(_ word: String) -> Bool {
    if transientWords.contains(word) { return true }
    guard let entry = words[word] else { return false }
    return entry.pinned || entry.count >= 2
  }

  public func isBlocked(_ word: String) -> Bool { blocked.contains(word) }

  public func count(of word: String) -> Int { words[word]?.count ?? 0 }

  public func pairCount(_ previous: String, _ word: String) -> Int {
    successors[previous.lowercased()]?[word] ?? 0
  }

  public func historyCount(_ previous: String) -> Int {
    successors[previous.lowercased()]?.values.reduce(0, +) ?? 0
  }

  public func successors(of previous: String) -> [(word: String, count: Int)] {
    (successors[previous.lowercased()] ?? [:]).map { ($0.key, $0.value) }.sorted { $0.count > $1.count }
  }

  /// Known personal and transient words with the same lookup key.
  public func words(forKey key: String) -> [String] {
    (byKey[key] ?? []).filter(isKnown) + (transientByKey[key] ?? [])
  }

  /// Every known word, for fuzzy matching. Bounded by `maximumWords`.
  public var knownWords: [String] {
    words.keys.filter(isKnown) + transientWords.filter { words[$0] == nil }
  }

  public func setTransientWords(_ list: [String]) {
    transientWords = Set(list.filter { !$0.isEmpty && !$0.contains(" ") })
    transientByKey = Dictionary(grouping: transientWords, by: TextNormalizer.key)
  }

  // MARK: Persistence

  public func save() {
    guard dirty, let url else { return }
    let snapshot = Snapshot(words: words, pairs: pairs, blocked: Array(blocked))
    do {
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try JSONEncoder().encode(snapshot).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      dirty = false
    } catch {
      // Learning is best effort; a later save retries.
    }
  }

  public var hasUnsavedChanges: Bool { dirty }
}
