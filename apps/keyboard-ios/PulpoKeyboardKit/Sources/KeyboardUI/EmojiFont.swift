#if os(iOS)
import CoreText
import UIKit

/// Fonts for labels that show emoji, whose decoded emoji images go away as the
/// keyboard moves on.
///
/// CoreText draws an emoji by decoding its image from the font's bitmap strike (the
/// 96 px strike for the picker's 30 pt on a 3x screen: 36 KB, in a 48 KB block) and
/// keeps every decoded image in a cache that belongs to the font. That cache has no
/// limit and empties only under system-wide memory pressure, not as one process
/// nears its own limit, and the system's emoji font lives as long as the process.
/// So every emoji the keyboard ever drew stayed in memory: browsing the whole picker
/// took the extension past 140 MB in the simulator, where iOS ends a keyboard at
/// about 48–70 MB.
///
/// These fonts are private copies of the face the system substitutes for emoji,
/// read from the same file, so labels draw the same pixels. A fresh copy takes over
/// every `usesPerCopy` labels, and an older copy goes, with the images it decoded,
/// once no label holds it.
enum EmojiFont {
  /// Labels one copy serves before the next copy takes over. Each copy holds up to
  /// this many decoded images (0.75 MB at the picker's size) until its last label lets go.
  static let usesPerCopy = 16

  /// The emoji face at `size`, for a label about to show different emoji. The
  /// system font draws the same emoji, but keeps them; it is the fallback when
  /// no copy can be made.
  static func ofSize(_ size: CGFloat) -> UIFont {
    if current == nil || current!.uses >= usesPerCopy { current = Copy.make() }
    guard var copy = current else { return .systemFont(ofSize: size) }
    let font = copy.fonts[size] ?? CTFontCreateWithFontDescriptor(copy.descriptor, size, nil) as UIFont
    copy.fonts[size] = font
    copy.uses += 1
    current = copy
    return font
  }

  /// Lets go of the current copy; its images go once no label holds it.
  static func releaseCurrent() {
    current = nil
  }

  private struct Copy {
    let descriptor: CTFontDescriptor
    var fonts: [CGFloat: UIFont] = [:]
    var uses = 0

    /// A new copy of the system's emoji face. Mapping the font file costs no memory
    /// of its own; it is already mapped for the system font.
    static func make() -> Copy? {
      guard let face, let data = try? Data(contentsOf: face.url, options: .alwaysMapped),
            let descriptors = CTFontManagerCreateFontDescriptorsFromData(data as CFData) as? [CTFontDescriptor],
            let descriptor = descriptors.first(where: { CTFontDescriptorCopyAttribute($0, kCTFontNameAttribute) as? String == face.name })
      else {
        face = nil
        PerfLog.event("emojiFontUnavailable")
        return nil
      }
      return Copy(descriptor: descriptor)
    }
  }

  private static var current: Copy?

  /// The font file and name of the face the system font falls back to for emoji;
  /// nil once a copy can't be made, so the system font serves from then on.
  private static var face: (url: URL, name: String)? = {
    let system = UIFont.systemFont(ofSize: 30) as CTFont
    let emoji = CTFontCreateForString(system, "😀" as CFString, CFRange(location: 0, length: 2))
    guard CTFontGetSymbolicTraits(emoji).contains(.traitColorGlyphs),
          let url = CTFontCopyAttribute(emoji, kCTFontURLAttribute) as? URL else { return nil }
    return (url, CTFontCopyPostScriptName(emoji) as String)
  }()
}

/// An emoji as a label would draw it: `image`, cut to the drawn pixels, sits at
/// `frame` in the label's box.
struct DrawnEmoji {
  let image: UIImage
  let frame: CGRect
}

/// Emoji drawn once into images, the way a centered label in a box of a given
/// size draws them, for the most recently shown ones.
///
/// A view that drew its emoji with a label would keep a backing store (two after
/// a redraw, in the iOS 18 simulator) and, through its font, the decoded emoji. A
/// view that shows an image keeps only the image, which it shares with this cache,
/// and the one label that draws here holds a single `EmojiFont` copy. Scrolling
/// back, or a search that finds the same emoji again, draws nothing new.
final class EmojiImages {
  let pointSize: CGFloat
  /// How many of the latest images to keep; views keep the ones they show.
  let limit: Int
  private let label = UILabel()
  private var images: [String: (drawn: DrawnEmoji, used: Int)] = [:]
  private var uses = 0
  private var drawing: (size: CGSize, scale: CGFloat)?

  init(pointSize: CGFloat, limit: Int) {
    self.pointSize = pointSize
    self.limit = limit
    label.textAlignment = .center
  }

  /// `emoji` as a centered label `size` points large draws it on a display with `traits`.
  func image(_ emoji: String, size: CGSize, traits: UITraitCollection) -> DrawnEmoji {
    guard size.width > 0, size.height > 0 else { return DrawnEmoji(image: UIImage(), frame: .zero) }
    if let drawing, drawing != (size, traits.displayScale) { images = [:] }
    drawing = (size, traits.displayScale)
    uses += 1
    if let cached = images[emoji] {
      images[emoji]?.used = uses
      return cached.drawn
    }
    let drawn = draw(emoji, size: size, traits: traits)
    if images.count >= limit, let oldest = images.min(by: { $0.value.used < $1.value.used })?.key {
      images[oldest] = nil
    }
    images[emoji] = (drawn, uses)
    return drawn
  }

  private func draw(_ emoji: String, size: CGSize, traits: UITraitCollection) -> DrawnEmoji {
    // A scroll can draw a screenful at once; free each full-size box right away.
    autoreleasepool {
      label.frame = CGRect(origin: .zero, size: size)
      label.font = EmojiFont.ofSize(pointSize)
      label.text = emoji
      let format = UIGraphicsImageRendererFormat(for: traits)
      // A label draws emoji into an 8-bit sRGB backing store. The same format shows
      // the same pixels on screen, where a wide-color display's default (16-bit
      // extended range) differed by up to 11 levels and took twice the memory.
      format.preferredRange = .standard
      format.opaque = false
      let box = UIGraphicsImageRenderer(size: size, format: format).image { _ in label.drawText(in: label.bounds) }
      // Most of the box is clear; keeping only the drawn pixels saves about a third.
      guard let cgImage = box.cgImage, let ink = Self.drawnPixels(in: cgImage) else {
        return DrawnEmoji(image: box, frame: CGRect(origin: .zero, size: size))
      }
      let frame = CGRect(x: ink.minX / box.scale, y: ink.minY / box.scale, width: ink.width / box.scale, height: ink.height / box.scale)
      let image = UIGraphicsImageRenderer(size: frame.size, format: format).image { _ in box.draw(at: CGPoint(x: -frame.minX, y: -frame.minY)) }
      return DrawnEmoji(image: image, frame: frame)
    }
  }

  /// The pixel rectangle around everything not fully transparent, or nil when
  /// nothing was drawn or the format isn't 8-bit premultiplied.
  private static func drawnPixels(in image: CGImage) -> CGRect? {
    guard image.bitsPerPixel == 32, image.bitsPerComponent == 8,
          [.premultipliedFirst, .premultipliedLast].contains(image.alphaInfo),
          let data = image.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else { return nil }
    let raw = UnsafeRawPointer(bytes)
    var minX = image.width, minY = image.height, maxX = -1, maxY = -1
    for y in 0..<image.height {
      let row = y * image.bytesPerRow
      // A premultiplied pixel is fully transparent only when all its bytes are zero.
      for x in 0..<image.width where raw.loadUnaligned(fromByteOffset: row + x * 4, as: UInt32.self) != 0 {
        minX = min(minX, x)
        maxX = max(maxX, x)
        minY = min(minY, y)
        maxY = y
      }
    }
    guard maxX >= minX else { return nil }
    return CGRect(x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1)
  }

  /// Lets go of the images, except where views still show them, and of the font
  /// copy that drew them.
  func removeAll() {
    images = [:]
    label.text = nil
    label.font = nil
  }
}
#endif
