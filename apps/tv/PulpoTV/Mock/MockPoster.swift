#if DEBUG
import UIKit

extension MockServer {
    /// A generated "image" for the mock image-generation chat: the smiley on a
    /// retro gradient, different for each attachment.
    static func poster(_ id: String) -> Data {
        let palettes: [[UIColor]] = [
            [UIColor(red: 1.0, green: 0.55, blue: 0.25, alpha: 1), UIColor(red: 0.55, green: 0.12, blue: 0.45, alpha: 1)],
            [UIColor(red: 0.10, green: 0.55, blue: 0.85, alpha: 1), UIColor(red: 0.02, green: 0.08, blue: 0.30, alpha: 1)],
        ]
        let colors = palettes[id.unicodeScalars.reduce(0) { $0 + Int($1.value) } % palettes.count].map(\.cgColor)
        let size = CGSize(width: 768, height: 768)
        let image = UIGraphicsImageRenderer(size: size).image { context in
            let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1])!
            context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 0, y: size.height), options: [])
            for ring in 0..<6 {
                let inset = CGFloat(ring) * 60 + 40
                UIColor(white: 1, alpha: 0.06).setStroke()
                let path = UIBezierPath(ovalIn: CGRect(origin: .zero, size: size).insetBy(dx: inset, dy: inset))
                path.lineWidth = 18
                path.stroke()
            }
            UIImage(named: "BrandMark")?.draw(in: CGRect(x: 214, y: 214, width: 340, height: 340))
        }
        return image.pngData() ?? Data()
    }
}
#endif
