import Foundation

/// A word as typed, with the touch location of each character when known.
public struct TypedWord: Equatable, Sendable {
  public var text: String
  public var taps: [KeyPoint?]

  public init(text: String, taps: [KeyPoint?] = []) {
    self.text = text
    self.taps = taps
  }

  public var isEmpty: Bool { text.isEmpty }

  mutating func append(_ character: String, tap: KeyPoint?) {
    text += character
    taps.append(contentsOf: [KeyPoint?](repeating: tap, count: character.count))
  }

  mutating func removeLast() {
    guard !text.isEmpty else { return }
    text.removeLast()
    if !taps.isEmpty { taps.removeLast() }
  }

  /// Normalized key bytes paired with their taps; apostrophes and accents drop out.
  var keyed: (bytes: [UInt8], taps: [KeyPoint?]) {
    var bytes: [UInt8] = []
    var keyedTaps: [KeyPoint?] = []
    for (index, character) in text.enumerated() {
      let tap = index < taps.count ? taps[index] : nil
      for byte in TextNormalizer.key(String(character)).utf8 {
        bytes.append(byte)
        keyedTaps.append(tap)
      }
    }
    return (bytes, keyedTaps)
  }
}

public struct SpellMatch: Equatable, Sendable {
  public let id: Int
  public let cost: Double
}

/// Weighted Damerau-Levenshtein search over the dictionary trie. Substitution
/// costs come from how far each touch landed from the intended key.
public final class SpellCorrector {
  public let lexicon: Lexicon
  public var geometry: LetterGeometry
  public var maximumVisitedNodes = 60_000

  // Costs are negative log-probabilities of each slip, so they trade off directly
  // against the language model. A letter the typist skipped is more common than
  // an unexplained extra one; doubled taps and brushed neighbors stay cheaper.
  static let insertionCost = 3.5
  static let deletionCost = 5.0
  static let doubledLetterCost = 1.6
  static let transpositionCost = 3.0
  static let firstLetterPenalty = 1.2
  static let substitutionCap = 6.0
  static let vowels: Set<UInt8> = Set("aeiouy".utf8)

  /// Swapped vowels (recieve, wierd) are a spelling slip more than a typing one.
  @inline(__always) static func transposition(_ a: UInt8, _ b: UInt8) -> Double {
    vowels.contains(a) && vowels.contains(b) ? 2.0 : transpositionCost
  }

  public init(lexicon: Lexicon, geometry: LetterGeometry = .qwerty) {
    self.lexicon = lexicon
    self.geometry = geometry
  }

  /// Largest total edit cost worth correcting for a word of `length` letters.
  public static func bound(forLength length: Int) -> Double {
    switch length {
    case ...1: 0
    case 2: 3.3
    // A centered adjacent-key substitution at the beginning costs 3.2 + 1.2.
    case 3: 4.4
    case 4: 5.2
    case 5...6: 7.0
    default: 9.0
    }
  }

  static func prefixBound(forLength length: Int) -> Double {
    switch length {
    case ...2: 0
    case 3: 2.0
    default: 3.6
    }
  }

  struct Costs {
    let typed: [UInt8]
    let points: [KeyPoint?]
    let deletion: [Double]
    let geometry: LetterGeometry

    init(typed: [UInt8], taps: [KeyPoint?], geometry: LetterGeometry) {
      self.typed = typed
      self.geometry = geometry
      points = typed.indices.map { taps.indices.contains($0) ? (taps[$0] ?? geometry.center(typed[$0])) : geometry.center(typed[$0]) }
      deletion = typed.indices.map { index in
        var cost = SpellCorrector.deletionCost
        if index > 0, typed[index] == typed[index - 1] {
          cost = SpellCorrector.doubledLetterCost
        } else if let here = geometry.center(typed[index]) {
          // A neighbor brushed on the way to the intended key.
          for neighbor in [index - 1, index + 1] where typed.indices.contains(neighbor) {
            if let other = geometry.center(typed[neighbor]), here.distanceSquared(to: other) <= 1.3 { cost = min(cost, 3.0) }
          }
        }
        return index == 0 ? cost + SpellCorrector.firstLetterPenalty : cost
      }
    }

    @inline(__always) func substitution(_ index: Int, _ byte: UInt8) -> Double {
      let typedByte = typed[index]
      if typedByte == byte { return 0 }
      var cost = SpellCorrector.substitutionCap
      if let point = points[index], let target = geometry.center(byte) {
        cost = min(cost, 0.8 + 2.4 * point.distanceSquared(to: target))
      }
      if SpellCorrector.vowels.contains(typedByte), SpellCorrector.vowels.contains(byte) { cost = min(cost, 3.8) }
      return index == 0 ? cost + SpellCorrector.firstLetterPenalty : cost
    }

    @inline(__always) func insertion(_ byte: UInt8, previous: UInt8?, position: Int) -> Double {
      let cost = byte == previous ? SpellCorrector.doubledLetterCost : SpellCorrector.insertionCost
      return position == 0 ? cost + SpellCorrector.firstLetterPenalty : cost
    }
  }

  public struct Result {
    public var words: [SpellMatch] = []
    /// Trie nodes whose prefix matches everything typed so far, for completions.
    public var prefixes: [(node: Int, cost: Double)] = []
  }

  public func search(_ word: TypedWord, maximumCost: Double? = nil, prefixCost: Double? = nil) -> Result {
    let keyed = word.keyed
    let typed = keyed.bytes
    let n = typed.count
    guard n > 0 else { return Result() }
    let bound = maximumCost ?? Self.bound(forLength: n)
    let prefixBound = prefixCost ?? Self.prefixBound(forLength: n)
    let costs = Costs(typed: typed, taps: keyed.taps, geometry: geometry)
    let maxDepth = n + Int(bound / Self.doubledLetterCost) + 1
    let width = n + 1
    var rows = [Double](repeating: 0, count: (maxDepth + 1) * width)
    var bytes = [UInt8](repeating: 0, count: maxDepth + 1)
    for i in 1...n { rows[i] = rows[i - 1] + costs.deletion[i - 1] }

    var result = Result()
    var stack: [(node: Int, depth: Int)] = []
    let root = lexicon.root
    for child in root.children.reversed() { stack.append((child, 1)) }
    var visited = 0

    while let (index, depth) = stack.popLast() {
      visited += 1
      if visited > maximumVisitedNodes { break }
      let node = lexicon.node(index)
      let byte = node.byte
      bytes[depth] = byte
      let previous: UInt8? = depth >= 2 ? bytes[depth - 1] : nil
      let parent = (depth - 1) * width
      let current = depth * width
      let grand = (depth - 2) * width
      let insertion = costs.insertion(byte, previous: previous, position: depth - 1)
      rows[current] = rows[parent] + insertion
      var minimum = rows[current]
      for i in 1...n {
        var value = rows[parent + i - 1] + costs.substitution(i - 1, byte)
        let inserted = rows[parent + i] + insertion
        if inserted < value { value = inserted }
        let deleted = rows[current + i - 1] + costs.deletion[i - 1]
        if deleted < value { value = deleted }
        if i >= 2, depth >= 2, typed[i - 1] == previous, typed[i - 2] == byte, typed[i - 1] != byte {
          let transposed = rows[grand + i - 2] + Self.transposition(byte, previous!) + (depth == 2 && i == 2 ? Self.firstLetterPenalty : 0)
          if transposed < value { value = transposed }
        }
        rows[current + i] = value
        if value < minimum { minimum = value }
      }
      let full = rows[current + n]
      if node.terminalCount > 0, full <= bound {
        for id in node.terminals { result.words.append(SpellMatch(id: id, cost: full)) }
      }
      if depth >= n, full <= prefixBound, node.childCount > 0 {
        result.prefixes.append((index, full))
      }
      // A transposition at the next depth reaches back to the parent's row, so a
      // branch stays alive while that row could still come in under the bound.
      var parentMinimum = Double.infinity
      for i in 0...n { parentMinimum = min(parentMinimum, rows[parent + i]) }
      if min(minimum, parentMinimum + 2.0) <= bound, depth < maxDepth {
        for child in node.children.reversed() { stack.append((child, depth + 1)) }
      }
    }
    return result
  }

  /// The most frequent words below the matched prefixes, best first.
  public func completions(of prefixes: [(node: Int, cost: Double)], limit: Int, excluding minimumLength: Int) -> [SpellMatch] {
    var heap = BinaryHeap<(priority: Double, node: Int, word: Int?, cost: Double)> { $0.priority > $1.priority }
    for prefix in prefixes {
      let node = lexicon.node(prefix.node)
      heap.push((lexicon.unigramLogProbability(frequency: node.maxFrequency) - prefix.cost, prefix.node, nil, prefix.cost))
    }
    var found: [SpellMatch] = []
    var seen = Set<Int>()
    var expansions = 0
    while let top = heap.pop(), found.count < limit, expansions < 4_000 {
      expansions += 1
      if let word = top.word {
        if seen.insert(word).inserted { found.append(SpellMatch(id: word, cost: top.cost)) }
        continue
      }
      let node = lexicon.node(top.node)
      for word in node.terminals where lexicon.keyLength(word) > minimumLength && !lexicon.flags(word).contains(.neverSuggest) {
        heap.push((lexicon.unigramLogProbability(word) - top.cost, top.node, word, top.cost))
      }
      for child in node.children {
        let childNode = lexicon.node(child)
        guard childNode.maxFrequency > 0 else { continue }
        heap.push((lexicon.unigramLogProbability(frequency: childNode.maxFrequency) - top.cost, child, nil, top.cost))
      }
    }
    return found
  }

  /// Direct cost between a typed word and a candidate key, for personal words outside the trie.
  public func cost(of word: TypedWord, against candidate: String) -> Double {
    costEvaluator(for: word)(TextNormalizer.key(candidate))
  }

  /// Prepare the typed word once when matching a large personal vocabulary.
  /// Candidate keys have already been normalized by PersonalDictionary.
  /// - Parameter bound: Costs above it are only reported as greater than it,
  ///   which lets a clearly different candidate stop after a few letters.
  func costEvaluator(for word: TypedWord, bound: Double = .infinity) -> (String) -> Double {
    let keyed = word.keyed
    let typed = keyed.bytes
    let costs = Costs(typed: typed, taps: keyed.taps, geometry: geometry)
    var rows: [Double] = []
    return { candidateKey in Self.cost(costs: costs, target: candidateKey.utf8, bound: bound, rows: &rows) }
  }

  /// The same recurrence as `search`, over three reused rows.
  private static func cost(costs: Costs, target: String.UTF8View, bound: Double, rows: inout [Double]) -> Double {
    let typed = costs.typed
    guard !typed.isEmpty else { return .infinity }
    let n = typed.count
    let width = n + 1
    if rows.count < 3 * width { rows = [Double](repeating: 0, count: 3 * width) }
    return rows.withUnsafeMutableBufferPointer { rows in
      var grand = 0, parent = width, current = 2 * width
      rows[parent] = 0
      for i in 1...n { rows[parent + i] = rows[parent + i - 1] + costs.deletion[i - 1] }
      var parentMinimum = 0.0
      var previous: UInt8?
      var depth = 0
      for byte in target {
        depth += 1
        let insertion = costs.insertion(byte, previous: previous, position: depth - 1)
        rows[current] = rows[parent] + insertion
        var minimum = rows[current]
        for i in 1...n {
          var value = min(rows[parent + i - 1] + costs.substitution(i - 1, byte), rows[parent + i] + insertion, rows[current + i - 1] + costs.deletion[i - 1])
          if i >= 2, depth >= 2, typed[i - 1] == previous, typed[i - 2] == byte, typed[i - 1] != byte {
            value = min(value, rows[grand + i - 2] + Self.transposition(byte, previous!) + (depth == 2 && i == 2 ? Self.firstLetterPenalty : 0))
          }
          rows[current + i] = value
          if value < minimum { minimum = value }
        }
        // Every later cell adds a nonnegative cost to a cell of the last two
        // rows, so the final cost cannot come back under the bound.
        if min(minimum, parentMinimum) > bound { return .infinity }
        (grand, parent, current) = (parent, current, grand)
        parentMinimum = minimum
        previous = byte
      }
      return rows[parent + n]
    }
  }
}

struct BinaryHeap<Element> {
  private var storage: [Element] = []
  private let ordered: (Element, Element) -> Bool

  init(ordered: @escaping (Element, Element) -> Bool) {
    self.ordered = ordered
  }

  var isEmpty: Bool { storage.isEmpty }

  mutating func push(_ element: Element) {
    storage.append(element)
    var child = storage.count - 1
    while child > 0 {
      let parent = (child - 1) / 2
      guard ordered(storage[child], storage[parent]) else { break }
      storage.swapAt(child, parent)
      child = parent
    }
  }

  mutating func pop() -> Element? {
    guard !storage.isEmpty else { return nil }
    storage.swapAt(0, storage.count - 1)
    let top = storage.removeLast()
    var parent = 0
    while true {
      let left = parent * 2 + 1
      let right = left + 1
      var best = parent
      if left < storage.count, ordered(storage[left], storage[best]) { best = left }
      if right < storage.count, ordered(storage[right], storage[best]) { best = right }
      if best == parent { break }
      storage.swapAt(parent, best)
      parent = best
    }
    return top
  }
}
