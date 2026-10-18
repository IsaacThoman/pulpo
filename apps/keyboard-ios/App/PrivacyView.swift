import SwiftUI

/// What Full Access means for Pulpo Keyboard: what it turns on, what stays on the
/// iPhone, and the one thing that is ever sent.
struct PrivacyView: View {
  var body: some View {
    List {
      Section {
        Text("iOS shows the same warning for every keyboard that asks for Full Access, because it can't check what a keyboard does with it. Here's exactly what Pulpo Keyboard does.")
          .fixedSize(horizontal: false, vertical: true)
      }

      Section("Stays on this iPhone") {
        PrivacyRow(symbol: "lock.fill", title: "Everything you type",
                   detail: "Autocorrect, predictions, slide to type, and learned words all run on this iPhone. The keyboard itself never connects to the internet, with or without Full Access.")
        PrivacyRow(symbol: "eye.slash", title: "Passwords",
                   detail: "iOS uses its own keyboard for password fields, and Pulpo Keyboard doesn't learn from private fields like usernames and one-time codes.")
      }

      Section("What Full Access turns on") {
        PrivacyRow(symbol: "slider.horizontal.3", title: "Your settings",
                   detail: "The keyboard reads the settings you choose in this app.")
        PrivacyRow(symbol: "text.book.closed", title: "Learned words you control",
                   detail: "Learned words are kept where this app can clear them.")
        PrivacyRow(symbol: "iphone.radiowaves.left.and.right", title: "Haptic feedback",
                   detail: "A light tap as you type, if you turn it on.")
        PrivacyRow(symbol: "mic", title: "Dictation",
                   detail: "The keyboard asks this app to record, because keyboards can't use the microphone.")
      }

      Section("What's sent, and when") {
        PrivacyRow(symbol: "waveform", title: "Only dictation recordings",
                   detail: "When you tap the microphone, this app records your voice and sends the recording to your Pulpo server to be transcribed. It's billed to your Pulpo account. While the microphone is kept ready between dictations, nothing is saved or sent until you start one.")
      }

      Section("Without Full Access") {
        Text("Pulpo Keyboard still types, corrects, predicts, and slides with its default settings. Dictation and haptic feedback are off, and changes in this app don't reach the keyboard.")
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .navigationTitle("Full Access & Privacy")
    .navigationBarTitleDisplayMode(.inline)
  }
}

struct PrivacyRow: View {
  let symbol: String
  let title: String
  let detail: String
  @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 28

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Image(systemName: symbol)
        .foregroundStyle(.tint)
        .frame(width: iconWidth)
        .accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.body.weight(.semibold))
        Text(detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.vertical, 2)
    .accessibilityElement(children: .combine)
  }
}
