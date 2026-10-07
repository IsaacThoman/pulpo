import PulpoKit
import SwiftUI

/// Identifies a focus stop inside the transcript.
enum TranscriptFocus: Hashable {
    case user(String)
    case thinking(String)
    case segment(String, Int)
    case image(String, String)

    var turnId: String {
        switch self {
        case .user(let id), .thinking(let id), .segment(let id, _), .image(let id, _): id
        }
    }
}

/// The user's message: a bubble on the right.
struct UserMessageView: View {
    let turn: TranscriptTurn
    let api: PulpoAPI
    let onSelect: () -> Void

    var body: some View {
        HStack(alignment: .bottom) {
            Spacer(minLength: 260)
            VStack(alignment: .trailing, spacing: 12) {
                Button(action: onSelect) {
                    VStack(alignment: .trailing, spacing: 18) {
                        if !turn.userAttachments.isEmpty {
                            HStack(spacing: 16) {
                                ForEach(turn.userAttachments) { attachment in
                                    if attachment.isImage {
                                        AttachmentImage(attachment: attachment, api: api)
                                            .frame(width: 220, height: 160)
                                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                                    } else {
                                        FileChip(name: attachment.name)
                                    }
                                }
                            }
                        }
                        if !turn.userText.isEmpty {
                            Text(turn.userText)
                                .font(.body)
                                .lineSpacing(7)
                                .foregroundStyle(Theme.text)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.horizontal, 36)
                    .padding(.vertical, 24)
                }
                .buttonStyle(BubbleButtonStyle())
                .accessibilityIdentifier("user-message")
                if let branch = turn.userBranch, branch.hasSiblings {
                    BranchCaption(branch: branch, noun: "Edit")
                }
            }
        }
    }
}

private struct BubbleButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Bubble(label: configuration.label, pressed: configuration.isPressed)
    }

    private struct Bubble<Label: View>: View {
        let label: Label
        let pressed: Bool
        @Environment(\.isFocused) private var isFocused

        var body: some View {
            label
                .background(
                    UnevenRoundedRectangle(topLeadingRadius: 36, bottomLeadingRadius: 36, bottomTrailingRadius: 12, topTrailingRadius: 36, style: .continuous)
                        .fill(isFocused ? Theme.userBubbleFocused : Theme.userBubble)
                        .shadow(color: .black.opacity(isFocused ? 0.3 : 0), radius: 24, y: 12)
                )
                .scaleEffect(isFocused ? 1.03 : 1, anchor: .trailing)
                .opacity(pressed ? 0.85 : 1)
                .animation(.easeOut(duration: 0.18), value: isFocused)
        }
    }
}

/// The assistant's reply: model header, optional thinking summary, and the
/// answer as a column of focusable pieces.
struct AssistantMessageView: View {
    let turn: TranscriptTurn
    let model: AIModel?
    let modelName: String
    let api: PulpoAPI
    let isSpeaking: Bool
    let onSelect: () -> Void
    let onShowThinking: () -> Void
    let onRetry: () -> Void
    let onOpenImage: (AttachmentReference) -> Void
    var focus: FocusState<TranscriptFocus?>.Binding

    var body: some View {
        let segments = ReplySegments.make(from: Markdown.parse(turn.content.text))
        VStack(alignment: .leading, spacing: 14) {
            header
            VStack(alignment: .leading, spacing: 6) {
                if hasThinking {
                    Button(action: onShowThinking) {
                        ThinkingSummary(turn: turn)
                    }
                    .buttonStyle(PlatterButtonStyle(padding: EdgeInsets(top: 10, leading: 24, bottom: 10, trailing: 24)))
                    .focused(focus, equals: .thinking(turn.id))
                    .accessibilityIdentifier("thinking-summary")
                }
                if segments.isEmpty, turn.isActive {
                    TypingIndicator()
                        .padding(.horizontal, 24)
                        .padding(.vertical, 20)
                        .accessibilityIdentifier("typing-indicator")
                }
                ForEach(segments) { segment in
                    Button(action: onSelect) {
                        MarkdownBlocksView(blocks: segment.blocks, streaming: turn.isActive && segment.id == segments.count - 1)
                    }
                    .buttonStyle(PlatterButtonStyle())
                    .focused(focus, equals: .segment(turn.id, segment.id))
                    .accessibilityIdentifier("reply-segment")
                }
                if !turn.content.attachments.isEmpty {
                    generatedFiles
                }
                if let error = turn.errorMessage {
                    ErrorBanner(message: error, retry: turn.isActive ? nil : onRetry)
                        .padding(.horizontal, 24)
                        .padding(.top, 8)
                } else if turn.isCancelled, segments.isEmpty {
                    // Nothing to select otherwise, so offer the retry directly.
                    HStack(spacing: 24) {
                        Text("Stopped before a reply was written.")
                            .font(.callout)
                            .foregroundStyle(Theme.secondaryText)
                        Button("Try Again", action: onRetry)
                            .accessibilityIdentifier("retry-stopped")
                    }
                    .padding(.horizontal, 24)
                    .padding(.top, 4)
                }
            }
            .padding(.leading, 46)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasThinking: Bool {
        turn.content.reasoning != nil || !turn.content.activities.isEmpty
    }

    private var header: some View {
        HStack(spacing: 18) {
            ModelIcon(model: model, size: 52)
            Text(modelName)
                .font(.callout.weight(.semibold))
                .foregroundStyle(Theme.text)
            Text(status)
                .font(.caption)
                .foregroundStyle(Theme.secondaryText)
            if isSpeaking {
                Image(systemName: "speaker.wave.2.fill")
                    .font(.caption)
                    .foregroundStyle(Theme.glow)
                    .symbolEffect(.variableColor.iterative, options: .repeating)
                    .accessibilityLabel("Reading aloud")
            }
            if let branch = turn.assistantBranch, branch.hasSiblings {
                BranchCaption(branch: branch, noun: "Version")
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var status: String {
        if turn.isActive {
            return turn.content.text.isEmpty ? (turn.content.reasoning != nil ? "Thinking…" : "Starting…") : "Writing…"
        }
        switch turn.status {
        case .cancelled: return "Stopped"
        case .failed: return "Didn’t finish"
        case .incomplete: return "Cut short"
        default: return RelativeTime.label(for: turn.completedAt ?? turn.createdAt)
        }
    }

    private var generatedFiles: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 30) {
                ForEach(turn.content.attachments) { attachment in
                    if attachment.isImage {
                        Button { onOpenImage(attachment) } label: {
                            AttachmentImage(attachment: attachment, api: api)
                                .frame(width: 420, height: 420)
                                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        }
                        .buttonStyle(.card)
                        .focused(focus, equals: .image(turn.id, attachment.id))
                    } else {
                        FileChip(name: attachment.name)
                    }
                }
            }
            .padding(24)
        }
        .scrollClipDisabled()
    }
}

/// "Thought for 12 seconds · Searched the web", or a live label while working.
private struct ThinkingSummary: View {
    let turn: TranscriptTurn

    var body: some View {
        HStack(spacing: 16) {
            Image(systemName: turn.content.activities.isEmpty ? "brain" : "wrench.and.screwdriver")
                .symbolEffect(.pulse, options: .repeating, isActive: isWorking)
            Text(summary)
                .lineLimit(1)
            Image(systemName: "chevron.right")
                .font(.caption2.weight(.semibold))
        }
        .font(.callout)
        .foregroundStyle(Theme.secondaryText)
    }

    private var isWorking: Bool { turn.isActive && turn.content.text.isEmpty }

    private var summary: String {
        var parts: [String] = []
        if isWorking {
            parts.append(turn.content.activities.last(where: \.isRunning)?.title ?? "Thinking")
        } else if turn.content.reasoning != nil {
            let seconds = turn.content.reasoningDurationMs.map { Double($0) / 1_000 } ?? turn.thinkingDuration
            if let seconds, seconds >= 1 {
                parts.append("Thought for \(Self.duration(seconds))")
            } else {
                parts.append("Thought it through")
            }
        }
        let tools = turn.content.activities.filter { $0.kind == .tool }
        if !isWorking, !tools.isEmpty {
            let titles = Array(NSOrderedSet(array: tools.map(\.title))) as? [String] ?? []
            parts.append(titles.count == 1 ? titles[0] : "Used \(tools.count) tools")
        }
        return parts.joined(separator: " · ")
    }

    static func duration(_ seconds: Double) -> String {
        let rounded = Int(seconds.rounded())
        if rounded < 60 { return "\(rounded) second\(rounded == 1 ? "" : "s")" }
        let minutes = rounded / 60
        return "\(minutes) minute\(minutes == 1 ? "" : "s")"
    }
}

/// "Version 2 of 3".
struct BranchCaption: View {
    let branch: BranchPosition
    let noun: String

    var body: some View {
        Text("\(noun) \(branch.index + 1) of \(branch.count)")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .background(Capsule().fill(Theme.fill))
    }
}

struct FileChip: View {
    let name: String

    var body: some View {
        Label(name, systemImage: "doc")
            .font(.caption)
            .lineLimit(1)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Capsule().fill(Theme.fill))
    }
}

/// Reasoning and tool activity for one reply.
struct ThinkingSheet: View {
    let turn: TranscriptTurn
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 36) {
                Text(turn.isActive ? "Thinking…" : "Thinking")
                    .font(.title2.weight(.bold))
                if !turn.content.activities.isEmpty {
                    VStack(alignment: .leading, spacing: 18) {
                        SectionTitle(title: "Steps")
                        ForEach(turn.content.activities) { activity in
                            Button {} label: {
                                ActivityRow(activity: activity)
                            }
                            .buttonStyle(PlatterButtonStyle())
                        }
                    }
                }
                if let reasoning = turn.content.reasoning {
                    VStack(alignment: .leading, spacing: 18) {
                        SectionTitle(title: "Reasoning")
                        ForEach(ReplySegments.make(from: Markdown.parse(reasoning))) { segment in
                            Button {} label: {
                                MarkdownBlocksView(blocks: segment.blocks)
                                    .environment(\.markdownTextColor, Theme.secondaryText)
                            }
                            .buttonStyle(PlatterButtonStyle())
                        }
                    }
                }
            }
            .frame(maxWidth: 1300, alignment: .leading)
            .frame(maxWidth: .infinity)
            .padding(80)
        }
        .background(Backdrop())
    }
}

private struct ActivityRow: View {
    let activity: ActivityItem

    var body: some View {
        HStack(alignment: .top, spacing: 22) {
            Image(systemName: icon)
                .font(.callout)
                .foregroundStyle(activity.isFailed ? Theme.critical : Theme.secondaryText)
                .frame(width: 40)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 14) {
                    Text(activity.title).font(.callout.weight(.semibold))
                    if let duration = activity.durationMs, duration >= 1_000 {
                        Text("\(duration / 1_000)s").font(.caption).foregroundStyle(Theme.tertiaryText)
                    }
                    if activity.isRunning { ProgressView().scaleEffect(0.6) }
                }
                if !activity.detail.isEmpty {
                    Text(activity.detail)
                        .font(.system(size: 22, design: .monospaced))
                        .foregroundStyle(Theme.secondaryText)
                        .lineLimit(6)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var icon: String {
        if activity.isFailed { return "exclamationmark.triangle" }
        switch activity.kind {
        case .tool: return "wrench.and.screwdriver"
        case .workspace: return "shippingbox"
        case .recall: return "clock.arrow.circlepath"
        case .compaction: return "rectangle.compress.vertical"
        }
    }
}
