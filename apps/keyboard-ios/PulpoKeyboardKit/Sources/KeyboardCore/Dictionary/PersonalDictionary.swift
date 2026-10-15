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
  /// The sum of each history's successor counts. The language model reads it for
  /// every candidate it scores, including thousands per swipe.
  private var historyTotals: [String: Int] = [:]
  private var blocked: Set<String> = []
  private var blockedKeys: Set<String> = []
  private var byKey: [String: [String]] = [:]
  private(set) public var totalCount = 0
  private var dirty = false
  private let url: URL?
  /// Names and other words that are valid but never persisted (contacts, text replacements).
  private var transientWords: Set<String> = []
  private var transientByKey: [String: [String]] = [:]
  struct KnownWord {
    var text: String
    var key: String
  }
  private var knownCache: [KnownWord]? {
    didSet { if knownCache == nil { usedCache = nil } }
  }
  private var usedCache: [KnownWord]?

  public init(url: URL?) {
    self.url = url
    guard let url, let data = try? Data(contentsOf: url),
          let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else { return }
    words = snapshot.words
    pairs = snapshot.pairs
    blocked = Set(snapshot.blocked)
    blockedKeys = Set(snapshot.blocked.map(TextNormalizer.key))
    rebuildIndexes()
  }

  private func rebuildIndexes() {
    knownCache = nil
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
    rebuildHistoryTotals()
  }

  private func rebuildHistoryTotals() {
    historyTotals = successors.mapValues { $0.values.reduce(0, +) }
  }

  // MARK: Learning

  public func learn(_ word: String, after previous: String?, pinned: Bool = false) {
    guard !word.isEmpty, word.count <= 40 else { return }
    // `knownEntries` lists exactly the known words, so it stays valid unless this changes.
    let wasKnown = isKnown(word)
    let learnedKey = TextNormalizer.key(word)
    let now = Date().timeIntervalSince1970
    if var entry = words[word] {
      entry.count += 1
      entry.lastUsed = now
      entry.pinned = entry.pinned || pinned
      words[word] = entry
    } else {
      words[word] = Word(count: 1, lastUsed: now, pinned: pinned)
      byKey[learnedKey, default: []].append(word)
    }
    // Repeating a known word, the usual case, leaves the fuzzy-match index valid.
    if isKnown(word) != wasKnown { knownCache = nil }
    totalCount += 1
    // `blockedKeys` holds exactly the keys of `blocked`.
    if blockedKeys.remove(learnedKey) != nil {
      blocked = blocked.filter { TextNormalizer.key($0) != learnedKey }
    }
    if let previous, !previous.isEmpty {
      let history = previous.lowercased()
      pairs[history + "\u{1F}" + word, default: 0] += 1
      successors[history, default: [:]][word, default: 0] += 1
      historyTotals[history, default: 0] += 1
    }
    dirty = true
    if words.count > Self.maximumWords || pairs.count > Self.maximumPairs { prune() }
  }

  public func pin(_ word: String) {
    if words[word] == nil {
      learn(word, after: nil, pinned: true)
    } else {
      let wasKnown = isKnown(word)
      words[word]?.pinned = true
      if isKnown(word) != wasKnown { knownCache = nil }
      dirty = true
    }
  }

  /// Removes a learned word and hides it from suggestions, including dictionary words.
  public func forget(_ word: String) {
    knownCache = nil
    let key = TextNormalizer.key(word)
    let forms = byKey.removeValue(forKey: key) ?? []
    for form in forms {
      if let entry = words.removeValue(forKey: form) { totalCount -= entry.count }
    }
    pairs = pairs.filter { pair, _ in
      let target = pair.split(separator: "\u{1F}", maxSplits: 1).last.map(String.init) ?? ""
      return TextNormalizer.key(target) != key
    }
    for history in successors.keys {
      successors[history] = successors[history]?.filter { TextNormalizer.key($0.key) != key }
    }
    rebuildHistoryTotals()
    blocked.insert(word)
    blockedKeys.insert(key)
    dirty = true
  }

  public func clear() {
    words = [:]
    pairs = [:]
    blocked = []
    blockedKeys = []
    rebuildIndexes()
    dirty = true
    save()
  }

  private func prune() {
    // One reference time keeps the ordering consistent while sorting; equal
    // scores and counts fall back to the text, independent of hashing order.
    let now = Date().timeIntervalSince1970
    // This runs on the typing thread when a new word passes the limit. Remove the
    // evicted entries from the indexes instead of rebuilding them from scratch.
    let wordLimit = Self.maximumWords * 9 / 10
    if words.count > wordLimit {
      let ranked = words.map { (word: $0.key, entry: $0.value, score: Self.score($0.value, now: now)) }
        .sorted { $0.score != $1.score ? $0.score > $1.score : $0.word < $1.word }
      for evicted in ranked[wordLimit...] {
        words.removeValue(forKey: evicted.word)
        totalCount -= evicted.entry.count
        let key = TextNormalizer.key(evicted.word)
        if var forms = byKey[key] {
          forms.removeAll { $0 == evicted.word }
          byKey[key] = forms.isEmpty ? nil : forms
        }
      }
      knownCache = nil
    }
    let pairLimit = Self.maximumPairs * 9 / 10
    if pairs.count > pairLimit {
      let ranked = pairs.sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
      for (pair, count) in ranked[pairLimit...] {
        pairs.removeValue(forKey: pair)
        let parts = pair.split(separator: "\u{1F}", maxSplits: 1)
        guard parts.count == 2 else { continue }
        let history = String(parts[0])
        successors[history]?.removeValue(forKey: String(parts[1]))
        if successors[history]?.isEmpty == true {
          successors.removeValue(forKey: history)
          historyTotals.removeValue(forKey: history)
        } else {
          historyTotals[history, default: 0] -= count
        }
      }
    }
  }

  private static func score(_ word: Word, now: Double) -> Double {
    let ageDays = (now - word.lastUsed) / 86_400
    return Double(word.count) * (word.pinned ? 4 : 1) / (1 + ageDays / 30)
  }

  // MARK: Queries

  /// A learned word counts as valid once it was typed twice or explicitly kept.
  public func isKnown(_ word: String) -> Bool {
    if transientWords.contains(word) { return true }
    guard let entry = words[word] else { return false }
    return entry.pinned || entry.count >= 2
  }

  public func isBlocked(_ word: String) -> Bool {
    !blockedKeys.isEmpty && blockedKeys.contains(TextNormalizer.key(word))
  }

  public func count(of word: String) -> Int { words[word]?.count ?? 0 }

  public func pairCount(_ previous: String, _ word: String) -> Int {
    successors[previous.lowercased()]?[word] ?? 0
  }

  public func historyCount(_ previous: String) -> Int {
    historyTotals[previous.lowercased()] ?? 0
  }

  /// Most frequent first. Equal counts are ordered by word, so predictions do not
  /// depend on the process's dictionary hashing order.
  public func successors(of previous: String) -> [(word: String, count: Int)] {
    (successors[previous.lowercased()] ?? [:]).map { ($0.key, $0.value) }
      .sorted { $0.count != $1.count ? $0.count > $1.count : $0.word < $1.word }
  }

  /// The first `limit` of `successors(of:)`, without sorting every successor of a
  /// frequent history on each prediction pass.
  public func successors(of previous: String, limit: Int) -> [(word: String, count: Int)] {
    guard limit > 0, let table = successors[previous.lowercased()] else { return [] }
    var top: [(word: String, count: Int)] = []
    top.reserveCapacity(limit + 1)
    for (word, count) in table {
      func precedes(_ other: (word: String, count: Int)) -> Bool {
        count != other.count ? count > other.count : word < other.word
      }
      if top.count == limit, let last = top.last, !precedes(last) { continue }
      top.insert((word, count), at: top.firstIndex { precedes($0) } ?? top.count)
      if top.count > limit { top.removeLast() }
    }
    return top
  }

  /// Known personal and transient words with the same lookup key.
  public func words(forKey key: String) -> [String] {
    (byKey[key] ?? []).filter(isKnown) + (transientByKey[key] ?? [])
  }

  /// Every known word, for fuzzy matching. Bounded by `maximumWords`.
  public var knownWords: [String] {
    knownEntries.map(\.text)
  }

  /// Normalized forms are indexed when learned, rather than decomposed thousands
  /// of times on every keystroke. The cache is invalidated by vocabulary changes.
  var knownEntries: [KnownWord] {
    if let knownCache { return knownCache }
    var entries: [KnownWord] = []
    var seen = Set<String>()
    for (key, forms) in byKey {
      for word in forms where isKnown(word) && seen.insert(word).inserted {
        entries.append(KnownWord(text: word, key: key))
      }
    }
    for (key, forms) in transientByKey {
      for word in forms where seen.insert(word).inserted { entries.append(KnownWord(text: word, key: key)) }
    }
    entries.sort { $0.text < $1.text }
    knownCache = entries
    return entries
  }

  /// Every learned spelling, including words typed only once. These are not
  /// valid literals until `isKnown`; callers may still offer them as completions.
  var usedEntries: [KnownWord] {
    if let usedCache { return usedCache }
    let entries = byKey.flatMap { key, forms in forms.map { KnownWord(text: $0, key: key) } }.sorted { $0.text < $1.text }
    usedCache = entries
    return entries
  }

  public func setTransientWords(_ list: [String]) {
    knownCache = nil
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
