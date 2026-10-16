import Foundation

/// Where this person's taps land relative to each letter key, learned on device
/// from words they accepted. Thumbs undershoot and land low in person-specific
/// ways; the spatial typo model measures each touch from the key's learned
/// center instead of its drawn one. Offsets are in key-pitch units. A key with
/// little evidence of its own follows the person's overall offset.
///
/// Only letter offsets and counts are stored: no text, no touch sequences.
public final class TouchModel {
  struct Snapshot: Codable, Equatable, Sendable {
    var version = 1
    /// Per letter a-z: summed x offset, summed y offset, weight.
    var keys: [[Double]]
  }

  /// Pseudo-taps that pull a key toward the overall offset, and the overall offset toward zero.
  static let keyPrior = 12.0
  static let globalPrior = 24.0
  /// Older evidence fades once a key has this much, so a new grip or case catches up.
  static let maximumWeight = 300.0
  /// A sample is clamped to this distance from the current estimate, so a mistap
  /// in an accepted word cannot drag a key toward its neighbor.
  static let sampleRadius = 0.45
  /// Learned offsets never move a key center farther than this.
  static let maximumOffset = 0.4
  /// Taps needed before offsets are applied at all.
  static let minimumWeight = 40.0

  private var sums: [(x: Double, y: Double, weight: Double)] = Array(repeating: (0, 0, 0), count: 26)
  private var cache: [KeyPoint]?
  private let url: URL?
  private var dirty = false
  /// Off while evaluating a fixed model, or for fields that must not teach it.
  public var isLearning = true

  private var persistence: LearningSession?
  public private(set) var persistenceResult: LearningPersistenceResult = .ok

  public init(url: URL?) {
    self.url = url
    if let url {
      persistence = LearningSession(url: url, kind: .touch)
      reloadIfChangedOnDisk()
    }
  }

  var snapshot: Snapshot { Snapshot(keys: sums.map { [$0.x, $0.y, $0.weight] }) }

  private func adopt(_ value: LearningPayload?) -> Bool {
    guard case let .touch(snapshot) = value, snapshot != self.snapshot else { return false }
    sums = snapshot.keys.map { ($0[0], $0[1], $0[2]) }
    cache = nil
    return true
  }

  static func applying(_ operations: [LearningMutation], to snapshot: Snapshot) -> Snapshot {
    let model = TouchModel(url: nil)
    _ = model.adopt(.touch(snapshot))
    for operation in operations {
      if case let .touch(samples) = operation { model.learnLocally(samples) }
    }
    return model.snapshot
  }

  @discardableResult
  public func reloadIfChangedOnDisk() -> Bool {
    guard let persistence else { persistenceResult = .ok; return false }
    let outcome = persistence.observe()
    persistenceResult = outcome.result
    guard outcome.result == .ok else { return false }
    return adopt(outcome.payload)
  }

  /// Total accepted taps the model has learned from, after forgetting.
  public var weight: Double { sums.reduce(0) { $0 + $1.weight } }

  /// The learned offset of `byte`'s key, or zero for non-letters.
  @inline(__always) public func offset(_ byte: UInt8) -> KeyPoint {
    guard byte >= 97, byte <= 122 else { return KeyPoint(x: 0, y: 0) }
    if cache == nil { cache = computeOffsets() }
    return cache![Int(byte - 97)]
  }

  /// All 26 offsets, for callers that score many candidates against one word.
  public var offsets: [KeyPoint] {
    if cache == nil { cache = computeOffsets() }
    return cache!
  }

  private func computeOffsets() -> [KeyPoint] {
    let total = sums.reduce((x: 0.0, y: 0.0, weight: 0.0)) { ($0.x + $1.x, $0.y + $1.y, $0.weight + $1.weight) }
    let globalX = total.x / (total.weight + Self.globalPrior)
    let globalY = total.y / (total.weight + Self.globalPrior)
    return sums.map { entry in
      let x = (entry.x + Self.keyPrior * globalX) / (entry.weight + Self.keyPrior)
      let y = (entry.y + Self.keyPrior * globalY) / (entry.weight + Self.keyPrior)
      return KeyPoint(x: min(max(x, -Self.maximumOffset), Self.maximumOffset), y: min(max(y, -Self.maximumOffset), Self.maximumOffset))
    }
  }

  /// Learns from a word the person kept: each tap was aimed at the letter at the
  /// same position of `intended`. Words whose letters do not line up are skipped.
  @discardableResult
  public func learn(_ word: TypedWord, intended: String, geometry: LetterGeometry) -> Bool {
    guard isLearning else { persistenceResult = .invalid; return false }
    let keyed = word.keyed
    let target = Array(TextNormalizer.key(intended).utf8)
    guard target.count == keyed.bytes.count, target.count >= 2, target.count <= 40 else { persistenceResult = .invalid; return false }
    var samples: [TouchSample] = []
    for (index, byte) in target.enumerated() {
      guard byte >= 97, byte <= 122, let tap = keyed.taps[index], let center = geometry.center(byte) else { continue }
      let dx = tap.x - center.x, dy = tap.y - center.y
      guard dx.isFinite, dy.isFinite else { persistenceResult = .invalid; return false }
      samples.append(TouchSample(slot: Int(byte - 97), dx: dx, dy: dy))
    }
    guard !samples.isEmpty else { persistenceResult = .invalid; return false }
    if let persistence {
      let outcome = persistence.admit(.touch(samples))
      persistenceResult = outcome.result
      guard outcome.result == .ok else { return false }
      _ = adopt(outcome.payload)
    }
    learnLocally(samples)
    persistenceResult = .ok
    return true
  }

  private func learnLocally(_ samples: [TouchSample]) {
    // This reference is deliberately held constant for the whole kept word.
    let current = offsets
    for sample in samples {
      let slot = sample.slot
      var dx = sample.dx, dy = sample.dy
      // Robust update: clamp around the current estimate.
      let ex = dx - current[slot].x, ey = dy - current[slot].y
      let distance = (ex * ex + ey * ey).squareRoot()
      if distance > Self.sampleRadius {
        let scale = Self.sampleRadius / distance
        dx = current[slot].x + ex * scale
        dy = current[slot].y + ey * scale
      }
      var entry = sums[slot]
      if entry.weight + 1 > Self.maximumWeight {
        let keep = (Self.maximumWeight - 1) / entry.weight
        entry = (entry.x * keep, entry.y * keep, entry.weight * keep)
      }
      sums[slot] = (entry.x + dx, entry.y + dy, entry.weight + 1)
    }
    cache = nil
    dirty = true
  }

  @discardableResult
  public func reset() -> Bool {
    if let persistence {
      let outcome = persistence.clear()
      persistenceResult = outcome.result
      if outcome.result == .ok || outcome.result == .cleanup { _ = adopt(outcome.payload) }
      return outcome.result == .ok
    }
    sums = Array(repeating: (0, 0, 0), count: 26)
    cache = nil
    dirty = true
    persistenceResult = .ok
    return true
  }

  @discardableResult
  public func save(inBackground: Bool = false) -> Bool {
    guard let persistence else { persistenceResult = .ok; return true }
    if inBackground { persistence.saveInBackground(); return true }
    let outcome = persistence.save()
    persistenceResult = outcome.result
    if outcome.result == .ok { _ = adopt(outcome.payload); dirty = false }
    return outcome.result == .ok
  }
}
