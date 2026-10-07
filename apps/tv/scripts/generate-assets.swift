// Builds the Apple TV asset catalog's brand images from the smiley renders
// (see render-smiley.py) and vendors the web app's AI lab marks.
//
//   swift apps/tv/scripts/generate-assets.swift <renders-directory>
//
// Run from the repository root. Output replaces the generated sets in
// apps/tv/PulpoTV/Assets.xcassets.
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let arguments = CommandLine.arguments
guard arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: generate-assets.swift <renders-directory>\n".utf8))
    exit(2)
}
let renders = URL(fileURLWithPath: arguments[1])
let catalog = URL(fileURLWithPath: "apps/tv/PulpoTV/Assets.xcassets")
let webIcons = URL(fileURLWithPath: "apps/web/public/ai-icons")
let fileManager = FileManager.default
let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!

func loadImage(_ name: String) -> CGImage {
    let url = renders.appendingPathComponent(name)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        fatalError("Missing render: \(url.path)")
    }
    return image
}

let smiley = loadImage("smiley.png")
let sphere = loadImage("smiley-noface.png")
let face = loadImage("smiley-justface.png")

func canvas(_ width: Int, _ height: Int, opaque: Bool = false, draw: (CGContext) -> Void) -> CGImage {
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace,
        bitmapInfo: (opaque ? CGImageAlphaInfo.noneSkipLast : CGImageAlphaInfo.premultipliedLast).rawValue
    )!
    context.interpolationQuality = .high
    context.setShouldAntialias(true)
    draw(context)
    return context.makeImage()!
}

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(
        srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
        blue: CGFloat(hex & 0xFF) / 255, alpha: alpha
    )
}

/// Near-black with a warm glow where the smiley sits, matching the app's dark theme.
func drawBackground(_ context: CGContext, width: Int, height: Int, glowCenter: CGPoint, glowRadius: CGFloat) {
    let w = CGFloat(width), h = CGFloat(height)
    let base = CGGradient(colorsSpace: colorSpace, colors: [color(0x23232B), color(0x0E0E12), color(0x08080A)] as CFArray, locations: [0, 0.6, 1])!
    context.drawLinearGradient(base, start: CGPoint(x: 0, y: h), end: CGPoint(x: w, y: 0), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    let glow = CGGradient(colorsSpace: colorSpace, colors: [color(0xF2D43A, 0.22), color(0xF2D43A, 0.07), color(0xF2D43A, 0)] as CFArray, locations: [0, 0.45, 1])!
    context.drawRadialGradient(glow, startCenter: glowCenter, startRadius: 0, endCenter: glowCenter, endRadius: glowRadius, options: [])
}

func drawSmiley(_ image: CGImage, in context: CGContext, center: CGPoint, diameter: CGFloat, shadow: Bool) {
    // The render's sphere fills about 84% of its square frame.
    let frame = diameter / 0.84
    let rect = CGRect(x: center.x - frame / 2, y: center.y - frame / 2, width: frame, height: frame)
    context.saveGState()
    if shadow {
        context.setShadow(offset: CGSize(width: 0, height: -diameter * 0.05), blur: diameter * 0.16, color: color(0x000000, 0.55))
    }
    context.draw(image, in: rect)
    context.restoreGState()
}

func write(_ image: CGImage, to url: URL) {
    try? fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { fatalError("Could not write \(url.path)") }
}

func writeJSON(_ object: Any, to url: URL) {
    try? fileManager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    try! (data + Data("\n".utf8)).write(to: url)
}

let info = ["author": "xcode", "version": 1] as [String: Any]

// MARK: App icons (layered for the focus parallax effect)

func writeImageStack(name: String, size: (Int, Int), scales: [Int], role: String? = nil) -> [String: Any] {
    let stack = catalog.appendingPathComponent("App Icon & Top Shelf Image.brandassets/\(name).imagestack")
    let layers: [(String, (Int, Int, Int) -> CGImage)] = [
        ("Front", { w, h, _ in
            canvas(w, h) { drawSmiley(face, in: $0, center: CGPoint(x: CGFloat(w) / 2, y: CGFloat(h) * 0.5), diameter: CGFloat(h) * 0.62, shadow: false) }
        }),
        ("Middle", { w, h, _ in
            canvas(w, h) { drawSmiley(sphere, in: $0, center: CGPoint(x: CGFloat(w) / 2, y: CGFloat(h) * 0.5), diameter: CGFloat(h) * 0.62, shadow: true) }
        }),
        ("Back", { w, h, _ in
            canvas(w, h, opaque: true) {
                drawBackground($0, width: w, height: h, glowCenter: CGPoint(x: CGFloat(w) / 2, y: CGFloat(h) * 0.5), glowRadius: CGFloat(h) * 0.75)
            }
        }),
    ]
    for (layer, render) in layers {
        let directory = stack.appendingPathComponent("\(layer).imagestacklayer")
        var images: [[String: Any]] = []
        for scale in scales {
            let file = "\(layer.lowercased())@\(scale)x.png"
            write(render(size.0 * scale, size.1 * scale, scale), to: directory.appendingPathComponent("Content.imageset/\(file)"))
            images.append(["idiom": "tv", "filename": file, "scale": "\(scale)x"])
        }
        writeJSON(["images": images, "info": info], to: directory.appendingPathComponent("Content.imageset/Contents.json"))
        writeJSON(["info": info], to: directory.appendingPathComponent("Contents.json"))
    }
    writeJSON(["info": info, "layers": layers.map { ["filename": "\($0.0).imagestacklayer"] }], to: stack.appendingPathComponent("Contents.json"))
    var entry: [String: Any] = ["filename": "\(name).imagestack", "idiom": "tv", "role": role ?? "primary-app-icon", "size": "\(size.0)x\(size.1)"]
    if role == nil { entry["role"] = "primary-app-icon" }
    return entry
}

// MARK: Top Shelf (a flat banner shown when Pulpo is in the top row)

func drawWordmark(_ context: CGContext, text: String, size: CGFloat, origin: CGPoint) {
    let base = NSFont.systemFont(ofSize: size, weight: .bold)
    let font = base.fontDescriptor.withDesign(.rounded).flatMap { NSFont(descriptor: $0, size: size) } ?? base
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white, .kern: -size * 0.02]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    context.textPosition = origin
    CTLineDraw(line, context)
}

func drawTagline(_ context: CGContext, text: String, size: CGFloat, origin: CGPoint) {
    let font = NSFont.systemFont(ofSize: size, weight: .medium)
    let attributes: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor(white: 1, alpha: 0.6)]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
    context.textPosition = origin
    CTLineDraw(line, context)
}

func topShelf(width: Int, height: Int) -> CGImage {
    canvas(width, height, opaque: true) { context in
        let w = CGFloat(width), h = CGFloat(height)
        let center = CGPoint(x: w - h * 0.95, y: h * 0.5)
        drawBackground(context, width: width, height: height, glowCenter: center, glowRadius: h * 1.1)
        drawSmiley(smiley, in: context, center: center, diameter: h * 0.62, shadow: true)
        drawWordmark(context, text: "Pulpo", size: h * 0.2, origin: CGPoint(x: h * 0.42, y: h * 0.47))
        drawTagline(context, text: "Every model, on the big screen.", size: h * 0.052, origin: CGPoint(x: h * 0.43, y: h * 0.36))
    }
}

func writeTopShelf(name: String, size: (Int, Int)) -> [String: Any] {
    let directory = catalog.appendingPathComponent("App Icon & Top Shelf Image.brandassets/\(name).imageset")
    var images: [[String: Any]] = []
    for scale in [1, 2] {
        let file = "\(name.lowercased().replacingOccurrences(of: " ", with: "-"))@\(scale)x.png"
        write(topShelf(width: size.0 * scale, height: size.1 * scale), to: directory.appendingPathComponent(file))
        images.append(["idiom": "tv", "filename": file, "scale": "\(scale)x"])
    }
    writeJSON(["images": images, "info": info], to: directory.appendingPathComponent("Contents.json"))
    let role = name.contains("Wide") ? "top-shelf-image-wide" : "top-shelf-image"
    return ["filename": "\(name).imageset", "idiom": "tv", "role": role, "size": "\(size.0)x\(size.1)"]
}

try? fileManager.removeItem(at: catalog.appendingPathComponent("App Icon & Top Shelf Image.brandassets"))
let assets = [
    writeImageStack(name: "App Icon", size: (400, 240), scales: [1, 2]),
    writeImageStack(name: "App Icon - App Store", size: (1280, 768), scales: [1], role: "primary-app-icon"),
    writeTopShelf(name: "Top Shelf Image", size: (1920, 720)),
    writeTopShelf(name: "Top Shelf Image Wide", size: (2320, 720)),
]
writeJSON(["assets": assets, "info": info], to: catalog.appendingPathComponent("App Icon & Top Shelf Image.brandassets/Contents.json"))

// MARK: In-app brand mark

let markDirectory = catalog.appendingPathComponent("BrandMark.imageset")
try? fileManager.removeItem(at: markDirectory)
var markImages: [[String: Any]] = []
for scale in [1, 2] {
    let side = 320 * scale
    let file = "brand-mark@\(scale)x.png"
    write(canvas(side, side) { context in
        let crop = CGFloat(side) / 0.84
        context.draw(smiley, in: CGRect(x: (CGFloat(side) - crop) / 2, y: (CGFloat(side) - crop) / 2, width: crop, height: crop))
    }, to: markDirectory.appendingPathComponent(file))
    markImages.append(["idiom": "universal", "filename": file, "scale": "\(scale)x"])
}
writeJSON(["images": markImages, "info": info], to: markDirectory.appendingPathComponent("Contents.json"))

// MARK: AI lab and model marks (vendored from the web app)

// The marks are rasterized because the asset catalog's SVG renderer drops the
// gradients several color marks use. Requires `rsvg-convert` (Homebrew `librsvg`).
func rasterize(_ svg: URL, side: Int, to output: URL) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["rsvg-convert", "--width", "\(side)", "--height", "\(side)", "--keep-aspect-ratio", "--output", output.path, svg.path]
    try! process.run()
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { fatalError("rsvg-convert failed for \(svg.lastPathComponent); install it with `brew install librsvg`.") }
}

let iconFolder = catalog.appendingPathComponent("AI Icons")
try? fileManager.removeItem(at: iconFolder)
writeJSON(["info": info, "properties": ["provides-namespace": true]], to: iconFolder.appendingPathComponent("Contents.json"))
let svgs = try fileManager.contentsOfDirectory(atPath: webIcons.path).filter { $0.hasSuffix(".svg") }.sorted()
for svg in svgs {
    let name = String(svg.dropLast(4))
    let directory = iconFolder.appendingPathComponent("\(name).imageset")
    try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    var images: [[String: Any]] = []
    for scale in [1, 2] {
        let file = "\(name)@\(scale)x.png"
        rasterize(webIcons.appendingPathComponent(svg), side: 96 * scale, to: directory.appendingPathComponent(file))
        images.append(["idiom": "universal", "filename": file, "scale": "\(scale)x"])
    }
    writeJSON([
        "images": images,
        "info": info,
        "properties": ["template-rendering-intent": name.hasSuffix("-color") ? "original" : "template"],
    ], to: directory.appendingPathComponent("Contents.json"))
}

print("Generated \(assets.count) brand assets, the brand mark, and \(svgs.count) AI icons.")
