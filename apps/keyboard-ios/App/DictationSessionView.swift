import SwiftUI

/// Shown when the keyboard opens the app to record. The person returns to their
/// app with the system back button; recording continues in the background.
struct DictationSessionView: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  private var dictation: DictationService { model.dictation }

  var body: some View {
    VStack(spacing: 24) {
      if dictation.startedFromKeyboard, dictation.phase == .recording, dictation.returnState == .failed {
        BackHint()
      }
      Spacer()
      status
      Spacer()
      controls
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(Color(.systemBackground))
    .onChange(of: dictation.phase) { _, phase in
      if phase == .finished || phase == .idle {
        Task {
          try? await Task.sleep(for: .seconds(phase == .finished ? 1.2 : 0.2))
          dismiss()
        }
      }
    }
  }

  @ViewBuilder private var status: some View {
    switch dictation.phase {
    case .recording:
      VStack(spacing: 18) {
        Image(systemName: "mic.fill")
          .font(.system(size: 44))
          .foregroundStyle(.tint)
          .symbolEffect(.pulse)
        Text("Listening").font(.title2.weight(.semibold))
        LevelBars(levels: dictation.levels)
          .frame(height: 64)
        if dictation.startedFromKeyboard {
          Group {
            switch dictation.returnState {
            case .finding:
              Text("Taking you back to your app…")
            case .returned(let name):
              Text("Back in \(name ?? "your app"). Your words will appear where you were typing.")
            case .failed, .none:
              Text("Go back to your app. Pulpo Keyboard keeps listening, and your words appear where you were typing.")
            }
          }
          .multilineTextAlignment(.center)
          .foregroundStyle(.secondary)
        }
      }
    case .transcribing:
      VStack(spacing: 14) {
        ProgressView()
        Text("Transcribing…").font(.title3)
      }
    case .finished:
      VStack(spacing: 10) {
        Image(systemName: "checkmark.circle.fill").font(.system(size: 44)).foregroundStyle(.green)
        Text(dictation.transcript ?? "").multilineTextAlignment(.center)
      }
    case .failed(let message):
      VStack(spacing: 10) {
        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 40)).foregroundStyle(.orange)
        Text(message).multilineTextAlignment(.center)
      }
    case .idle:
      EmptyView()
    }
  }

  @ViewBuilder private var controls: some View {
    switch dictation.phase {
    case .recording:
      HStack(spacing: 16) {
        Button(role: .cancel) {
          dictation.cancel()
        } label: {
          Text("Cancel").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        Button {
          dictation.stop()
        } label: {
          Text("Done").frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("app-dictation-done")
      }
      .controlSize(.large)
    case .failed:
      Button("Close") { dismiss() }
        .buttonStyle(.bordered)
        .controlSize(.large)
    default:
      EmptyView()
    }
  }
}

/// Points at the system's back-to-app button in the status bar.
struct BackHint: View {
  var body: some View {
    HStack(spacing: 6) {
      Image(systemName: "arrow.up.left")
      Text("Tap the back button in the corner to return")
    }
    .font(.footnote.weight(.medium))
    .foregroundStyle(.secondary)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct LevelBars: View {
  let levels: [Float]

  var body: some View {
    GeometryReader { proxy in
      let count = 28
      let recent = Array(levels.suffix(count))
      HStack(alignment: .center, spacing: 4) {
        ForEach(0..<count, id: \.self) { index in
          let offset = index - (count - recent.count)
          let level = offset >= 0 ? CGFloat(recent[offset]) : 0
          Capsule()
            .fill(offset >= 0 ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
            .frame(height: max(6, proxy.size.height * (0.1 + level * 0.9)))
        }
      }
      .frame(maxHeight: .infinity)
      .animation(.linear(duration: 0.05), value: levels)
    }
  }
}
