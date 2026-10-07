import PulpoKit
import SwiftUI

extension EnvironmentValues {
    /// The body color for Markdown text; quotes and reasoning use a quieter one.
    @Entry var markdownTextColor: Color = Theme.text
}

/// Renders parsed Markdown blocks at television reading sizes.
struct MarkdownBlocksView: View {
    let blocks: [MarkdownBlock]
    var streaming = false

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
                MarkdownBlockView(block: block, showsCursor: streaming && index == blocks.count - 1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct MarkdownBlockView: View {
    let block: MarkdownBlock
    var showsCursor = false
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        switch block {
        case .heading(let level, let text):
            InlineText(text, cursor: showsCursor)
                .font(headingFont(level))
                .padding(.top, level <= 2 ? 10 : 4)
                .accessibilityAddTraits(.isHeader)
        case .paragraph(let text):
            InlineText(text, cursor: showsCursor)
                .font(.body)
                .lineSpacing(9)
        case .list(let ordered, let start, let items):
            ListBlock(ordered: ordered, start: start, items: items, showsCursor: showsCursor)
        case .code(let language, let code, let isComplete):
            CodeBlock(language: language, code: code, isComplete: isComplete)
        case .quote(let blocks):
            HStack(alignment: .top, spacing: 26) {
                Capsule().fill(Theme.separator).frame(width: 6)
                MarkdownBlocksView(blocks: blocks, streaming: showsCursor)
                    .environment(\.markdownTextColor, Theme.secondaryText)
            }
            .fixedSize(horizontal: false, vertical: true)
        case .table(let header, let alignments, let rows):
            TableBlock(header: header, alignments: alignments, rows: rows)
        case .math(let source):
            Text(MathText.unicode(source))
                .font(.system(.title3, design: .serif))
                .foregroundStyle(Theme.text)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 32)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, alignment: .center)
                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Theme.fill))
                .accessibilityLabel(MathText.unicode(source))
        case .rule:
            Rectangle().fill(Theme.separator).frame(height: 2).padding(.vertical, 12)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.bold)
        case 2: .title3.weight(.bold)
        default: .headline.weight(.bold)
        }
    }
}

/// Inline Markdown (bold, italics, code, links, strikethrough) via Foundation,
/// with code spans restyled for a dark screen.
struct InlineText: View {
    let source: String
    var cursor = false
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.markdownTextColor) private var textColor

    init(_ source: String, cursor: Bool = false) {
        self.source = source
        self.cursor = cursor
    }

    var body: some View {
        Text(Self.attributed(source, colorScheme: colorScheme, cursor: cursor))
            .foregroundStyle(textColor)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    static func attributed(_ source: String, colorScheme: ColorScheme, cursor: Bool) -> AttributedString {
        let options = AttributedString.MarkdownParsingOptions(
            allowsExtendedAttributes: false,
            interpretedSyntax: .inlineOnlyPreservingWhitespace,
            failurePolicy: .returnPartiallyParsedIfPossible
        )
        let source = MathText.replacingInlineMath(in: source)
        var text = (try? AttributedString(markdown: source, options: options)) ?? AttributedString(source)
        for run in text.runs {
            guard let intent = run.inlinePresentationIntent else {
                if run.link != nil {
                    text[run.range].foregroundColor = Theme.link
                    text[run.range].underlineStyle = .single
                }
                continue
            }
            if intent.contains(.code) {
                text[run.range].font = .system(size: 26, design: .monospaced)
                text[run.range].backgroundColor = colorScheme == .dark ? Color.white.opacity(0.12) : Color.black.opacity(0.07)
            }
            if run.link != nil {
                text[run.range].foregroundColor = Theme.link
                text[run.range].underlineStyle = .single
            }
        }
        if cursor {
            var caret = AttributedString(" ▍")
            caret.foregroundColor = Theme.glow
            text += caret
        }
        return text
    }
}

private struct ListBlock: View {
    let ordered: Bool
    let start: Int
    let items: [MarkdownListItem]
    let showsCursor: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                HStack(alignment: .firstTextBaseline, spacing: 18) {
                    marker(index: index, item: item)
                        .frame(minWidth: ordered ? 44 : 24, alignment: .trailing)
                    MarkdownBlocksView(blocks: item.blocks, streaming: showsCursor && index == items.count - 1)
                }
            }
        }
        .padding(.leading, 8)
    }

    @ViewBuilder private func marker(index: Int, item: MarkdownListItem) -> some View {
        if let checked = item.checked {
            Image(systemName: checked ? "checkmark.square.fill" : "square")
                .foregroundStyle(checked ? Theme.success : Theme.secondaryText)
        } else if ordered {
            Text("\(start + index).")
                .font(.body.monospacedDigit().weight(.semibold))
                .foregroundStyle(Theme.secondaryText)
        } else {
            // Centered on the x-height rather than sitting on the baseline.
            Circle().fill(Theme.secondaryText).frame(width: 11, height: 11).alignmentGuide(.firstTextBaseline) { $0[.bottom] + 6 }
        }
    }
}

/// A code block with a language caption and lightweight syntax colors.
private struct CodeBlock: View {
    let language: String?
    let code: String
    let isComplete: Bool
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Image(systemName: "chevron.left.forwardslash.chevron.right")
                Text(language.map(Self.displayName) ?? "Code")
                Spacer()
                if !isComplete { ProgressView().scaleEffect(0.6).frame(height: 24) }
            }
            .font(.caption.weight(.medium))
            .foregroundStyle(Theme.secondaryText)
            .padding(.horizontal, 28)
            .padding(.vertical, 14)
            .background(Theme.fill)
            Text(highlighted)
                .font(.system(size: 25, design: .monospaced))
                .lineSpacing(6)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(28)
        }
        .background(Theme.codeBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.separator, lineWidth: 2))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(language.map(Self.displayName) ?? "Code") code")
    }

    private var highlighted: AttributedString {
        var result = AttributedString()
        for run in SyntaxHighlighter.runs(code, language: language) {
            var piece = AttributedString(run.text)
            piece.foregroundColor = run.kind.map(color) ?? Theme.text
            result += piece
        }
        return result
    }

    /// GitHub's palette, as used by the web app's code blocks.
    private func color(_ kind: SyntaxHighlighter.Kind) -> Color {
        let dark = colorScheme == .dark
        let hex: UInt32 = switch kind {
        case .keyword: dark ? 0xFF7B72 : 0xCF222E
        case .string: dark ? 0xA5D6FF : 0x0A3069
        case .comment: dark ? 0x8B949E : 0x6E7781
        case .number, .literal: dark ? 0x79C0FF : 0x0550AE
        case .type, .function: dark ? 0xD2A8FF : 0x8250DF
        }
        return Color(uiColor: UIColor(hex: hex, alpha: 1))
    }

    static func displayName(_ language: String) -> String {
        let names = [
            "js": "JavaScript", "javascript": "JavaScript", "ts": "TypeScript", "typescript": "TypeScript",
            "tsx": "TSX", "jsx": "JSX", "py": "Python", "python": "Python", "swift": "Swift", "rs": "Rust",
            "rust": "Rust", "go": "Go", "rb": "Ruby", "ruby": "Ruby", "sh": "Shell", "bash": "Bash", "zsh": "Zsh",
            "shell": "Shell", "console": "Terminal", "json": "JSON", "yaml": "YAML", "yml": "YAML", "html": "HTML",
            "css": "CSS", "sql": "SQL", "kotlin": "Kotlin", "kt": "Kotlin", "java": "Java", "c": "C", "cpp": "C++",
            "c++": "C++", "cs": "C#", "csharp": "C#", "md": "Markdown", "markdown": "Markdown", "toml": "TOML",
            "xml": "XML", "php": "PHP", "lua": "Lua", "dockerfile": "Dockerfile", "diff": "Diff", "text": "Text",
            "txt": "Text", "plaintext": "Text",
        ]
        return names[language.lowercased()] ?? language
    }
}

private struct TableBlock: View {
    let header: [String]
    let alignments: [MarkdownBlock.Alignment]
    let rows: [[String]]
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(header.enumerated()), id: \.offset) { column, cell in
                    cellView(cell, column: column).font(.callout.weight(.semibold))
                }
            }
            .background(Theme.fillStrong)
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { column, cell in
                        cellView(cell, column: column).font(.callout)
                    }
                }
                .background(index.isMultiple(of: 2) ? Color.clear : Theme.fill)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.separator, lineWidth: 2))
    }

    private func cellView(_ text: String, column: Int) -> some View {
        let alignment: Alignment = switch alignments.indices.contains(column) ? alignments[column] : .leading {
        case .leading: .leading
        case .center: .center
        case .trailing: .trailing
        }
        return Text(InlineText.attributed(text, colorScheme: colorScheme, cursor: false))
            .foregroundStyle(Theme.text)
            .multilineTextAlignment(alignment == .leading ? .leading : alignment == .center ? .center : .trailing)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: alignment)
            .padding(.horizontal, 26)
            .padding(.vertical, 16)
            .gridCellAnchor(UnitPoint(x: alignment == .leading ? 0 : alignment == .center ? 0.5 : 1, y: 0.5))
    }
}
