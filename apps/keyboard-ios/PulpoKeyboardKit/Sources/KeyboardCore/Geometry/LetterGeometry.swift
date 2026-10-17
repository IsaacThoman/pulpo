import Foundation

/// A point in key-pitch units: adjacent keys in a row are 1 apart horizontally
/// and adjacent rows are 1 apart vertically.
public struct KeyPoint: Equatable, Sendable {
  public var x: Double
  public var y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }

  @inline(__always) public func distanceSquared(to other: KeyPoint) -> Double {
    let dx = x - other.x
    let dy = y - other.y
    return dx * dx + dy * dy
  }

  @inline(__always) public func distance(to other: KeyPoint) -> Double {
    distanceSquared(to: other).squareRoot()
  }
}

/// Letter key centers used by the spatial typo model and the glide decoder.
public struct LetterGeometry: Sendable {
  private var centers: [KeyPoint?]

  public init(centers: [Character: KeyPoint]) {
    var table = [KeyPoint?](repeating: nil, count: 26)
    for (letter, point) in centers {
      if let ascii = letter.asciiValue, ascii >= 97, ascii <= 122 { table[Int(ascii - 97)] = point }
    }
    self.centers = table
  }

  @inline(__always) public func center(_ byte: UInt8) -> KeyPoint? {
    guard byte >= 97, byte <= 122 else { return nil }
    return centers[Int(byte - 97)]
  }

  /// Letters ordered by distance from `point`, limited to `radius`.
  public func letters(near point: KeyPoint, radius: Double, limit: Int) -> [UInt8] {
    var found: [(UInt8, Double)] = []
    for index in 0..<26 {
      guard let center = centers[index] else { continue }
      let distance = center.distanceSquared(to: point)
      if distance <= radius * radius { found.append((UInt8(97 + index), distance)) }
    }
    return found.sorted { $0.1 < $1.1 }.prefix(limit).map(\.0)
  }

  public func nearestLetter(to point: KeyPoint) -> UInt8? {
    letters(near: point, radius: .infinity, limit: 1).first
  }

  /// The iPhone QWERTY arrangement: the bottom letter row starts 1.5 keys in.
  public static let qwerty: LetterGeometry = {
    var centers: [Character: KeyPoint] = [:]
    for (row, letters, start) in [(0, "qwertyuiop", 0.5), (1, "asdfghjkl", 1.0), (2, "zxcvbnm", 2.0)] {
      for (offset, letter) in letters.enumerated() {
        centers[letter] = KeyPoint(x: start + Double(offset), y: Double(row))
      }
    }
    return LetterGeometry(centers: centers)
  }()
}
