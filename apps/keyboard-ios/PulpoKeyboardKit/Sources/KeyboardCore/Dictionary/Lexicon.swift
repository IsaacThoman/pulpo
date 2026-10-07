import Foundation

public struct WordFlags: OptionSet, Sendable {
  public let rawValue: UInt8
  public init(rawValue: UInt8) { self.rawValue = rawValue }
  public static let neverSuggest = WordFlags(rawValue: 1 << 0)
  public static let glide = WordFlags(rawValue: 1 << 1)
  public static let capitalized = WordFlags(rawValue: 1 << 2)
  public static let abbreviation = WordFlags(rawValue: 1 << 3)
  public static let informal = WordFlags(rawValue: 1 << 4)
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
  private let trie: UnsafeRawPointer
  let nodeCount: Int
  private let glideOffsets: MappedArray<UInt32>
  private let glideIDs: MappedArray<UInt32>
  private let bigramOffsets: MappedArray<UInt32>
  private let bigramIDs: MappedArray<UInt32>
  private let bigramScores: MappedArray<UInt8>
  private let bigramBackoffs: MappedArray<UInt8>

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
  public func logProbability(of id: Int, after history: Int?) -> Double {
    guard let history else { return unigramLogProbability(id) }
    let range = successors(of: history)
    if range.isEmpty { return unigramLogProbability(id) }
    let target = UInt32(id)
    for position in range where bigramIDs[position] == target {
      return -Double(bigramScores[position]) / bigramQuant
    }
    return -Double(bigramBackoffs[history]) / bigramQuant + unigramLogProbability(id)
  }
}

public enum TextNormalizer {
  /// Lowercased, diacritic-free, apostrophe-free lookup key.
  public static func key(_ word: String) -> String {
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
