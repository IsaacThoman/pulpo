import Foundation

/// Words and word pairs learned from what the person types. Stored on device only.
public final class PersonalDictionary {
  struct Word: Codable, Equatable, Sendable {
    var count: Int
    var lastUsed: Double
    /// Set when the person explicitly kept the word (reverted an autocorrection
    /// or picked their literal spelling), which makes it valid immediately.
    var pinned: Bool

    init(count: Int, lastUsed: Double, pinned: Bool) {
      self.count = count; self.lastUsed = lastUsed; self.pinned = pinned
    }
    private enum CodingKeys: String, CodingKey { case count, lastUsed, pinned }
    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      count = try values.decode(Int.self, forKey: .count)
      lastUsed = try values.decode(Double.self, forKey: .lastUsed)
      pinned = try values.decodeIfPresent(Bool.self, forKey: .pinned) ?? false
    }
  }

  struct Snapshot: Codable, Equatable, Sendable {
    var version = 1
    var pairEncoding = 1
    var words: [String: Word] = [:]
    var pairs: [String: Int] = [:]
    var blocked: [String] = []

    init(version: Int = 1, pairEncoding: Int = 1, words: [String: Word] = [:], pairs: [String: Int] = [:], blocked: [String] = []) {
      self.version = version; self.pairEncoding = pairEncoding; self.words = words; self.pairs = pairs; self.blocked = blocked
    }
    private enum CodingKeys: String, CodingKey { case version, pairEncoding, words, pairs, blocked }
    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      version = try values.decodeIfPresent(Int.self, forKey: .version) ?? 1
      pairEncoding = try values.decodeIfPresent(Int.self, forKey: .pairEncoding) ?? 1
      words = try values.decode([String: Word].self, forKey: .words)
      pairs = try values.decodeIfPresent([String: Int].self, forKey: .pairs) ?? [:]
      blocked = try values.decodeIfPresent([String].self, forKey: .blocked) ?? []
    }
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
  private var persistence: LearningSession?
  public private(set) var persistenceResult: LearningPersistenceResult = .ok
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
    load()
  }

  private func load() {
    guard let url else { return }
    persistence = LearningSession(url: url, kind: .dictionary)
    reloadIfChangedOnDisk()
  }

  var snapshot: Snapshot { Snapshot(pairEncoding: 4, words: words, pairs: pairs, blocked: Array(blocked).sorted()) }

  private func adopt(_ value: LearningPayload?) -> Bool {
    guard case let .dictionary(snapshot) = value else { return false }
    guard snapshot != self.snapshot else { return false }
    if snapshot.pairEncoding == 4 {
      pairs = snapshot.pairs
    } else {
      guard let converted = try? Self.canonicalPairs(snapshot.pairs, encoding: snapshot.pairEncoding) else { return false }
      pairs = converted
    }
    words = snapshot.words
    blocked = Set(snapshot.blocked)
    blockedKeys = Set(snapshot.blocked.map(TextNormalizer.key))
    rebuildIndexes()
    return true
  }

  /// Escape only ASCII backslash and the component separator, preserving Swift
  /// String canonical equality without storing a runtime's grapheme count. The
  /// parser covers memory histories too; durable limits belong at admission.
  static func pairKey(_ history: String, _ target: String) -> String {
    func needsEscape(_ value: String) -> Bool { value.utf8.contains { $0 == 92 || $0 == 31 } }
    if !needsEscape(history) && !needsEscape(target) { return history + "\u{1F}" + target }
    var bytes: [UInt8] = []
    func append(_ value: String) {
      for byte in value.utf8 {
        if byte == 92 || byte == 31 { bytes.append(92) }
        bytes.append(byte)
      }
    }
    append(history); bytes.append(31); append(target)
    return String(decoding: bytes, as: UTF8.self)
  }
  static func splitPair(_ key: String, encoding: Int) -> (history: String, target: String)? {
    let bytes = key.utf8
    if encoding == 1 {
      let parts = key.split(separator: "\u{1F}", maxSplits: 1, omittingEmptySubsequences: false)
      guard parts.count == 2 else { return nil }
      return (String(parts[0]), String(parts[1]))
    }
    if encoding == 2 {
      guard let colon = bytes.firstIndex(of: 58) else { return nil }
      let text = String(decoding: bytes[..<colon], as: UTF8.self)
      guard !text.isEmpty, text.count <= 3, let length = Int(text),
            text == String(length), length >= 0, length <= 256 else { return nil }
      let start = bytes.index(after: colon)
      guard let end = bytes.index(start, offsetBy: length, limitedBy: bytes.endIndex),
            let history = String(bytes: bytes[start..<end], encoding: .utf8),
            let target = String(bytes: bytes[end...], encoding: .utf8) else { return nil }
      return (history, target)
    }
    // Encoding 3 was a rejected, unshipped development format. Its unversioned
    // Character count cannot safely identify components after Unicode changes.
    // Never guess a split or silently discard these preserved invalid bytes.
    guard encoding == 4 else { return nil }
    if !bytes.contains(92) {
      guard let separator = bytes.firstIndex(of: 31) else { return nil }
      let next = bytes.index(after: separator)
      guard !bytes[next...].contains(31),
            let history = String(bytes: bytes[..<separator], encoding: .utf8),
            let target = String(bytes: bytes[next...], encoding: .utf8) else { return nil }
      return (history, target)
    }
    var fields: [[UInt8]] = [[]]
    var escaped = false
    for byte in bytes {
      if escaped {
        guard byte == 92 || byte == 31 else { return nil }
        fields[fields.count - 1].append(byte); escaped = false
      } else if byte == 92 { escaped = true }
      else if byte == 31 {
        guard fields.count == 1 else { return nil }
        fields.append([])
      } else { fields[fields.count - 1].append(byte) }
    }
    guard !escaped, fields.count == 2,
          let history = String(bytes: fields[0], encoding: .utf8),
          let target = String(bytes: fields[1], encoding: .utf8) else { return nil }
    return (history, target)
  }

  static func canonicalPairs(_ pairs: [String: Int], encoding: Int) throws -> [String: Int] {
    var converted: [String: Int] = [:]
    for (key, count) in pairs {
      guard let parts = splitPair(key, encoding: encoding) else { throw LearningPersistenceResult.invalid }
      let next = pairKey(parts.history, parts.target)
      let sum = converted[next, default: 0].addingReportingOverflow(count)
      guard !sum.overflow else { throw LearningPersistenceResult.invalid }
      converted[next] = sum.partialValue
    }
    return converted
  }

  static func pruningLegacy(_ snapshot: Snapshot) -> Snapshot {
    let model = PersonalDictionary(url: nil)
    _ = model.adopt(.dictionary(snapshot))
    if snapshot.words.count > maximumWords || snapshot.pairs.count > maximumPairs { model.prune() }
    return model.snapshot
  }

  static func applying(_ operations: [LearningMutation], to snapshot: Snapshot) throws -> Snapshot {
    let model = PersonalDictionary(url: nil)
    _ = model.adopt(.dictionary(snapshot))
    for operation in operations {
      switch operation {
      case let .learn(word, previous, pinned, time):
        guard model.totalCount < Int.max, model.count(of: word) < Int.max else { throw LearningPersistenceResult.capacity }
        if let previous, !previous.isEmpty {
          guard model.pairCount(previous, word) < Int.max, model.historyCount(previous) < Int.max else { throw LearningPersistenceResult.capacity }
        }
        model.learnLocally(word, after: previous, pinned: pinned, time: time)
      case let .pin(word, time):
        guard model.words[word] != nil || model.totalCount < Int.max else { throw LearningPersistenceResult.capacity }
        model.pinLocally(word, time: time)
      default: break
      }
    }
    return model.snapshot
  }

  static func forgetting(_ word: String, in snapshot: Snapshot) -> Snapshot {
    let model = PersonalDictionary(url: nil)
    _ = model.adopt(.dictionary(snapshot))
    model.forgetLocally(word)
    return model.snapshot
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
      if let parts = Self.splitPair(pair, encoding: 4) { successors[parts.history, default: [:]][parts.target] = count }
    }
    rebuildHistoryTotals()
  }

  private func rebuildHistoryTotals() {
    historyTotals = successors.mapValues { $0.values.reduce(0, +) }
  }

  // MARK: Learning

  @discardableResult
  public func learn(_ word: String, after previous: String?, pinned: Bool = false) -> Bool {
    guard !word.isEmpty, word.count <= 40 else { persistenceResult = .invalid; return false }
    let time = Date().timeIntervalSince1970
    if let persistence {
      let outcome = persistence.admit(.learn(word, previous, pinned, time))
      persistenceResult = outcome.result
      guard outcome.result == .ok else { return false }
      _ = adopt(outcome.payload)
    }
    learnLocally(word, after: previous, pinned: pinned, time: time)
    persistenceResult = .ok
    return true
  }

  private func learnLocally(_ word: String, after previous: String?, pinned: Bool, time: Double) {
    // `knownEntries` lists exactly the known words, so it stays valid unless this changes.
    let wasKnown = isKnown(word)
    let learnedKey = TextNormalizer.key(word)
    let now = time
    if var entry = words[word] {
      entry.count += 1
      entry.lastUsed = now
      entry.pinned = entry.pinned || pinned
      words[word] = entry
    } else {
      words[word] = Word(count: 1, lastUsed: now, pinned: pinned)
      byKey[learnedKey, default: []].append(word)
      // Once-used words are offered as completions before they become known.
      usedCache = nil
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
      pairs[Self.pairKey(history, word), default: 0] += 1
      successors[history, default: [:]][word, default: 0] += 1
      historyTotals[history, default: 0] += 1
    }
    dirty = true
    if words.count > Self.maximumWords || pairs.count > Self.maximumPairs { prune() }
  }

  @discardableResult
  public func pin(_ word: String) -> Bool {
    guard !word.isEmpty, word.count <= 40 else { persistenceResult = .invalid; return false }
    let time = Date().timeIntervalSince1970
    if let persistence {
      let outcome = persistence.admit(.pin(word, time))
      persistenceResult = outcome.result
      guard outcome.result == .ok else { return false }
      _ = adopt(outcome.payload)
    }
    pinLocally(word, time: time)
    persistenceResult = .ok
    return true
  }

  private func pinLocally(_ word: String, time: Double) {
    if words[word] == nil {
      learnLocally(word, after: nil, pinned: true, time: time)
    } else {
      let wasKnown = isKnown(word)
      words[word]?.pinned = true
      if isKnown(word) != wasKnown { knownCache = nil }
      dirty = true
    }
  }

  /// Removes a learned word and hides it from suggestions, including dictionary words.
  @discardableResult
  public func forget(_ word: String) -> Bool {
    if let persistence {
      let outcome = persistence.forget(word)
      persistenceResult = outcome.result
      if outcome.result == .ok { _ = adopt(outcome.payload) }
      return outcome.result == .ok
    }
    forgetLocally(word)
    persistenceResult = .ok
    return true
  }

  private func forgetLocally(_ word: String) {
    knownCache = nil
    let key = TextNormalizer.key(word)
    let forms = byKey.removeValue(forKey: key) ?? []
    for form in forms {
      if let entry = words.removeValue(forKey: form) { totalCount -= entry.count }
    }
    pairs = pairs.filter { pair, _ in
      let target = Self.splitPair(pair, encoding: 4)?.target ?? ""
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

  @discardableResult
  public func clear() -> Bool {
    if let persistence {
      let outcome = persistence.clear()
      persistenceResult = outcome.result
      if outcome.result == .ok || outcome.result == .cleanup { _ = adopt(outcome.payload) }
      return outcome.result == .ok
    }
    words = [:]
    pairs = [:]
    blocked = []
    blockedKeys = []
    rebuildIndexes()
    dirty = true
    persistenceResult = .ok
    return true
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
      // Preserve the legacy tie order; ordinary unescaped keys already are
      // that exact string. Decode exceptional keys once, outside comparisons.
      let ranked = pairs.map { pair in
        let order: String
        if pair.key.utf8.contains(92) {
          let parts = Self.splitPair(pair.key, encoding: 4)!
          order = parts.history + "\u{1F}" + parts.target
        } else { order = pair.key }
        return (key: pair.key, value: pair.value, order: order)
      }.sorted {
        if $0.value != $1.value { return $0.value > $1.value }
        return $0.order != $1.order ? $0.order < $1.order : $0.key < $1.key
      }
      for entry in ranked[pairLimit...] {
        let pair = entry.key, count = entry.value
        pairs.removeValue(forKey: pair)
        guard let parts = Self.splitPair(pair, encoding: 4) else { continue }
        let history = parts.history
        successors[history]?.removeValue(forKey: parts.target)
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

  struct FileStamp: Equatable, Sendable {
    let device: Int64
    let inode: UInt64
    let size: Int64
    let modified: Int64
    let modifiedNanoseconds: Int

    init?(url: URL) {
      var info = stat()
      guard stat(url.path, &info) == 0 else { return nil }
      device = Int64(info.st_dev)
      inode = UInt64(info.st_ino)
      size = Int64(info.st_size)
      modified = Int64(info.st_mtimespec.tv_sec)
      modifiedNanoseconds = Int(info.st_mtimespec.tv_nsec)
    }
  }

  @discardableResult
  public func save() -> Bool {
    guard let persistence else { persistenceResult = .ok; return true }
    let outcome = persistence.save()
    persistenceResult = outcome.result
    if outcome.result == .ok { _ = adopt(outcome.payload); dirty = false }
    return outcome.result == .ok
  }

  public func saveInBackground() {
    persistence?.saveInBackground()
  }

  /// Observation occurs at ownership/word boundaries, never on query/letter paths.
  @discardableResult
  public func reloadIfChangedOnDisk() -> Bool {
    guard let persistence else { persistenceResult = .ok; return false }
    let outcome = persistence.observe()
    persistenceResult = outcome.result
    guard outcome.result == .ok else { return false }
    return adopt(outcome.payload)
  }

  public var hasUnsavedChanges: Bool { persistence?.hasUnsavedChanges ?? dirty }
}
