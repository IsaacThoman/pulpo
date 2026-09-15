// Reuse the mobile app's artwork for the tvOS layered icon and Top Shelf.
import AppKit
import Foundation
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let source = NSImage(contentsOf: root.appendingPathComponent("../mobile/assets/pulpo-smiley.png"))!
let assets = root.appendingPathComponent("Resources/Assets.xcassets")
let brand = assets.appendingPathComponent("App Icon & Top Shelf Image.brandassets")
func json(_ path: URL, _ value: [String: Any]) throws {
    try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
    try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]).write(to: path)
}
func render(_ path: URL, _ width: Int, _ height: Int, layer: String = "composite") throws {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor(calibratedRed: 0.945, green: 0.965, blue: 0.937, alpha: 1).setFill()
    if layer != "foreground" { NSRect(x: 0, y: 0, width: width, height: height).fill() }
    let side = CGFloat(height) * 0.57
    if layer != "background" { source.draw(in: NSRect(x: (CGFloat(width)-side)/2, y: (CGFloat(height)-side)/2, width: side, height: side)) }
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: path)
}
let info: [String: Any] = ["author": "xcode", "version": 1]
try json(assets.appendingPathComponent("Contents.json"), ["info": info])
var entries: [[String: Any]] = []
for (name, width, height, role, stacked) in [("App Icon", 400, 240, "primary-app-icon", true), ("App Store Icon", 1280, 768, "primary-app-icon", true), ("Top Shelf", 1920, 720, "top-shelf-image", false), ("Top Shelf Wide", 2320, 720, "top-shelf-image-wide", false)] {
    let filename = name + (stacked ? ".imagestack" : ".imageset")
    entries.append(["filename": filename, "idiom": "tv", "role": role, "size": "\(width)x\(height)"])
    let base = brand.appendingPathComponent(filename)
    let imageSet = stacked ? base.appendingPathComponent("Background.imagestacklayer/Content.imageset") : base
    if stacked {
        try json(base.appendingPathComponent("Contents.json"), ["info": info, "layers": [["filename": "Foreground.imagestacklayer"], ["filename": "Background.imagestacklayer"]]])
        try json(base.appendingPathComponent("Background.imagestacklayer/Contents.json"), ["info": info])
    }
    try json(imageSet.appendingPathComponent("Contents.json"), ["info": info, "images": [["filename": "image.png", "idiom": "tv", "scale": "1x"]]])
    try render(imageSet.appendingPathComponent("image.png"), width, height, layer: stacked ? "background" : "composite")
    if stacked {
        let front = base.appendingPathComponent("Foreground.imagestacklayer")
        try json(front.appendingPathComponent("Contents.json"), ["info": info])
        try json(front.appendingPathComponent("Content.imageset/Contents.json"), ["info": info, "images": [["filename": "image.png", "idiom": "tv", "scale": "1x"]]])
        try render(front.appendingPathComponent("Content.imageset/image.png"), width, height, layer: "foreground")
    }
}
try json(brand.appendingPathComponent("Contents.json"), ["info": info, "assets": entries])
