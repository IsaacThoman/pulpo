import Foundation

/// The Pulpo app's dictation meter (`packages/client-core/src/dictation.ts`), so the
/// keyboard's waveform rises and settles the same way.
public enum DictationLevels {
  /// Level history length; at the sampling interval this shows roughly the last five seconds.
  public static let samples = 64
  public static let interval: TimeInterval = 0.08
  /// Horizontal distance between waveform bars, including the bar itself.
  public static let barPitch: Double = 5
  public static let barWidth: Double = 2
  public static let maximumSeconds: TimeInterval = 90
  /// Remaining seconds at which the elapsed timer starts warning about the limit.
  public static let warningSeconds: TimeInterval = 10

  private static let noiseFloorDecibels: Double = -60
  private static let noiseFloorAmplitude = pow(10, noiseFloorDecibels / 20)

  /// Converts measured dBFS to a 0–1 bar height, compressed so quiet speech stays visible.
  public static func normalized(decibels: Double) -> Float {
    guard !decibels.isNaN, decibels > noiseFloorDecibels else { return 0 }
    guard decibels < 0 else { return 1 }
    let amplitude = pow(10, decibels / 20)
    return Float(((amplitude - noiseFloorAmplitude) / (1 - noiseFloorAmplitude)).squareRoot())
  }

  /// The level of samples in -1…1 from their RMS.
  public static func normalized(rms: Float) -> Float {
    rms > 0 ? normalized(decibels: 20 * log10(Double(rms))) : 0
  }

  /// Bars needed to fill `width` while scrolling: every slot, plus the one sliding out
  /// past the left edge as the newest enters on the right.
  public static func barCount(width: Double) -> Int {
    max(2, min(samples, Int((max(0, width) / barPitch).rounded(.up)) + 1))
  }

  public static func nearsLimit(seconds: TimeInterval) -> Bool {
    seconds >= maximumSeconds - warningSeconds
  }
}
