// Render the report glyph: Pulpo's face with its smile turned over into a frown.
//
// From the repository root, on macOS:
//     swift assets/render-frown-icons.swift
//
// The face is the trace in PulpoFaceSymbol.swift (Pulpo Keyboard's emoji key), in units of the
// head's radius about its center. The smile is flipped about the middle of its own height. Like
// the keyboard glyph, the face fills 66% of the ring's outer radius, and each ring follows its
// platform's icons:
// - iOS: SF Symbols' `circle`, written as template PNGs to the app's PulpoIcons.xcassets.
// - Web: Lucide's 24-unit grid and 2-unit stroke. Prints the face path for PulpoFrownIcon.tsx,
//   whose ring is Lucide's circle.
// - Android: Material Symbols' 24dp grid and 2dp ring. Prints the face path for pulpo_frown.xml,
//   whose ring is drawn as two opposite-wound circles.

import AppKit

func facePath() -> CGPath {
  let path = CGMutablePath()
  func curves(_ start: (CGFloat, CGFloat), _ segments: [(CGFloat, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat)], into path: CGMutablePath) {
    path.move(to: CGPoint(x: start.0, y: start.1))
    for (x, y, x1, y1, x2, y2) in segments {
      path.addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
    }
    path.closeSubpath()
  }
  // Right eye.
  curves((0.282, -0.447), [
    (0.222, -0.147, 0.168, -0.394, 0.143, -0.265),
    (0.527, -0.159, 0.291, -0.044, 0.467, -0.052),
    (0.282, -0.447, 0.618, -0.321, 0.446, -0.523),
  ], into: path)
  // Left eye.
  curves((-0.467, -0.441), [
    (-0.416, -0.076, -0.652, -0.345, -0.614, -0.076),
    (-0.227, -0.263, -0.309, -0.076, -0.245, -0.139),
    (-0.467, -0.441, -0.207, -0.394, -0.352, -0.501),
  ], into: path)
  // Smile, which spans 0.269...0.848 below the center.
  let smile = CGMutablePath()
  curves((-0.642, 0.278), [
    (-0.333, 0.77, -0.684, 0.433, -0.54, 0.661),
    (0.564, 0.515, -0.011, 0.939, 0.401, 0.823),
    (0.6, 0.27, 0.605, 0.439, 0.626, 0.297),
    (0.49, 0.373, 0.589, 0.261, 0.518, 0.328),
    (-0.171, 0.628, 0.364, 0.571, 0.052, 0.691),
    (-0.527, 0.373, -0.297, 0.593, -0.462, 0.475),
    (-0.642, 0.278, -0.569, 0.307, -0.635, 0.253),
  ], into: smile)
  let frown = CGAffineTransform(translationX: 0, y: 0.269 + 0.848).scaledBy(x: 1, y: -1)
  path.addPath(smile, transform: frown)
  return path
}

func pathData(_ path: CGPath, center: CGFloat, radius: CGFloat, separator: String = " ") -> String {
  func f(_ value: CGFloat) -> String {
    var text = String(format: "%.3f", value)
    while text.hasSuffix("0") { text.removeLast() }
    if text.hasSuffix(".") { text.removeLast() }
    return text == "-0" ? "0" : text
  }
  func p(_ point: CGPoint) -> String { "\(f(center + point.x * radius)),\(f(center + point.y * radius))" }
  var parts: [String] = []
  path.applyWithBlock { element in
    let points = element.pointee.points
    switch element.pointee.type {
    case .moveToPoint: parts.append("M\(p(points[0]))")
    case .addLineToPoint: parts.append("L\(p(points[0]))")
    case .addQuadCurveToPoint: parts.append("Q\(p(points[0]))\(separator)\(p(points[1]))")
    case .addCurveToPoint: parts.append("C\(p(points[0]))\(separator)\(p(points[1]))\(separator)\(p(points[2]))")
    case .closeSubpath: parts.append("Z")
    @unknown default: break
    }
  }
  return parts.joined(separator: separator)
}

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let catalog = root.appendingPathComponent("apps/mobile/assets/ios/PulpoIcons.xcassets")

// iOS: the system `circle` at a menu glyph's size, centered in a 24pt canvas like the app's other
// menu images, with the face solid inside the ring as on the keyboard's light keys.
let configuration = NSImage.SymbolConfiguration(pointSize: 17, weight: .regular)
let circle = NSImage(systemSymbolName: "circle", accessibilityDescription: nil)!.withSymbolConfiguration(configuration)!
let canvas: CGFloat = 24
for (setName, fileName, color) in [("PulpoFrown", "pulpo-frown", NSColor.black), ("PulpoFrownWhite", "pulpo-frown-white", NSColor.white)] {
  let set = catalog.appendingPathComponent("\(setName).imageset")
  try FileManager.default.createDirectory(at: set, withIntermediateDirectories: true)
  for scale in [1, 2, 3] {
    let pixels = Int(canvas) * scale
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pixels, pixelsHigh: pixels, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: canvas, height: canvas)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ring = NSRect(x: (canvas - circle.size.width) / 2, y: (canvas - circle.size.height) / 2, width: circle.size.width, height: circle.size.height)
    let tinted = NSImage(size: circle.size, flipped: false) { bounds in
      circle.draw(in: bounds)
      color.set()
      bounds.fill(using: .sourceIn)
      return true
    }
    tinted.draw(in: ring)
    let context = NSGraphicsContext.current!.cgContext
    // The symbol's image is its outline, so half its smaller side is the ring's outer radius.
    let radius = min(ring.width, ring.height) / 2 * 0.66
    context.translateBy(x: canvas / 2, y: canvas / 2)
    context.scaleBy(x: radius, y: -radius)
    context.addPath(facePath())
    context.setFillColor(color.cgColor)
    context.fillPath()
    NSGraphicsContext.restoreGraphicsState()
    let suffix = scale == 1 ? "" : "@\(scale)x"
    try rep.representation(using: .png, properties: [:])!.write(to: set.appendingPathComponent("\(fileName)\(suffix).png"))
  }
  let contents = """
  {
    "images" : [
      { "filename" : "\(fileName).png", "idiom" : "universal", "scale" : "1x" },
      { "filename" : "\(fileName)@2x.png", "idiom" : "universal", "scale" : "2x" },
      { "filename" : "\(fileName)@3x.png", "idiom" : "universal", "scale" : "3x" }
    ],
    "info" : { "author" : "xcode", "version" : 1 },
    "properties" : { "template-rendering-intent" : "template" }
  }

  """
  try contents.write(to: set.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
}

// Lucide's circle is r=10 with a 2-unit stroke, so its outer radius is 11.
print("Web face path (PulpoFrownIcon.tsx):")
print(pathData(facePath(), center: 12, radius: 11 * 0.66))
// Material Symbols' outlined ring spans radius 8...10 on the 24dp grid.
print("\nAndroid face path (pulpo_frown.xml):")
print(pathData(facePath(), center: 12, radius: 10 * 0.66, separator: " "))
