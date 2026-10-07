import Foundation

/// A screen-sized piece of a reply. The Siri Remote scrolls by moving focus,
/// so a long reply is split into pieces short enough to fit on screen, each
/// one a focus stop.
public struct ReplySegment: Hashable, Sendable, Identifiable {
    public let id: Int
    public let blocks: [MarkdownBlock]
}

public enum ReplySegments {
    /// Limits that keep a segment within roughly one screen at television sizes.
    public struct Limits: Sendable {
        public var codeLines = 18
        public var listItems = 6
        public var tableRows = 8
        public var paragraphCharacters = 900

        public init() {}
    }

    public static func make(from blocks: [MarkdownBlock], limits: Limits = Limits()) -> [ReplySegment] {
        var groups: [[MarkdownBlock]] = []
        var pendingHeading: MarkdownBlock?
        for block in blocks {
            let pieces = split(block, limits: limits)
            if case .heading = block {
                // A heading travels with what follows it.
                if let heading = pendingHeading { groups.append([heading]) }
                pendingHeading = block
                continue
            }
            for (index, piece) in pieces.enumerated() {
                if index == 0, let heading = pendingHeading {
                    groups.append([heading, piece])
                    pendingHeading = nil
                } else {
                    groups.append([piece])
                }
            }
        }
        if let heading = pendingHeading { groups.append([heading]) }
        return groups.enumerated().map { ReplySegment(id: $0.offset, blocks: $0.element) }
    }

    static func split(_ block: MarkdownBlock, limits: Limits) -> [MarkdownBlock] {
        switch block {
        case .code(let language, let code, let isComplete):
            let lines = code.components(separatedBy: "\n")
            guard lines.count > limits.codeLines else { return [block] }
            let chunks = stride(from: 0, to: lines.count, by: limits.codeLines).map {
                Array(lines[$0..<min($0 + limits.codeLines, lines.count)])
            }
            return chunks.enumerated().map { index, chunk in
                // Only the final chunk can still be streaming.
                .code(language: language, code: chunk.joined(separator: "\n"), isComplete: index < chunks.count - 1 || isComplete)
            }
        case .list(let ordered, let start, let items):
            guard items.count > limits.listItems else { return [block] }
            return stride(from: 0, to: items.count, by: limits.listItems).map {
                .list(ordered: ordered, start: start + $0, items: Array(items[$0..<min($0 + limits.listItems, items.count)]))
            }
        case .table(let header, let alignments, let rows):
            guard rows.count > limits.tableRows else { return [block] }
            return stride(from: 0, to: rows.count, by: limits.tableRows).map {
                .table(header: header, alignments: alignments, rows: Array(rows[$0..<min($0 + limits.tableRows, rows.count)]))
            }
        case .paragraph(let text):
            guard text.count > limits.paragraphCharacters else { return [block] }
            return sentenceChunks(text, limit: limits.paragraphCharacters).map { .paragraph($0) }
        default:
            return [block]
        }
    }

    /// Splits at sentence ends, keeping each chunk under `limit` where possible.
    static func sentenceChunks(_ text: String, limit: Int) -> [String] {
        var sentences: [String] = []
        text.enumerateSubstrings(in: text.startIndex..., options: [.bySentences, .substringNotRequired]) { _, range, _, _ in
            sentences.append(String(text[range]))
        }
        if sentences.isEmpty { sentences = [text] }
        var chunks: [String] = []
        var current = ""
        for sentence in sentences {
            if !current.isEmpty, current.count + sentence.count > limit {
                chunks.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            }
            current += sentence
        }
        if !current.isEmpty { chunks.append(current.trimmingCharacters(in: .whitespaces)) }
        return chunks
    }
}
