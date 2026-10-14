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
/// explains, and on the language model. With touch times, letters are also
/// expected where the finger slowed down rather than in fast transit.
public final class GlideDecoder {
  public let model: LanguageModel
  public var geometry: LetterGeometry
  public var sampleCount = 64
  /// Spread of letter hits around key centers, in key pitches.
  public var alignmentSigma = 0.38
  /// Calibration for the number of distinct letter targets in a word.
  public var alignmentLengthExponent = 0.5
  /// Spread of the swipe around the word's ideal path.
  public var shapeSigma = 0.32
  public var shapeWeight = 10.0
  public var languageWeight = 0.9
  public var passageRadius = 1.25
  /// Sharp turns in the swipe should sit on a letter of the word.
  public var cornerSigma = 0.45
  public var cornerAngle = 0.9
  public var maximumCandidates = 6_000
  /// Early finger lifts can leave the intended key outside the nearest four.
  /// Broader endpoints cost more scoring work; the candidate budget stays bounded.
  public var endpointRadius = 1.75
  public var endpointLetterLimit = 8
  public var extraLengthSigma = 0.25
  public var shortenedLengthSigma = 0.3
  /// Touch times, when given, add four cues measured from recorded human swipes.
  /// Interior letters sit where the finger slows down: fast transit costs up to
  /// about this many log-likelihood units per letter. Zero ignores the cue.
  public var letterSpeedWeight = 2.0
  /// Speeds, relative to the gesture's median, below which a letter costs nothing
  /// and above which the cost stops growing.
  public var letterSpeedFloor = 0.6
  public var letterSpeedCeiling = 1.6
  /// Slowing down away from every letter of a word counts against it, like an
  /// unexplained corner. Pauses are stretches below `pauseSpeed` times the median.
  public var pauseWeight = 0.5
  public var pauseSpeed = 0.4
  public var pauseSigma = 0.45
  /// Share of elapsed time, versus travelled distance, in sample spacing, so slow
  /// stretches near letters are sampled more densely than fast transit.
  public var timeShare = 0.25
  /// Fast gestures land farther from key centers. Spatial variance grows by this
  /// gain per multiple of `speedSigmaReference` key pitches per second, up to
  /// `speedSigmaMaximum` so implausible timestamps can't discard the path.
  public var speedSigmaGain = 1.0
  public var speedSigmaReference = 14.0
  public var speedSigmaMaximum = 1.5
  /// Shortest time span for a speed estimate, so coalesced bursts sharing a
  /// timestamp don't look infinitely fast. Gestures shorter than two spans
  /// decode as if they had no times.
  public var speedWindow = 0.03
  /// Recorded swipes often lift past the last letter, continuing along the final
  /// stroke. That letter may be credited this far beyond its key, in pitches, at
  /// a Gaussian cost; a word whose last stroke points elsewhere gets no credit.
  public var endOvershootLimit = 0.8
  public var endOvershootSigma = 0.5
  /// A finger that slows to a stop meant to end where it lifted, so the credit
  /// scales with lift-off speed (the last `liftWindow` seconds, relative to the
  /// gesture's average): none below the floor, all of it from the ceiling.
  /// Without usable times there is no credit, as before.
  public var overshootSpeedFloor = 0.1
  public var overshootSpeedCeiling = 0.5
  public var liftWindow = 0.05
  /// With a known previous word, the language model's likeliest continuations are
  /// also scored when their first or last key lies outside the endpoint buckets.
  public var contextSeedLimit = 16

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

  /// Samples evenly spaced in a blend of travelled distance and elapsed time, so
  /// slow stretches get more samples. `timeShare` 0 is pure arc length.
  static func resample(_ points: [KeyPoint], times: [Double], count: Int, timeShare: Double) -> (points: [KeyPoint], times: [Double])? {
    guard points.count > 1, count > 1, points.count == times.count else { return nil }
    let duration = times[times.count - 1] - times[0]
    let total = length(of: points)
    guard duration > 0, total > 0 else { return nil }
    var progress = [Double](repeating: 0, count: points.count)
    var travelled = 0.0
    for index in 1..<points.count {
      travelled += points[index - 1].distance(to: points[index])
      progress[index] = (1 - timeShare) * travelled / total + timeShare * (times[index] - times[0]) / duration
    }
    var resultPoints: [KeyPoint] = []
    var resultTimes: [Double] = []
    resultPoints.reserveCapacity(count)
    resultTimes.reserveCapacity(count)
    var segment = 0
    for j in 0..<count {
      let target = Double(j) / Double(count - 1) * progress[points.count - 1]
      while segment < points.count - 2, progress[segment + 1] < target { segment += 1 }
      let span = progress[segment + 1] - progress[segment]
      let t = span > 0 ? min(1, max(0, (target - progress[segment]) / span)) : 1
      let a = points[segment], b = points[segment + 1]
      resultPoints.append(KeyPoint(x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y)))
      resultTimes.append(times[segment] + t * (times[segment + 1] - times[segment]))
    }
    resultPoints[0] = points[0]
    resultPoints[count - 1] = points[points.count - 1]
    return (resultPoints, resultTimes)
  }

  /// Each sample's speed relative to the gesture's median speed, or `nil` when
  /// the times can't tell slow from fast (missing, constant, or too short).
  static func relativeSpeeds(samples: [KeyPoint], times: [Double], minimumSpan: Double) -> [Double]? {
    let n = times.count
    guard n > 4, samples.count == n, let first = times.first, let last = times.last, last - first >= 2 * minimumSpan else { return nil }
    var travelled = [Double](repeating: 0, count: n)
    for j in 1..<n { travelled[j] = travelled[j - 1] + samples[j - 1].distance(to: samples[j]) }
    guard travelled[n - 1] > 0 else { return nil }
    var speeds = [Double](repeating: 0, count: n)
    for j in 0..<n {
      var lower = max(0, j - 2), upper = min(n - 1, j + 2)
      while times[upper] - times[lower] < minimumSpan, lower > 0 || upper < n - 1 {
        lower = max(0, lower - 1)
        upper = min(n - 1, upper + 1)
      }
      let span = times[upper] - times[lower]
      guard span > 0 else { return nil }
      speeds[j] = (travelled[upper] - travelled[lower]) / span
    }
    let median = speeds.sorted()[n / 2]
    guard median > 0, median.isFinite else { return nil }
    for j in 0..<n { speeds[j] /= median }
    return speeds
  }

  /// Nondecreasing times for the deduplicated points, or `nil`. Small
  /// reorderings are clamped rather than rejected.
  static func cleanTimes(_ times: [Double], count: Int) -> [Double]? {
    guard times.count == count, times.allSatisfy(\.isFinite) else { return nil }
    var result = times
    for index in result.indices.dropFirst() where result[index] < result[index - 1] { result[index] = result[index - 1] }
    return result
  }

  /// What touch times add to the spatial evidence; neutral when they're absent.
  struct TimingCues {
    var samples: [KeyPoint]
    /// Nonnegative cost of putting an interior letter at each sample, in squared
    /// key pitches, and the share every interior letter is credited back.
    var letterCost: [Double]?
    var letterCredit = 0.0
    var pauses: [KeyPoint] = []
    var varianceScale = 1.0
  }

  func timingCues(points: [KeyPoint], times: [Double], length: Double) -> TimingCues? {
    guard let times = Self.cleanTimes(times, count: points.count) else { return nil }
    let duration = times[times.count - 1] - times[0]
    guard duration >= 2 * speedWindow,
          let blended = Self.resample(points, times: times, count: sampleCount, timeShare: timeShare),
          let speeds = Self.relativeSpeeds(samples: blended.points, times: blended.times, minimumSpan: speedWindow) else { return nil }
    var cues = TimingCues(samples: blended.points)
    cues.varianceScale = min(speedSigmaMaximum, 1 + speedSigmaGain * max(0, length / duration / speedSigmaReference - 1))
    if letterSpeedWeight > 0 {
      let scale = letterSpeedWeight * 2 * alignmentSigma * alignmentSigma * cues.varianceScale
      let span = max(letterSpeedCeiling - letterSpeedFloor, 1e-6)
      let raw = speeds.map { scale * min(1, max(0, ($0 - letterSpeedFloor) / span)) }
      // A letter's slowdown can peak a sample away from its closest point.
      let cost = raw.indices.map { raw[max(0, $0 - 1)...min(raw.count - 1, $0 + 1)].min()! }
      cues.letterCost = cost
      // Credit the cheapest interior cost back to every interior letter. Real
      // swipes always slow somewhere, so this is usually zero, but a constant
      // speed (times without information) then changes no word's score.
      cues.letterCredit = cost[1..<(cost.count - 1)].min() ?? 0
    }
    if pauseWeight > 0 { cues.pauses = Self.pauses(in: blended.points, speeds: speeds, threshold: pauseSpeed) }
    return cues
  }

  /// - Parameter times: Optional touch timestamps in seconds, one per point.
  ///   Without them (or when they carry no usable timing), decoding is purely spatial.
  public func decode(_ rawPoints: [KeyPoint], times rawTimes: [Double]? = nil, context: LanguageContext, limit: Int = 5) -> [GlideCandidate] {
    guard limit > 0 else { return [] }
    let timed = rawTimes.map { $0.count == rawPoints.count && $0.allSatisfy(\.isFinite) } ?? false
    var points: [KeyPoint] = []
    var times: [Double] = []
    for (index, point) in rawPoints.enumerated() where points.last.map({ $0.distanceSquared(to: point) > 0.0004 }) ?? true {
      points.append(point)
      if timed, let rawTimes { times.append(rawTimes[index]) }
    }
    guard points.count >= 2, let first = points.first, let last = points.last else { return [] }
    let gestureLength = Self.length(of: points)
    let arcSamples = Self.resample(points, count: sampleCount)
    let corners = Self.corners(in: arcSamples, length: gestureLength, threshold: cornerAngle)
    let cues = timed ? timingCues(points: points, times: times, length: gestureLength) : nil
    // Lift-off speed comes from the raw touches: deduplication drops the slow
    // final samples of a finger that came to rest.
    let lift = timed ? rawTimes.flatMap { Self.liftSpeed(points: rawPoints, times: $0, window: liftWindow) } : nil
    let overshoot = lift.map {
      endOvershootLimit * min(1, max(0, ($0 - overshootSpeedFloor) / max(overshootSpeedCeiling - overshootSpeedFloor, 1e-6)))
    } ?? 0
    let samples = cues?.samples ?? arcSamples
    let starts = geometry.letters(near: first, radius: endpointRadius, limit: endpointLetterLimit)
    let ends = geometry.letters(near: last, radius: endpointRadius, limit: endpointLetterLimit)
    guard !starts.isEmpty, !ends.isEmpty else { return [] }

    var scored: [String: Double] = [:]
    var template: [KeyPoint] = []
    template.reserveCapacity(32)

    func consider(text: String, id: Int?, key: some Collection<UInt8>) {
      template.removeAll(keepingCapacity: true)
      var previousByte: UInt8 = 0
      for byte in key where byte != previousByte {
        guard let center = geometry.center(byte) else { return }
        template.append(center)
        previousByte = byte
      }
      guard template.count >= 2 else { return }
      let travel = overshoot > 0 ? Self.extendLastLetter(&template, to: last, limit: overshoot, sigma: endOvershootSigma) : 0
      let languageScore = languageWeight * model.logProbability(of: text, id: id, in: context)
      // Spatial penalties, including the overshoot cost, are nonnegative apart
      // from the bounded timing credit. The current top results provide a safe
      // score bound before the more expensive path-shape alignment.
      let cutoff = scored.count >= limit ? scored.values.min()! : -.infinity
      guard let spatial = spatialScore(samples: samples, gestureLength: gestureLength, template: template, corners: corners,
                                       letterCost: cues?.letterCost, letterCredit: cues?.letterCredit ?? 0,
                                       pauses: cues?.pauses ?? [], varianceScale: cues?.varianceScale ?? 1,
                                       minimumScore: cutoff - languageScore + travel) else { return }
      let score = spatial - travel + languageScore
      if score > scored[text] ?? -.infinity { scored[text] = score }
      if scored.count > limit, let worst = scored.min(by: {
        $0.value != $1.value ? $0.value < $1.value : $0.key > $1.key
      }) { scored.removeValue(forKey: worst.key) }
    }

    // Merge the frequency-ordered endpoint buckets instead of exhausting the
    // nearest bucket first. Endpoint likelihood and unigram frequency prioritize
    // promising words while keeping the same bounded candidate budget.
    var frontier = BinaryHeap<(priority: Double, position: Int, end: Int, penalty: Double)> {
      $0.priority != $1.priority ? $0.priority > $1.priority : $0.position < $1.position
    }
    func enqueue(position: Int, end: Int, penalty: Double) {
      guard position < end else { return }
      let id = lexicon.glideWord(at: position)
      frontier.push((languageWeight * lexicon.unigramLogProbability(id) - penalty, position, end, penalty))
    }
    for start in starts {
      for end in ends {
        let bucket = lexicon.glideBucket(first: start, last: end)
        let penalty = (first.distanceSquared(to: geometry.center(start)!) + last.distanceSquared(to: geometry.center(end)!))
          / (2 * alignmentSigma * alignmentSigma)
        enqueue(position: bucket.lowerBound, end: bucket.upperBound, penalty: penalty)
      }
    }
    var examined = 0
    while examined < maximumCandidates, let next = frontier.pop() {
      examined += 1
      let id = lexicon.glideWord(at: next.position)
      let display = lexicon.display(id)
      if !model.personal.isBlocked(display) {
        let length = lexicon.keyLength(id)
        consider(text: display, id: id, key: (0..<length).lazy.map { self.lexicon.keyByte(id, $0) })
      }
      enqueue(position: next.position + 1, end: next.end, penalty: next.penalty)
    }
    // A strongly predicted word is still scored when a noisy endpoint left its
    // first or last key outside the buckets above; the spatial score decides.
    if contextSeedLimit > 0, context.history != nil {
      for (word, _) in model.predictions(in: context, limit: contextSeedLimit) {
        guard let id = lexicon.id(of: word), lexicon.flags(id).contains(.glide) else { continue }
        let length = lexicon.keyLength(id)
        consider(text: word, id: id, key: (0..<length).lazy.map { self.lexicon.keyByte(id, $0) })
      }
    }
    for entry in model.personal.knownEntries {
      let word = entry.text
      // Read the key in place; most learned words fail the endpoint check.
      let key = entry.key.utf8
      guard key.count >= 2, let head = key.first, let tail = key.last, starts.contains(head), ends.contains(tail),
            key.allSatisfy({ $0 >= 97 && $0 <= 122 }) else { continue }
      consider(text: word, id: lexicon.id(of: word), key: key)
    }
    return scored.map { GlideCandidate(text: $0.key, score: $0.value) }
      .sorted { $0.score != $1.score ? $0.score > $1.score : $0.text < $1.text }
      .prefix(limit)
      .map { $0 }
  }

  /// Speed over the last `window` seconds relative to the gesture's average speed,
  /// or `nil` when the times can't tell (missing, all equal, or too short).
  static func liftSpeed(points: [KeyPoint], times rawTimes: [Double], window: Double) -> Double? {
    guard let times = cleanTimes(rawTimes, count: points.count), let end = times.last, let start = times.first else { return nil }
    let duration = end - start
    guard duration > 2 * window else { return nil }
    let total = length(of: points)
    guard total > 0 else { return nil }
    var index = points.count - 1
    var travelled = 0.0
    repeat {
      travelled += points[index - 1].distance(to: points[index])
      index -= 1
    } while index > 0 && end - times[index] < window
    let span = end - times[index]
    guard span > 0 else { return nil }
    return (travelled / span) / (total / duration)
  }

  /// Moves the template's last letter forward along its final stroke to where
  /// the finger lifted, up to `limit` pitches, and returns the Gaussian cost.
  static func extendLastLetter(_ template: inout [KeyPoint], to lift: KeyPoint, limit: Double, sigma: Double) -> Double {
    let k = template.count
    let a = template[k - 2], b = template[k - 1]
    let dx = b.x - a.x, dy = b.y - a.y
    let norm = (dx * dx + dy * dy).squareRoot()
    guard norm > 0 else { return 0 }
    let shift = min(limit, max(0, ((lift.x - b.x) * dx + (lift.y - b.y) * dy) / norm))
    guard shift > 0 else { return 0 }
    template[k - 1] = KeyPoint(x: b.x + dx / norm * shift, y: b.y + dy / norm * shift)
    return shift * shift / (2 * sigma * sigma)
  }

  /// Log-likelihood that the swipe was meant to trace `template`, or `nil` when it
  /// clearly was not (wrong length, or a letter the swipe never passed).
  func spatialScore(samples: [KeyPoint], gestureLength: Double, template: [KeyPoint], corners: [KeyPoint] = [],
                    letterCost: [Double]? = nil, letterCredit: Double = 0, pauses: [KeyPoint] = [], varianceScale: Double = 1,
                    minimumScore: Double = -.infinity) -> Double? {
    var templateLength = 0.0
    for index in 1..<template.count { templateLength += template[index - 1].distance(to: template[index]) }
    let ratio = gestureLength / max(templateLength, 0.6)
    // Short words still require travel between distinct letters. Otherwise a
    // nearly stationary touch can fit a neighboring two-letter endpoint pair.
    if ratio < 0.5 { return nil }
    if templateLength > 1.5, ratio > 2.4 { return nil }
    if templateLength <= 1.5, gestureLength > templateLength + 3.5 { return nil }

    let k = template.count
    let alignmentScale = 2 * alignmentSigma * alignmentSigma * varianceScale * pow(Double(k) / 5, alignmentLengthExponent)
    // Interior letter speed costs are nonnegative inside the alignment. The
    // per-letter credit comes off afterwards, so the early bounds allow for it.
    let speedCredit = letterCost == nil ? 0 : Double(max(0, k - 2)) * letterCredit / alignmentScale
    let bound = -minimumScore + speedCredit + 1e-10

    // Extra travel the word doesn't account for; cutting corners short is normal.
    let logRatio = log(gestureLength / max(templateLength, 0.6))
    let lengthSigma = logRatio > 0 ? extraLengthSigma : shortenedLengthSigma
    let lengthScore = logRatio * logRatio / (2 * lengthSigma * lengthSigma)
    if lengthScore > bound { return nil }

    // Endpoint hits are part of every valid monotonic alignment. Their penalty
    // alone can safely reject candidates before scanning the interior samples.
    let endpointError = samples[0].distanceSquared(to: template[0])
      + samples[samples.count - 1].distanceSquared(to: template[k - 1])
    if endpointError / alignmentScale + lengthScore > bound { return nil }

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
    var previousRow = [Double](repeating: .infinity, count: n)
    var row = [Double](repeating: .infinity, count: n)
    previousRow[0] = samples[0].distanceSquared(to: template[0])
    for letter in 1..<k {
      let center = template[letter]
      var runningMinimum = Double.infinity
      if let letterCost, letter < k - 1 {
        for j in 0..<n {
          runningMinimum = min(runningMinimum, previousRow[j])
          row[j] = runningMinimum + samples[j].distanceSquared(to: center) + letterCost[j]
        }
      } else {
        for j in 0..<n {
          runningMinimum = min(runningMinimum, previousRow[j])
          row[j] = runningMinimum + samples[j].distanceSquared(to: center)
        }
      }
      swap(&previousRow, &row)
    }
    let alignment = previousRow[n - 1]
    let alignmentScore = alignment / (2 * alignmentSigma * alignmentSigma * varianceScale) / pow(Double(k) / 5, alignmentLengthExponent) - speedCredit

    if alignmentScore + lengthScore > -minimumScore + 1e-10 { return nil }

    // A turn the word's letters don't explain means the finger was going somewhere else.
    var cornerScore = 0.0
    for corner in corners {
      var nearest = Double.infinity
      for letter in template { nearest = min(nearest, corner.distanceSquared(to: letter)) }
      cornerScore += min(6, nearest / (2 * cornerSigma * cornerSigma))
    }
    // So does slowing down away from every letter.
    for pause in pauses {
      var nearest = Double.infinity
      for letter in template { nearest = min(nearest, pause.distanceSquared(to: letter)) }
      cornerScore += pauseWeight * min(6, nearest / (2 * pauseSigma * pauseSigma))
    }
    if alignmentScore + cornerScore + lengthScore > -minimumScore + 1e-10 { return nil }

    // How far the swipe strays from the ideal path, which rejects words that skip
    // a corner the finger clearly made.
    // Match the path in order. Taking the nearest segment independently lets a
    // word explain a loop by jumping backwards and forwards along its template.
    // This monotonic alignment has the same O(samples * letters) work as the
    // nearest-segment search, but preserves the direction of the gesture.
    var previousShape = [Double](repeating: .infinity, count: k - 1)
    var shapeRow = previousShape
    previousShape[0] = 0
    for sample in samples {
      var runningMinimum = Double.infinity
      for index in 1..<k {
        runningMinimum = min(runningMinimum, previousShape[index - 1])
        shapeRow[index - 1] = runningMinimum + Self.segmentDistanceSquared(sample, template[index - 1], template[index])
      }
      swap(&previousShape, &shapeRow)
    }
    let stray = previousShape[k - 2]
    let shapeScore = shapeWeight * stray / Double(n) / (2 * shapeSigma * shapeSigma * varianceScale)

    return -(alignmentScore + shapeScore + cornerScore + lengthScore)
  }

  /// The slowest point of each interior stretch slower than `threshold` times the
  /// median speed. The ends are excluded: touch-down and lift are anchored anyway.
  static func pauses(in samples: [KeyPoint], speeds: [Double], threshold: Double) -> [KeyPoint] {
    let n = samples.count
    let margin = max(2, n / 10)
    guard n > margin * 2 else { return [] }
    var result: [KeyPoint] = []
    var i = margin
    while i < n - margin {
      if speeds[i] < threshold {
        var best = i
        while i < n - margin, speeds[i] < threshold {
          if speeds[i] < speeds[best] { best = i }
          i += 1
        }
        result.append(samples[best])
      }
      i += 1
    }
    return result
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
