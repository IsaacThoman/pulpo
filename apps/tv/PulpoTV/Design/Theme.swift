import SwiftUI

/// Pulpo's palette (apps/mobile/src/themePalettes.ts), adapted for television:
/// near-black and white with zinc neutrals. The smiley's yellow is the only
/// brand hue and is used sparingly, for live states.
enum Theme {
    static let background = Color(light: 0xF5F5F7, dark: 0x000000)
    static let backgroundTop = Color(light: 0xFBFBFD, dark: 0x101014)
    static let surface = Color(light: 0xFFFFFF, dark: 0x1C1C1E)
    static let surfaceRaised = Color(light: 0xECECEF, dark: 0x252527)
    static let separator = Color(light: 0x000000, lightAlpha: 0.09, dark: 0xFFFFFF, darkAlpha: 0.10)
    static let fill = Color(light: 0x000000, lightAlpha: 0.045, dark: 0xFFFFFF, darkAlpha: 0.075)
    static let fillStrong = Color(light: 0x000000, lightAlpha: 0.08, dark: 0xFFFFFF, darkAlpha: 0.12)
    static let text = Color(light: 0x111114, dark: 0xF7F7F8)
    static let secondaryText = Color(light: 0x68686F, dark: 0xA1A1A8)
    static let tertiaryText = Color(light: 0x99999F, dark: 0x696970)
    static let link = Color(light: 0x075FBE, dark: 0x65A7FF)
    static let critical = Color(light: 0xC5221F, dark: 0xFF8A84)
    static let criticalFill = Color(light: 0xC5221F, lightAlpha: 0.08, dark: 0xFF5C5C, darkAlpha: 0.12)
    static let success = Color(light: 0x0B7735, dark: 0x32D769)
    /// The smiley's yellow.
    static let glow = Color(light: 0x8D6B00, dark: 0xEBCE41)
    static let userBubble = Color(light: 0xE6E6EA, dark: 0x2A2A2E)
    static let userBubbleFocused = Color(light: 0xD8D8DE, dark: 0x3C3C42)
    static let codeBackground = Color(light: 0xF0F0F3, dark: 0x111114)

    /// The readable width of a conversation on a 1920-point-wide screen.
    static let transcriptWidth: CGFloat = 1_340
    static let cornerRadius: CGFloat = 28
    static let screenPadding: CGFloat = 80
}

extension Color {
    init(light: UInt32, lightAlpha: Double = 1, dark: UInt32, darkAlpha: Double = 1) {
        self.init(uiColor: UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark, alpha: darkAlpha)
                : UIColor(hex: light, alpha: lightAlpha)
        })
    }

    init?(hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(uiColor: UIColor(hex: value, alpha: 1))
    }
}

extension UIColor {
    convenience init(hex: UInt32, alpha: Double) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha
        )
    }
}

/// The app-wide backdrop: a soft vertical gradient with a faint warm glow in
/// the top-left corner, echoing the app icon.
struct Backdrop: View {
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.backgroundTop, Theme.background], startPoint: .top, endPoint: .bottom)
            RadialGradient(
                colors: [Theme.glow.opacity(colorScheme == .dark ? 0.10 : 0.06), .clear],
                center: UnitPoint(x: 0.08, y: 0.0), startRadius: 0, endRadius: 900
            )
        }
        .ignoresSafeArea()
    }
}
