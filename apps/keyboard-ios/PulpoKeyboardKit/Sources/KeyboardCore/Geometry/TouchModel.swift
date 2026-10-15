import Foundation

/// Where this person's taps land relative to each letter key, learned on device
/// from words they accepted. Thumbs undershoot and land low in person-specific
/// ways; the spatial typo model measures each touch from the key's learned
/// center instead of its drawn one. Offsets are in key-pitch units. A key with
/// little evidence of its own follows the person's overall offset.
///
/// Only letter offsets and counts are stored: no text, no touch sequences.
public final class TouchModel {
  struct Snapshot: Codable {
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

  public init(url: URL?) {
    self.url = url
    guard let url, let data = try? Data(contentsOf: url),
          let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data),
          snapshot.version == 1, snapshot.keys.count == 26 else { return }
    for (index, values) in snapshot.keys.enumerated() where values.count == 3 && values.allSatisfy(\.isFinite) {
      sums[index] = (values[0], values[1], max(0, min(values[2], Self.maximumWeight)))
    }
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
  public func learn(_ word: TypedWord, intended: String, geometry: LetterGeometry) {
    guard isLearning else { return }
    let keyed = word.keyed
    let target = Array(TextNormalizer.key(intended).utf8)
    guard target.count == keyed.bytes.count, target.count >= 2 else { return }
    let current = offsets
    for (index, byte) in target.enumerated() {
      guard byte >= 97, byte <= 122, let tap = keyed.taps[index], let center = geometry.center(byte) else { continue }
      let slot = Int(byte - 97)
      var dx = tap.x - center.x, dy = tap.y - center.y
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

  public func reset() {
    sums = Array(repeating: (0, 0, 0), count: 26)
    cache = nil
    dirty = true
  }

  /// Writes the offsets if they changed. The snapshot is a few hundred bytes,
  /// so it is encoded here; `inBackground` only moves the file write off this thread.
  public func save(inBackground: Bool = false) {
    guard dirty, let url, let data = try? JSONEncoder().encode(Snapshot(keys: sums.map { [$0.x, $0.y, $0.weight] })) else { return }
    dirty = false
    let write = { try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]) }
    if inBackground { Self.writeQueue.async { _ = write() } } else { _ = write() }
  }

  private static let writeQueue = DispatchQueue(label: "com.isaacthoman.pulpo.keyboard.touch-model", qos: .utility)
}
