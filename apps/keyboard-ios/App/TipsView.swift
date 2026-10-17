import SwiftUI

/// A gesture or feature that isn't visible on the keys.
struct KeyboardTip: Identifiable {
  let id: String
  let symbol: String
  let title: String
  let detail: String

  static let all: [KeyboardTip] = [
    KeyboardTip(id: "swipe", symbol: "hand.draw", title: "Slide to type",
                detail: "Slide your finger from letter to letter and lift. Pulpo Keyboard adds the spaces."),
    KeyboardTip(id: "cursor", symbol: "arrow.left.and.right.text.vertical", title: "Move the cursor",
                detail: "Touch and hold the space bar, then slide left or right."),
    KeyboardTip(id: "delete-swipe", symbol: "delete.left", title: "Delete whole words",
                detail: "Slide left from the delete key to select words, then lift to delete them. Tap Undo to bring them back."),
    KeyboardTip(id: "accents", symbol: "character", title: "Accents and symbols",
                detail: "Touch and hold a letter, like e, to type é, è, or ê. On the 123 page, hold punctuation for more symbols."),
    KeyboardTip(id: "emoji-search", symbol: "magnifyingglass", title: "Find emoji",
                detail: "Tap the emoji key, then Search Emoji. Emoji also show up as suggestions when you type words like pizza or thanks."),
    KeyboardTip(id: "one-handed", symbol: "keyboard.onehanded.right", title: "One-handed keyboard",
                detail: "Touch and hold the emoji key, slide to the left or right layout, and lift."),
    KeyboardTip(id: "period", symbol: "space", title: "Quick period",
                detail: "Double-tap the space bar to end a sentence with a period and a space."),
    KeyboardTip(id: "caps-lock", symbol: "capslock", title: "Caps Lock",
                detail: "Double-tap the shift key. Tap it again to turn it off."),
    KeyboardTip(id: "undo-correction", symbol: "arrow.uturn.backward", title: "Undo a correction",
                detail: "Tap delete right after a word is corrected to get back what you typed. Pulpo Keyboard stops correcting it."),
    KeyboardTip(id: "keep-word", symbol: "quote.opening", title: "Keep a word as typed",
                detail: "Tap the word in quotes in the suggestion bar. Pulpo Keyboard remembers words you keep, on this iPhone only."),
    KeyboardTip(id: "dictation", symbol: "mic", title: "Dictate",
                detail: "Tap the microphone above the keys to dictate with your Pulpo account. Needs Full Access."),
  ]

  /// The few shown when setup finishes.
  static var highlights: [KeyboardTip] { all.filter { ["swipe", "cursor", "delete-swipe"].contains($0.id) } }
}

struct TipRow: View {
  let tip: KeyboardTip
  @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 28

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Image(systemName: tip.symbol)
        .foregroundStyle(.tint)
        .frame(width: iconWidth)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(tip.title).font(.body.weight(.semibold))
        Text(tip.detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityIdentifier("tip-\(tip.id)")
  }
}

/// Every gesture in one place, from the home screen, Try It, and the end of setup.
struct TipsView: View {
  var body: some View {
    List {
      Section {
        ForEach(KeyboardTip.all) { TipRow(tip: $0).padding(.vertical, 2) }
      } footer: {
        Text("Try these in Try It, which works even before Pulpo Keyboard is set up.")
      }
    }
    .navigationTitle("Tips & Gestures")
    .navigationBarTitleDisplayMode(.inline)
  }
}
