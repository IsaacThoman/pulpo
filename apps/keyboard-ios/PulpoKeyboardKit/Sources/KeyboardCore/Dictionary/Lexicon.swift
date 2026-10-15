import Foundation

public struct WordFlags: OptionSet, Sendable {
  public let rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }
  public static let neverSuggest = WordFlags(rawValue: 1 << 0)
  public static let glide = WordFlags(rawValue: 1 << 1)
  public static let capitalized = WordFlags(rawValue: 1 << 2)
  public static let abbreviation = WordFlags(rawValue: 1 << 3)
  public static let informal = WordFlags(rawValue: 1 << 4)
  /// AOSP spelling-error entries carry shortcuts; they are never valid literals.
  public static let notAWord = WordFlags(rawValue: 1 << 5)
}

/// One node of the key trie. Every node owns the contiguous word range `lo..<hi`
/// of keys sharing its prefix; words whose key ends here come first.
public struct TrieNode: Sendable {
  public let index: Int
  public let firstChild: Int
  public let lo: Int
  public let hi: Int
  public let byte: UInt8
  public let childCount: Int
  public let terminalCount: Int
  public let maxFrequency: UInt8

  public var children: Range<Int> { firstChild..<(firstChild + childCount) }
  public var terminals: Range<Int> { lo..<(lo + terminalCount) }
}

/// The compiled `.pkdict` dictionary produced by `scripts/build_language_data.py`.
public final class Lexicon: @unchecked Sendable {
  public let wordCount: Int
  public let shortcuts: [String: String]
  let unigramIntercept: Double
  let unigramSlope: Double
  let bigramQuant: Double

  private let file: MappedFile
  private let keyBytes: UnsafeRawPointer
  private let keyOffsets: MappedArray<UInt32>
  private let displayIDs: MappedArray<UInt32>
  private let displayBytes: UnsafeRawPointer
  private let displayOffsets: MappedArray<UInt32>
  private let frequencies: MappedArray<UInt8>
  private let wordFlags: MappedArray<UInt8>
  /// Accepted spellings without word IDs or language-model priors.
  private let supplementalLiterals: Set<String>
  private let trie: UnsafeRawPointer
  let nodeCount: Int
  private let glideOffsets: MappedArray<UInt32>
  private let glideIDs: MappedArray<UInt32>
  private let bigramOffsets: MappedArray<UInt32>
  private let bigramIDs: MappedArray<UInt32>
  private let bigramScores: MappedArray<UInt8>
  private let bigramBackoffs: MappedArray<UInt8>
  private let trigramHistories: MappedArray<UInt64>?
  private let trigramOffsets: MappedArray<UInt32>?
  private let trigramIDs: MappedArray<UInt32>?
  private let trigramScores: MappedArray<UInt8>?
  private let trigramWeights: MappedArray<UInt8>?
  /// exp(-score / quant) for every quantized log-probability byte.
  private let probabilityOfScore: [Double]
  /// Unigram probability for every frequency byte.
  private let unigramProbability: [Double]
  private let omissionLock = NSLock()
  private var trigramOmissions: [Int: (factor: Double, weakest: Double)] = [:]

  public enum LoadError: Error { case badHeader, missingSection(String), badMetadata }

  public convenience init(url: URL) throws {
    try self.init(file: MappedFile(url: url))
  }

  init(file: MappedFile) throws {
    self.file = file
    let base = file.base
    guard file.count > 12, String(decoding: UnsafeRawBufferPointer(start: base, count: 4), as: UTF8.self) == "PKD1" else {
      throw LoadError.badHeader
    }
    let sectionCount = Int(base.loadUnaligned(fromByteOffset: 8, as: UInt32.self))
    var sections: [String: (UnsafeRawPointer, Int)] = [:]
    for index in 0..<sectionCount {
      let entry = 12 + index * 20
      let tag = String(decoding: UnsafeRawBufferPointer(start: base + entry, count: 4), as: UTF8.self)
      let offset = Int(base.loadUnaligned(fromByteOffset: entry + 4, as: UInt64.self))
      let length = Int(base.loadUnaligned(fromByteOffset: entry + 12, as: UInt64.self))
      guard offset + length <= file.count else { throw LoadError.badHeader }
      sections[tag] = (base + offset, length)
    }
    func section(_ tag: String) throws -> (UnsafeRawPointer, Int) {
      guard let value = sections[tag] else { throw LoadError.missingSection(tag) }
      return value
    }
    let meta = try section("META")
    let metaData = Data(bytes: meta.0, count: meta.1)
    guard let json = try JSONSerialization.jsonObject(with: metaData) as? [String: Any],
          let count = json["wordCount"] as? Int,
          let intercept = json["unigramIntercept"] as? Double,
          let slope = json["unigramSlope"] as? Double,
          let quant = json["bigramQuant"] as? Double else { throw LoadError.badMetadata }
    wordCount = count
    unigramIntercept = intercept
    unigramSlope = slope
    bigramQuant = quant
    probabilityOfScore = (0..<256).map { exp(-Double($0) / quant) }
    unigramProbability = (0..<256).map { exp(intercept + slope * Double($0)) }

    keyBytes = try section("WKEY").0
    let keyOffsetSection = try section("WKOF")
    keyOffsets = MappedArray(base: keyOffsetSection.0, byteCount: keyOffsetSection.1)
    let displayIDSection = try section("DSID")
    displayIDs = MappedArray(base: displayIDSection.0, byteCount: displayIDSection.1)
    displayBytes = try section("DSTX").0
    let displayOffsetSection = try section("DSOF")
    displayOffsets = MappedArray(base: displayOffsetSection.0, byteCount: displayOffsetSection.1)
    let frequencySection = try section("WFRQ")
    frequencies = MappedArray(base: frequencySection.0, byteCount: frequencySection.1)
    let flagSection = try section("WFLG")
    wordFlags = MappedArray(base: flagSection.0, byteCount: flagSection.1)
    if let literals = sections["VWRD"] {
      let text = String(decoding: UnsafeRawBufferPointer(start: literals.0, count: literals.1), as: UTF8.self)
      supplementalLiterals = Set(text.split(separator: "\n").map(String.init))
    } else {
      supplementalLiterals = []
    }
    let trieSection = try section("TRIE")
    trie = trieSection.0
    nodeCount = trieSection.1 / 16
    let glideOffsetSection = try section("GLOF")
    glideOffsets = MappedArray(base: glideOffsetSection.0, byteCount: glideOffsetSection.1)
    let glideIDSection = try section("GLID")
    glideIDs = MappedArray(base: glideIDSection.0, byteCount: glideIDSection.1)
    let bigramOffsetSection = try section("BGOF")
    bigramOffsets = MappedArray(base: bigramOffsetSection.0, byteCount: bigramOffsetSection.1)
    let bigramIDSection = try section("BGID")
    bigramIDs = MappedArray(base: bigramIDSection.0, byteCount: bigramIDSection.1)
    let bigramScoreSection = try section("BGSC")
    bigramScores = MappedArray(base: bigramScoreSection.0, byteCount: bigramScoreSection.1)
    let backoffSection = try section("BGBO")
    bigramBackoffs = MappedArray(base: backoffSection.0, byteCount: backoffSection.1)
    // Optional sections keep dictionaries built before trigram support readable.
    trigramHistories = sections["TGHI"].map { MappedArray(base: $0.0, byteCount: $0.1) }
    trigramOffsets = sections["TGOF"].map { MappedArray(base: $0.0, byteCount: $0.1) }
    trigramIDs = sections["TGID"].map { MappedArray(base: $0.0, byteCount: $0.1) }
    trigramScores = sections["TGSC"].map { MappedArray(base: $0.0, byteCount: $0.1) }
    trigramWeights = sections["TGWT"].map { MappedArray(base: $0.0, byteCount: $0.1) }
    if let histories = trigramHistories {
      guard let offsets = trigramOffsets, let ids = trigramIDs, let scores = trigramScores, let weights = trigramWeights,
            offsets.count == histories.count + 1, weights.count == histories.count,
            ids.count == scores.count, Int(offsets[offsets.count - 1]) == ids.count else { throw LoadError.badHeader }
    }

    let shortcutSection = try section("SHRT")
    var table: [String: String] = [:]
    for line in String(decoding: UnsafeRawBufferPointer(start: shortcutSection.0, count: shortcutSection.1), as: UTF8.self).split(separator: "\n") {
      let parts = line.split(separator: "\t", maxSplits: 1)
      if parts.count == 2 { table[String(parts[0])] = String(parts[1]) }
    }
    shortcuts = table
    guard keyOffsets.count == wordCount + 1, frequencies.count >= wordCount, bigramOffsets.count == wordCount + 2 else {
      throw LoadError.badHeader
    }
  }

  // MARK: Words

  @inline(__always) public func keyLength(_ id: Int) -> Int {
    Int(keyOffsets[id + 1] &- keyOffsets[id])
  }

  @inline(__always) public func keyByte(_ id: Int, _ position: Int) -> UInt8 {
    keyBytes.load(fromByteOffset: Int(keyOffsets[id]) + position, as: UInt8.self)
  }

  public func key(_ id: Int) -> String {
    let start = Int(keyOffsets[id])
    return String(decoding: UnsafeRawBufferPointer(start: keyBytes + start, count: keyLength(id)), as: UTF8.self)
  }

  public func display(_ id: Int) -> String {
    var low = 0
    var high = displayIDs.count
    let target = UInt32(id)
    while low < high {
      let mid = (low + high) / 2
      if displayIDs[mid] < target { low = mid + 1 } else { high = mid }
    }
    if low < displayIDs.count, displayIDs[low] == target {
      let start = Int(displayOffsets[low])
      let end = Int(displayOffsets[low + 1])
      return String(decoding: UnsafeRawBufferPointer(start: displayBytes + start, count: end - start), as: UTF8.self)
    }
    return key(id)
  }

  @inline(__always) public func frequency(_ id: Int) -> UInt8 { frequencies[id] }
  @inline(__always) public func flags(_ id: Int) -> WordFlags { WordFlags(rawValue: wordFlags[id]) }

  /// Uses the spelling itself, preserving apostrophes rather than normalized trie keys.
  public func isSupplementalLiteral(_ word: String) -> Bool {
    supplementalLiterals.contains(word.lowercased())
  }

  /// Natural-log unigram probability calibrated from the AOSP frequency byte.
  @inline(__always) public func unigramLogProbability(_ id: Int) -> Double {
    unigramIntercept + unigramSlope * Double(frequencies[id])
  }

  public func unigramLogProbability(frequency: UInt8) -> Double {
    unigramIntercept + unigramSlope * Double(frequency)
  }

  // MARK: Trie

  public var root: TrieNode { node(0) }

  @inline(__always) public func node(_ index: Int) -> TrieNode {
    let p = trie + index &* 16
    return TrieNode(
      index: index,
      firstChild: Int(p.loadUnaligned(as: UInt32.self)),
      lo: Int(p.loadUnaligned(fromByteOffset: 4, as: UInt32.self)),
      hi: Int(p.loadUnaligned(fromByteOffset: 8, as: UInt32.self)),
      byte: p.load(fromByteOffset: 12, as: UInt8.self),
      childCount: Int(p.load(fromByteOffset: 13, as: UInt8.self)),
      terminalCount: Int(p.load(fromByteOffset: 14, as: UInt8.self)),
      maxFrequency: p.load(fromByteOffset: 15, as: UInt8.self)
    )
  }

  public func child(of parent: TrieNode, byte: UInt8) -> TrieNode? {
    var low = parent.firstChild
    var high = parent.firstChild + parent.childCount
    while low < high {
      let mid = (low + high) / 2
      let candidate = trie.load(fromByteOffset: mid &* 16 + 12, as: UInt8.self)
      if candidate == byte { return node(mid) }
      if candidate < byte { low = mid + 1 } else { high = mid }
    }
    return nil
  }

  public func node(forKey key: some Sequence<UInt8>) -> TrieNode? {
    var current = root
    for byte in key {
      guard let next = child(of: current, byte: byte) else { return nil }
      current = next
    }
    return current
  }

  /// Word ids whose normalized key matches exactly.
  public func words(forKey key: String) -> Range<Int> {
    guard let found = node(forKey: key.utf8) else { return 0..<0 }
    return found.terminals
  }

  /// The id of `word` as written, falling back to a case-insensitive match.
  public func id(of word: String) -> Int? {
    let range = words(forKey: TextNormalizer.key(word))
    guard !range.isEmpty else { return nil }
    if let exact = range.first(where: { display($0) == word }) { return exact }
    let lowered = word.lowercased()
    return range.first(where: { display($0).lowercased() == lowered })
  }

  // MARK: Glide

  public func glideBucket(first: UInt8, last: UInt8) -> Range<Int> {
    let index = Int(first &- 97) * 26 + Int(last &- 97)
    guard index >= 0, index < 676 else { return 0..<0 }
    return Int(glideOffsets[index])..<Int(glideOffsets[index + 1])
  }

  @inline(__always) public func glideWord(at position: Int) -> Int { Int(glideIDs[position]) }

  // MARK: Bigrams

  /// History index for the start of a sentence.
  public var sentenceStart: Int { wordCount }

  public func successors(of history: Int) -> Range<Int> {
    Int(bigramOffsets[history])..<Int(bigramOffsets[history + 1])
  }

  @inline(__always) public func successor(at position: Int) -> (id: Int, logProbability: Double) {
    (Int(bigramIDs[position]), -Double(bigramScores[position]) / bigramQuant)
  }

  /// Interpolated bigram probability; falls back to the history's backoff weight.
  /// `normalizingOmissions: false` keeps the stored backoff alone for words the
  /// bounded table omits, as dictionaries scored them before normalization.
  public func logProbability(of id: Int, after history: Int?, normalizingOmissions: Bool = true) -> Double {
    guard let history else { return unigramLogProbability(id) }
    let range = successors(of: history)
    if range.isEmpty { return unigramLogProbability(id) }
    let target = UInt32(id)
    if !normalizingOmissions {
      for position in range where bigramIDs[position] == target {
        return -Double(bigramScores[position]) / bigramQuant
      }
      return -Double(bigramBackoffs[history]) / bigramQuant + unigramLogProbability(id)
    }
    var listedMass = 0.0, listedUnigramMass = 0.0, weakest = 0.0
    for position in range {
      let score = Int(bigramScores[position])
      let successor = bigramIDs[position]
      if successor == target { return -Double(score) / bigramQuant }
      listedMass += probabilityOfScore[score]
      listedUnigramMass += unigramProbability[Int(frequencies[Int(successor)])]
      weakest = max(weakest, Double(score))
    }
    return unlistedLogProbability(
      unigramLogProbability(id), backoff: -Double(bigramBackoffs[history]) / bigramQuant,
      listedMass: listedMass, listedLowerMass: listedUnigramMass, weakest: -weakest / bigramQuant)
  }

  /// A bounded successor table drops the mass of every continuation it omits.
  /// The stored backoff only covers words never seen after the history, so a
  /// frequent word that merely missed the cut fell several nats below its prior
  /// ("of the players", sentence-initial "Maybe"). Spread the omitted mass in
  /// proportion to the lower-order model (Katz normalization), never above the
  /// weakest listed successor, so stored continuations keep their order.
  func unlistedLogProbability(_ lower: Double, backoff: Double, listedMass: Double, listedLowerMass: Double, weakest: Double) -> Double {
    let stored = backoff + lower
    let omitted = max(0, 1 - listedMass), remaining = max(1e-6, 1 - listedLowerMass)
    guard omitted > 0 else { return stored }
    let normalized = min(lower + log(omitted / remaining), weakest)
    return max(stored, normalized)
  }

  /// Omitted trigram mass relative to the bigram mass of the listed successors,
  /// and the weakest listed successor. Cached per history on first use.
  public func trigramOmission(of history: Int) -> (factor: Double, weakest: Double) {
    omissionLock.lock()
    if let cached = trigramOmissions[history] {
      omissionLock.unlock()
      return cached
    }
    omissionLock.unlock()
    let previous = trigramHistories.map { Int($0[history] & 0xffff_ffff) }
    var listedMass = 0.0, listedLowerMass = 0.0, weakest = 0.0
    for position in trigramSuccessors(of: history) {
      let entry = trigramSuccessor(at: position)
      listedMass += exp(entry.logProbability)
      listedLowerMass += exp(logProbability(of: entry.id, after: previous))
      weakest = min(weakest, entry.logProbability)
    }
    let value = (factor: max(0, 1 - listedMass) / max(1e-6, 1 - listedLowerMass), weakest: weakest)
    omissionLock.lock()
    trigramOmissions[history] = value
    omissionLock.unlock()
    return value
  }

  public func trigramHistory(preceding: Int, previous: Int) -> Int? {
    guard let histories = trigramHistories else { return nil }
    let key = UInt64(preceding) << 32 | UInt64(previous)
    var low = 0, high = histories.count
    while low < high {
      let middle = (low + high) / 2
      if histories[middle] < key { low = middle + 1 } else { high = middle }
    }
    return low < histories.count && histories[low] == key ? low : nil
  }

  public func trigramSuccessors(of history: Int) -> Range<Int> {
    guard let offsets = trigramOffsets else { return 0..<0 }
    return Int(offsets[history])..<Int(offsets[history + 1])
  }

  public func trigramSuccessor(at position: Int) -> (id: Int, logProbability: Double) {
    (Int(trigramIDs![position]), -Double(trigramScores![position]) / bigramQuant)
  }

  public func trigramWeight(of history: Int) -> Double {
    // A finite history always leaves some evidence for the shorter context.
    // Older dictionaries round sufficiently supported histories to 255, which
    // otherwise gives every continuation omitted from the bounded table zero.
    Double(min(trigramWeights![history], 254)) / 255
  }

  /// Frequent safe words, retrieved from the trie without scanning the lexicon
  /// at keyboard startup. Used when a history has few or no successors.
  public func frequentWords(limit: Int) -> [Int] {
    SpellCorrector(lexicon: self).completions(of: [(node: 0, cost: 0)], limit: limit, excluding: 0).map(\.id)
  }
}

public enum TextNormalizer {
  /// Lowercased, diacritic-free, apostrophe-free lookup key.
  public static func key(_ word: String) -> String {
    // Most words are ASCII, which compatibility decomposition leaves unchanged and
    // which has no combining marks: lowercasing and dropping apostrophes suffices.
    // This runs for many candidates on every keystroke and swipe.
    let utf8 = word.utf8
    guard !utf8.contains(where: { $0 >= 0x80 }) else { return unicodeKey(word) }
    return String(unsafeUninitializedCapacity: utf8.count) { buffer in
      var count = 0
      for byte in utf8 where byte != UInt8(ascii: "'") {
        buffer[count] = byte >= UInt8(ascii: "A") && byte <= UInt8(ascii: "Z") ? byte + 32 : byte
        count += 1
      }
      return count
    }
  }

  /// The general form, for text outside ASCII.
  static func unicodeKey(_ word: String) -> String {
    var result = ""
    result.reserveCapacity(word.utf8.count)
    for scalar in word.lowercased().decomposedStringWithCompatibilityMapping.unicodeScalars {
      if scalar == "'" || scalar == "\u{2019}" { continue }
      if scalar.properties.generalCategory == .nonspacingMark { continue }
      result.unicodeScalars.append(scalar)
    }
    return result
  }
}
