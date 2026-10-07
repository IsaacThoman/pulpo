import Foundation

public struct GlideCandidate: Equatable, Sendable {
  public let text: String
  public let score: Double
}

/// Decodes a swipe across the letter keys into likely words.
///
/// Candidates come from the dictionary buckets for the letters nearest the start
/// and end of the swipe. Each must pass near its letters in order; survivors are
/// scored on letter alignment, on how much of the swipe the word's ideal path
/// explains, and on the language model.
public final class GlideDecoder {
  public let model: LanguageModel
  public var geometry: LetterGeometry
  public var sampleCount = 64
  /// Spread of letter hits around key centers, in key pitches.
  public var alignmentSigma = 0.38
  /// Spread of the swipe around the word's ideal path.
  public var shapeSigma = 0.32
  public var shapeWeight = 10.0
  public var languageWeight = 0.9
  public var passageRadius = 0.95
  /// Sharp turns in the swipe should sit on a letter of the word.
  public var cornerSigma = 0.45
  public var cornerAngle = 0.9
  public var maximumCandidates = 6_000

  public init(model: LanguageModel, geometry: LetterGeometry = .qwerty) {
    self.model = model
    self.geometry = geometry
  }

  var lexicon: Lexicon { model.lexicon }

  /// Total path length of a swipe, in key pitches.
  public static func length(of points: [KeyPoint]) -> Double {
    zip(points, points.dropFirst()).reduce(0) { $0 + $1.0.distance(to: $1.1) }
  }

  public static func resample(_ points: [KeyPoint], count: Int) -> [KeyPoint] {
    guard points.count > 1, count > 1 else { return [KeyPoint](repeating: points.first ?? KeyPoint(x: 0, y: 0), count: max(count, 1)) }
    let total = length(of: points)
    guard total > 0 else { return [KeyPoint](repeating: points[0], count: count) }
    let step = total / Double(count - 1)
    var result = [points[0]]
    result.reserveCapacity(count)
    var carried = 0.0
    var previous = points[0]
    var index = 1
    while index < points.count, result.count < count - 1 {
      let next = points[index]
      let segment = previous.distance(to: next)
      if carried + segment >= step, segment > 0 {
        let t = (step - carried) / segment
        let point = KeyPoint(x: previous.x + t * (next.x - previous.x), y: previous.y + t * (next.y - previous.y))
        result.append(point)
        previous = point
        carried = 0
      } else {
        carried += segment
        previous = next
        index += 1
      }
    }
    while result.count < count { result.append(points[points.count - 1]) }
    return result
  }

  public func decode(_ rawPoints: [KeyPoint], context: LanguageContext, limit: Int = 5) -> [GlideCandidate] {
    var points: [KeyPoint] = []
    for point in rawPoints where points.last.map({ $0.distanceSquared(to: point) > 0.0004 }) ?? true {
      points.append(point)
    }
    guard points.count >= 2, let first = points.first, let last = points.last else { return [] }
    let gestureLength = Self.length(of: points)
    let samples = Self.resample(points, count: sampleCount)
    let corners = Self.corners(in: samples, length: gestureLength, threshold: cornerAngle)
    let starts = geometry.letters(near: first, radius: 1.25, limit: 3)
    let ends = geometry.letters(near: last, radius: 1.25, limit: 3)
    guard !starts.isEmpty, !ends.isEmpty else { return [] }

    var scored: [String: Double] = [:]
    var template: [KeyPoint] = []
    template.reserveCapacity(32)
    var examined = 0

    func consider(text: String, id: Int?, key: some Collection<UInt8>) {
      template.removeAll(keepingCapacity: true)
      var previousByte: UInt8 = 0
      for byte in key where byte != previousByte {
        guard let center = geometry.center(byte) else { return }
        template.append(center)
        previousByte = byte
      }
      guard template.count >= 2 else { return }
      guard let spatial = spatialScore(samples: samples, gestureLength: gestureLength, template: template, corners: corners) else { return }
      let logP = model.logProbability(of: text, id: id, in: context)
      let score = spatial + languageWeight * logP
      if score > scored[text] ?? -.infinity { scored[text] = score }
    }

    for start in starts {
      for end in ends {
        for position in lexicon.glideBucket(first: start, last: end) {
          examined += 1
          if examined > maximumCandidates { break }
          let id = lexicon.glideWord(at: position)
          let display = lexicon.display(id)
          if model.personal.isBlocked(display) { continue }
          let length = lexicon.keyLength(id)
          consider(text: display, id: id, key: (0..<length).lazy.map { self.lexicon.keyByte(id, $0) })
        }
      }
    }
    for word in model.personal.knownWords {
      let key = Array(TextNormalizer.key(word).utf8)
      guard key.count >= 2, let head = key.first, let tail = key.last, starts.contains(head), ends.contains(tail),
            key.allSatisfy({ $0 >= 97 && $0 <= 122 }) else { continue }
      consider(text: word, id: lexicon.id(of: word), key: key)
    }
    return scored.map { GlideCandidate(text: $0.key, score: $0.value) }
      .sorted { $0.score != $1.score ? $0.score > $1.score : $0.text < $1.text }
      .prefix(limit)
      .map { $0 }
  }

  /// Log-likelihood that the swipe was meant to trace `template`, or `nil` when it
  /// clearly was not (wrong length, or a letter the swipe never passed).
  func spatialScore(samples: [KeyPoint], gestureLength: Double, template: [KeyPoint], corners: [KeyPoint] = []) -> Double? {
    var templateLength = 0.0
    for index in 1..<template.count { templateLength += template[index - 1].distance(to: template[index]) }
    let ratio = gestureLength / max(templateLength, 0.6)
    if templateLength > 1.5, ratio < 0.5 || ratio > 2.4 { return nil }
    if templateLength <= 1.5, gestureLength > templateLength + 3.5 { return nil }

    // Every interior letter must be passed, in order.
    let n = samples.count
    let radiusSquared = passageRadius * passageRadius
    var cursor = 0
    if template.count > 2 {
      for letter in 1..<(template.count - 1) {
        let center = template[letter]
        while cursor < n, samples[cursor].distanceSquared(to: center) > radiusSquared { cursor += 1 }
        if cursor == n { return nil }
      }
    }

    // Monotonic alignment of letters to swipe samples: first letter at the start,
    // last letter at the end, interior letters wherever they fit best in order.
    let k = template.count
    var previousRow = [Double](repeating: .infinity, count: n)
    var row = [Double](repeating: .infinity, count: n)
    previousRow[0] = samples[0].distanceSquared(to: template[0])
    for letter in 1..<k {
      let center = template[letter]
      var runningMinimum = Double.infinity
      for j in 0..<n {
        runningMinimum = min(runningMinimum, previousRow[j])
        row[j] = runningMinimum + samples[j].distanceSquared(to: center)
      }
      swap(&previousRow, &row)
    }
    let alignment = previousRow[n - 1]
    let alignmentScore = alignment / (2 * alignmentSigma * alignmentSigma)

    // How far the swipe strays from the ideal path, which rejects words that skip
    // a corner the finger clearly made.
    var stray = 0.0
    for sample in samples {
      var best = Double.infinity
      for index in 1..<k {
        best = min(best, Self.segmentDistanceSquared(sample, template[index - 1], template[index]))
      }
      stray += best
    }
    let shapeScore = shapeWeight * stray / Double(n) / (2 * shapeSigma * shapeSigma)

    // A turn the word's letters don't explain means the finger was going somewhere else.
    var cornerScore = 0.0
    for corner in corners {
      var nearest = Double.infinity
      for letter in template { nearest = min(nearest, corner.distanceSquared(to: letter)) }
      cornerScore += min(6, nearest / (2 * cornerSigma * cornerSigma))
    }
    // Extra travel the word doesn't account for; cutting corners short is normal.
    let logRatio = log(gestureLength / max(templateLength, 0.6))
    let lengthScore = logRatio > 0 ? logRatio * logRatio / (2 * 0.15 * 0.15) : logRatio * logRatio / (2 * 0.3 * 0.3)
    return -(alignmentScore + shapeScore + cornerScore + lengthScore)
  }

  /// Points where the swipe turns sharply, measured over about a third of a key.
  static func corners(in samples: [KeyPoint], length: Double, threshold: Double) -> [KeyPoint] {
    let n = samples.count
    guard n > 4, length > 0 else { return [] }
    let spacing = length / Double(n - 1)
    let reach = max(2, Int((0.35 / spacing).rounded(.up)))
    guard n > reach * 2 else { return [] }
    var angles = [Double](repeating: 0, count: n)
    for i in reach..<(n - reach) {
      let a = samples[i - reach], b = samples[i], c = samples[i + reach]
      let v1 = (b.x - a.x, b.y - a.y), v2 = (c.x - b.x, c.y - b.y)
      let norms = (v1.0 * v1.0 + v1.1 * v1.1).squareRoot() * (v2.0 * v2.0 + v2.1 * v2.1).squareRoot()
      guard norms > 1e-9 else { continue }
      angles[i] = acos(max(-1, min(1, (v1.0 * v2.0 + v1.1 * v2.1) / norms)))
    }
    var result: [KeyPoint] = []
    var i = reach
    while i < n - reach {
      if angles[i] > threshold {
        // Take the sharpest point of this turn.
        var best = i
        while i < n - reach, angles[i] > threshold {
          if angles[i] > angles[best] { best = i }
          i += 1
        }
        result.append(samples[best])
      }
      i += 1
    }
    return result
  }

  @inline(__always) static func segmentDistanceSquared(_ p: KeyPoint, _ a: KeyPoint, _ b: KeyPoint) -> Double {
    let dx = b.x - a.x
    let dy = b.y - a.y
    let lengthSquared = dx * dx + dy * dy
    guard lengthSquared > 0 else { return p.distanceSquared(to: a) }
    let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
    return p.distanceSquared(to: KeyPoint(x: a.x + t * dx, y: a.y + t * dy))
  }
}
