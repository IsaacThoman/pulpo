import PulpoKit
import SwiftUI

/// The 3D smiley.
struct BrandMark: View {
    var size: CGFloat
    var glowing = false

    var body: some View {
        Image("BrandMark")
            .resizable()
            .interpolation(.high)
            .frame(width: size, height: size)
            .shadow(color: .black.opacity(0.35), radius: size * 0.08, y: size * 0.05)
            .background {
                if glowing {
                    Circle()
                        .fill(Theme.glow.opacity(0.35))
                        .blur(radius: size * 0.35)
                        .scaleEffect(1.1)
                }
            }
            .accessibilityHidden(true)
    }
}

/// A model's lab mark from the web app's icon set, or its monogram.
struct ModelIcon: View {
    var model: AIModel?
    var size: CGFloat = 44

    var body: some View {
        ZStack {
            Circle().fill(Theme.surfaceRaised)
            content
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder private var content: some View {
        if let key = model?.logoKey?.lowercased(), key == "pulpo" || key == "internal" {
            Image("BrandMark").resizable().padding(size * 0.1)
        } else if let asset = Self.asset(for: model?.logoKey) {
            Image("AI Icons/\(asset)")
                .resizable()
                .renderingMode(asset.hasSuffix("-color") ? .original : .template)
                .scaledToFit()
                .foregroundStyle(Theme.text)
                .padding(size * 0.22)
        } else {
            Text(String((model?.name ?? "?").prefix(1)).uppercased())
                .font(.system(size: size * 0.45, weight: .semibold, design: .rounded))
                .foregroundStyle(Theme.text)
        }
    }

    /// Asset names mirror `AI_ICONS` in apps/web/src/lib/ai-icons.ts.
    static func asset(for key: String?) -> String? {
        guard let key = key?.lowercased(), !key.isEmpty else { return nil }
        let aliases = ["alibaba": "qwen", "moonshot ai": "moonshot", "minimax labs": "minimax", "zhipu ai": "zhipu"]
        let name = aliases[key] ?? key
        return UIImage(named: "AI Icons/\(name)") == nil ? nil : name
    }
}

/// The signed-in user's initials on their profile color.
struct Avatar: View {
    var user: User
    var size: CGFloat = 64

    var body: some View {
        Text(user.initials)
            .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(Circle().fill(user.profileColor.flatMap(Color.init(hex:)) ?? Color(white: 0.35)))
            .accessibilityHidden(true)
    }
}

/// A value that oscillates smoothly between -1 and 1 over `period` seconds.
/// Looping effects are driven by time rather than `repeatForever`
/// animations, which would also animate any layout change of the view.
func oscillation(_ date: Date, period: Double, offset: Double = 0) -> Double {
    sin((date.timeIntervalSinceReferenceDate / period + offset) * 2 * .pi)
}

/// Three dots that pulse while a reply is on its way.
struct TypingIndicator: View {
    var color: Color = Theme.secondaryText

    var body: some View {
        TimelineView(.animation) { context in
            HStack(spacing: 10) {
                ForEach(0..<3, id: \.self) { index in
                    let wave = (oscillation(context.date, period: 1.1, offset: -Double(index) * 0.18) + 1) / 2
                    Circle()
                        .fill(color)
                        .frame(width: 14, height: 14)
                        .opacity(0.25 + 0.75 * wave)
                        .scaleEffect(0.7 + 0.3 * wave)
                }
            }
        }
        .accessibilityLabel("Thinking")
    }
}

/// A small pulsing dot for chats that are still generating.
struct LiveDot: View {
    var body: some View {
        TimelineView(.animation) { context in
            let progress = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.2) / 1.2
            Circle()
                .fill(Theme.glow)
                .frame(width: 14, height: 14)
                .overlay(
                    Circle().stroke(Theme.glow.opacity(0.5), lineWidth: 6)
                        .scaleEffect(1 + 1.2 * progress)
                        .opacity(1 - progress)
                )
        }
        .accessibilityLabel("Generating")
    }
}

struct SectionTitle: View {
    var title: String

    var body: some View {
        Text(title)
            .font(.headline)
            .foregroundStyle(Theme.secondaryText)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A full-screen loading state with the smiley breathing gently.
struct LoadingView: View {
    var message: String?

    var body: some View {
        VStack(spacing: 40) {
            TimelineView(.animation) { context in
                BrandMark(size: 140, glowing: true)
                    .scaleEffect(1 + 0.04 * oscillation(context.date, period: 2.8))
            }
            if let message {
                Text(message).font(.callout).foregroundStyle(Theme.secondaryText)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// A centered message for empty and failed states, with an optional action.
struct MessageState: View {
    var systemImage: String
    var title: String
    var message: String?
    var actionTitle: String?
    var action: (() -> Void)?

    var body: some View {
        VStack(spacing: 28) {
            Image(systemName: systemImage)
                .font(.system(size: 80, weight: .regular))
                .foregroundStyle(Theme.secondaryText)
            Text(title).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            if let message {
                Text(message)
                    .font(.callout)
                    .foregroundStyle(Theme.secondaryText)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 900)
            }
            if let actionTitle, let action {
                Button(actionTitle, action: action)
                    .padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// An inline error with an optional retry, used under messages and forms.
struct ErrorBanner: View {
    var message: String
    var retryTitle = "Try Again"
    var retry: (() -> Void)?

    var body: some View {
        HStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Theme.critical)
            Text(message)
                .font(.callout)
                .foregroundStyle(Theme.text)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if let retry {
                Button(retryTitle, action: retry)
            }
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 22)
        .background(RoundedRectangle(cornerRadius: 24, style: .continuous).fill(Theme.criticalFill))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).strokeBorder(Theme.critical.opacity(0.35), lineWidth: 2))
    }
}

/// Highlights a focusable, non-button region (a block of a long reply) so the
/// remote can scroll through it one piece at a time.
struct FocusPlatter: ViewModifier {
    @Environment(\.isFocused) private var isFocused
    var padding: EdgeInsets

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(isFocused ? Theme.fillStrong : .clear)
            )
            .scaleEffect(isFocused ? 1.01 : 1)
            .animation(.easeOut(duration: 0.18), value: isFocused)
    }
}

/// A plain button whose label shows a platter when focused, for message blocks.
struct PlatterButtonStyle: ButtonStyle {
    var padding = EdgeInsets(top: 14, leading: 24, bottom: 14, trailing: 24)

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(FocusPlatter(padding: padding))
            .opacity(configuration.isPressed ? 0.8 : 1)
    }
}

/// Gives a text field a visible resting shape; tvOS draws its own platter on
/// top of it while the field is focused.
struct FieldBackground: ViewModifier {
    func body(content: Content) -> some View {
        content.background(Capsule().fill(Theme.fillStrong).padding(.horizontal, -4))
    }
}

extension View {
    func fieldBackground() -> some View { modifier(FieldBackground()) }
}
