#if os(iOS)
import UIKit

/// The emoji key's glyph: Pulpo's face in a system circle, in place of `face.smiling`.
///
/// The face is `assets/highres/pulpo-smiley-justface.png` thresholded to one color and traced
/// by `assets/trace-smiley-face.py`, in units of the smiley's head radius about its center, so
/// it draws crisp at any size and takes the key's tint like a symbol. Like `face.smiling` on the
/// system keyboard, it is a ring holding a solid face on light keys and a filled circle with the
/// face cut out on dark keys.
enum PulpoFaceSymbol {
  private struct Variant: Hashable {
    let configuration: UIImage.SymbolConfiguration
    let dark: Bool
  }
  private static var cache: [Variant: UIImage] = [:]

  static func image(withConfiguration configuration: UIImage.SymbolConfiguration, dark: Bool) -> UIImage? {
    let variant = Variant(configuration: configuration, dark: dark)
    if let image = cache[variant] { return image }
    let filled = dark
    guard let circle = UIImage(systemName: filled ? "circle.fill" : "circle", withConfiguration: configuration) else { return nil }
    let bounds = CGRect(origin: .zero, size: circle.size).inset(by: circle.alignmentRectInsets)
    // The circle fills about 85% of its image. The face fits inside it with room for the ring.
    let radius = min(bounds.width, bounds.height) / 2 * (filled ? 0.8 : 0.66)
    let face = path()
    face.apply(CGAffineTransform(translationX: bounds.midX, y: bounds.midY).scaledBy(x: radius, y: radius))
    let drawn = UIGraphicsImageRenderer(size: circle.size).image { _ in
      circle.withTintColor(.black).draw(at: .zero)
      if filled { face.fill(with: .clear, alpha: 1) } else { UIColor.black.setFill(); face.fill() }
    }
    var image = drawn.withAlignmentRectInsets(circle.alignmentRectInsets).withRenderingMode(.alwaysTemplate)
    if let baseline = circle.baselineOffsetFromBottom { image = image.withBaselineOffset(fromBottom: baseline) }
    cache[variant] = image
    return image
  }

  private static func path() -> UIBezierPath {
    let path = UIBezierPath()
    func move(_ x: CGFloat, _ y: CGFloat) { path.move(to: CGPoint(x: x, y: y)) }
    func curve(_ x: CGFloat, _ y: CGFloat, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) {
      path.addCurve(to: CGPoint(x: x, y: y), controlPoint1: CGPoint(x: x1, y: y1), controlPoint2: CGPoint(x: x2, y: y2))
    }
    // Right eye.
    move(0.282, -0.447)
    curve(0.222, -0.147, 0.168, -0.394, 0.143, -0.265)
    curve(0.527, -0.159, 0.291, -0.044, 0.467, -0.052)
    curve(0.282, -0.447, 0.618, -0.321, 0.446, -0.523)
    path.close()
    // Left eye.
    move(-0.467, -0.441)
    curve(-0.416, -0.076, -0.652, -0.345, -0.614, -0.076)
    curve(-0.227, -0.263, -0.309, -0.076, -0.245, -0.139)
    curve(-0.467, -0.441, -0.207, -0.394, -0.352, -0.501)
    path.close()
    // Smile.
    move(-0.642, 0.278)
    curve(-0.333, 0.77, -0.684, 0.433, -0.54, 0.661)
    curve(0.564, 0.515, -0.011, 0.939, 0.401, 0.823)
    curve(0.6, 0.27, 0.605, 0.439, 0.626, 0.297)
    curve(0.49, 0.373, 0.589, 0.261, 0.518, 0.328)
    curve(-0.171, 0.628, 0.364, 0.571, 0.052, 0.691)
    curve(-0.527, 0.373, -0.297, 0.593, -0.462, 0.475)
    curve(-0.642, 0.278, -0.569, 0.307, -0.635, 0.253)
    path.close()
    return path
  }
}
#endif
