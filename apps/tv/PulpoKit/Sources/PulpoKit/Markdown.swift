import Foundation

/// Block-level Markdown, parsed leniently so a response renders sensibly
/// while it is still streaming (for example inside an unclosed code fence).
/// Inline formatting is left as Markdown source for the view layer.
public indirect enum MarkdownBlock: Hashable, Sendable {
    public enum Alignment: Hashable, Sendable {
        case leading, center, trailing
    }

    case heading(level: Int, text: String)
    case paragraph(String)
    case list(ordered: Bool, start: Int, items: [MarkdownListItem])
    case code(language: String?, code: String, isComplete: Bool)
    case quote([MarkdownBlock])
    case table(header: [String], alignments: [Alignment], rows: [[String]])
    case math(String)
    case rule
}

public struct MarkdownListItem: Hashable, Sendable {
    public var blocks: [MarkdownBlock]
    /// `true`/`false` for task-list items (`- [x]`), otherwise nil.
    public var checked: Bool?

    public init(blocks: [MarkdownBlock], checked: Bool? = nil) {
        self.blocks = blocks
        self.checked = checked
    }
}

public enum Markdown {
    public static func parse(_ source: String) -> [MarkdownBlock] {
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\t", with: "    ")
        var parser = Parser(lines: normalized.components(separatedBy: "\n"))
        return parser.parseBlocks()
    }

    /// Plain text for speech: formatting markers removed, code blocks skipped.
    public static func plainText(_ source: String) -> String {
        parse(source).map(plainText(of:)).filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    static func plainText(of block: MarkdownBlock) -> String {
        switch block {
        case .heading(_, let text), .paragraph(let text): return stripInline(MathText.replacingInlineMath(in: text))
        case .list(_, _, let items):
            return items.map { $0.blocks.map(plainText(of:)).joined(separator: " ") }.joined(separator: "\n")
        case .quote(let blocks): return blocks.map(plainText(of:)).joined(separator: "\n")
        case .table(let header, _, let rows):
            return ([header] + rows).map { $0.map(stripInline).joined(separator: ", ") }.joined(separator: "\n")
        case .math(let source): return MathText.unicode(source)
        case .code, .rule: return ""
        }
    }

    /// Removes inline Markdown markers, keeping link text.
    public static func stripInline(_ text: String) -> String {
        var result = text
        let replacements: [(String, String)] = [
            (#"!\[([^\]]*)\]\([^)]*\)"#, "$1"),
            (#"\[([^\]]+)\]\([^)]*\)"#, "$1"),
            (#"(\*\*|__)(.+?)\1"#, "$2"),
            (#"(\*|_)(.+?)\1"#, "$2"),
            (#"~~(.+?)~~"#, "$1"),
            (#"`([^`]+)`"#, "$1"),
            (#"<[^>]+>"#, ""),
        ]
        for (pattern, template) in replacements {
            result = result.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        return result
    }
}

private struct Parser {
    /// Quotes and lists nested deeper than this are read as plain text, so a
    /// pathological reply can't exhaust the stack here or in the views.
    static let maxDepth = 8

    let lines: [String]
    let depth: Int
    var index = 0

    init(lines: [String], depth: Int = 0) {
        self.lines = lines
        self.depth = depth
    }

    mutating func parseBlocks() -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []

        func flushParagraph() {
            let text = paragraph.map { $0.trimmingCharacters(in: .whitespaces) }.joined(separator: "\n")
            if !text.isEmpty { blocks.append(.paragraph(text)) }
            paragraph.removeAll()
        }

        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.isEmpty {
                flushParagraph()
                index += 1
                continue
            }
            // Setext headings underline the paragraph before them.
            if !paragraph.isEmpty, leadingSpaces(line) < 4 {
                if trimmed.allSatisfy({ $0 == "=" }) {
                    blocks.append(.heading(level: 1, text: paragraph.joined(separator: " ").trimmingCharacters(in: .whitespaces)))
                    paragraph.removeAll()
                    index += 1
                    continue
                }
                if trimmed.count >= 2, trimmed.allSatisfy({ $0 == "-" }) {
                    blocks.append(.heading(level: 2, text: paragraph.joined(separator: " ").trimmingCharacters(in: .whitespaces)))
                    paragraph.removeAll()
                    index += 1
                    continue
                }
            }
            if let fence = Self.fence(line) {
                flushParagraph()
                blocks.append(parseFence(fence))
                continue
            }
            if trimmed == "$$" || trimmed == "\\[" {
                flushParagraph()
                blocks.append(parseMath(closing: trimmed == "$$" ? "$$" : "\\]"))
                continue
            }
            if (trimmed.hasPrefix("$$") && trimmed.hasSuffix("$$") && trimmed.count > 4)
                || (trimmed.hasPrefix("\\[") && trimmed.hasSuffix("\\]") && trimmed.count > 4) {
                flushParagraph()
                blocks.append(.math(String(trimmed.dropFirst(2).dropLast(2)).trimmingCharacters(in: .whitespaces)))
                index += 1
                continue
            }
            if let heading = Self.heading(line) {
                flushParagraph()
                blocks.append(heading)
                index += 1
                continue
            }
            if Self.isRule(line) {
                flushParagraph()
                blocks.append(.rule)
                index += 1
                continue
            }
            if depth < Self.maxDepth, Self.quoteContent(line) != nil {
                flushParagraph()
                blocks.append(parseQuote())
                continue
            }
            if depth < Self.maxDepth, let marker = Self.listMarker(line), paragraph.isEmpty || marker.canInterruptParagraph {
                flushParagraph()
                blocks.append(parseList(first: marker))
                continue
            }
            if paragraph.isEmpty, index + 1 < lines.count, line.contains("|"),
               let alignments = Self.tableDelimiter(lines[index + 1]) {
                let header = Self.tableCells(line)
                if header.count == alignments.count {
                    blocks.append(parseTable(header: header, alignments: alignments))
                    continue
                }
            }
            paragraph.append(line)
            index += 1
        }
        flushParagraph()
        return blocks
    }

    // MARK: Code and math

    struct Fence {
        let marker: Character
        let length: Int
        let indent: Int
        let info: String
    }

    static func fence(_ line: String) -> Fence? {
        let indent = leadingSpaces(line)
        guard indent < 4 else { return nil }
        let body = line.dropFirst(indent)
        guard let marker = body.first, marker == "`" || marker == "~" else { return nil }
        let length = body.prefix { $0 == marker }.count
        guard length >= 3 else { return nil }
        let info = body.dropFirst(length).trimmingCharacters(in: .whitespaces)
        if marker == "`", info.contains("`") { return nil }
        return Fence(marker: marker, length: length, indent: indent, info: info)
    }

    mutating func parseFence(_ fence: Fence) -> MarkdownBlock {
        index += 1
        var code: [String] = []
        var closed = false
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if leadingSpaces(line) < 4, trimmed.count >= fence.length,
               trimmed.allSatisfy({ $0 == fence.marker }) {
                closed = true
                index += 1
                break
            }
            // Strip up to the fence's own indentation from content lines.
            let strip = min(fence.indent, leadingSpaces(line))
            code.append(String(line.dropFirst(strip)))
            index += 1
        }
        let language = fence.info.split(separator: " ").first.map(String.init)
        return .code(language: language?.isEmpty == false ? language : nil, code: code.joined(separator: "\n"), isComplete: closed)
    }

    mutating func parseMath(closing: String) -> MarkdownBlock {
        index += 1
        var body: [String] = []
        while index < lines.count {
            let line = lines[index]
            index += 1
            if line.trimmingCharacters(in: .whitespaces) == closing { break }
            body.append(line)
        }
        return .math(body.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // MARK: Headings and rules

    static func heading(_ line: String) -> MarkdownBlock? {
        let indent = leadingSpaces(line)
        guard indent < 4 else { return nil }
        let body = line.dropFirst(indent)
        let level = body.prefix { $0 == "#" }.count
        guard (1...6).contains(level) else { return nil }
        let rest = body.dropFirst(level)
        guard rest.isEmpty || rest.first == " " else { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        // Optional closing hashes: "## Title ##".
        if let range = text.range(of: #"\s+#+$"#, options: .regularExpression) { text.removeSubrange(range) }
        else if text.allSatisfy({ $0 == "#" }) { text = "" }
        return .heading(level: level, text: text)
    }

    static func isRule(_ line: String) -> Bool {
        guard leadingSpaces(line) < 4 else { return false }
        let compact = line.filter { !$0.isWhitespace }
        guard compact.count >= 3, let first = compact.first, "-*_".contains(first) else { return false }
        return compact.allSatisfy { $0 == first }
    }

    // MARK: Block quotes

    static func quoteContent(_ line: String) -> String? {
        let indent = leadingSpaces(line)
        guard indent < 4 else { return nil }
        var body = line.dropFirst(indent)
        guard body.first == ">" else { return nil }
        body = body.dropFirst()
        if body.first == " " { body = body.dropFirst() }
        return String(body)
    }

    mutating func parseQuote() -> MarkdownBlock {
        var content: [String] = []
        while index < lines.count, let inner = Self.quoteContent(lines[index]) {
            content.append(inner)
            index += 1
        }
        var nested = Parser(lines: content, depth: depth + 1)
        return .quote(nested.parseBlocks())
    }

    // MARK: Lists

    struct ListMarker {
        let ordered: Bool
        let bullet: Character?
        let number: Int
        let delimiter: Character?
        let indent: Int
        /// Column where the item's content starts.
        let contentOffset: Int
        let content: String

        /// Only bullets and lists starting at 1 may interrupt a paragraph.
        var canInterruptParagraph: Bool { !content.isEmpty && (!ordered || number == 1) }

        func continues(_ other: ListMarker) -> Bool {
            ordered == other.ordered && bullet == other.bullet && delimiter == other.delimiter
        }
    }

    static func listMarker(_ line: String) -> ListMarker? {
        let indent = leadingSpaces(line)
        guard indent < 4 else { return nil }
        let body = line.dropFirst(indent)
        guard let first = body.first else { return nil }
        if "-*+".contains(first) {
            let after = body.dropFirst()
            guard after.isEmpty || after.first == " " else { return nil }
            let spaces = min(after.prefix { $0 == " " }.count, 4)
            let content = after.trimmingCharacters(in: .whitespaces)
            return ListMarker(
                ordered: false, bullet: first, number: 0, delimiter: nil, indent: indent,
                contentOffset: indent + 1 + max(1, spaces), content: content
            )
        }
        let digits = body.prefix { $0.isASCII && $0.isNumber }
        guard (1...9).contains(digits.count), let number = Int(digits) else { return nil }
        let afterDigits = body.dropFirst(digits.count)
        guard let delimiter = afterDigits.first, delimiter == "." || delimiter == ")" else { return nil }
        let after = afterDigits.dropFirst()
        guard after.isEmpty || after.first == " " else { return nil }
        let spaces = min(after.prefix { $0 == " " }.count, 4)
        return ListMarker(
            ordered: true, bullet: nil, number: number, delimiter: delimiter, indent: indent,
            contentOffset: indent + digits.count + 1 + max(1, spaces),
            content: after.trimmingCharacters(in: .whitespaces)
        )
    }

    mutating func parseList(first: ListMarker) -> MarkdownBlock {
        var items: [MarkdownListItem] = []
        var marker: ListMarker? = first
        while let current = marker {
            index += 1
            var content = [current.content]
            var sawBlank = false
            // Gather the item's continuation lines.
            while index < lines.count {
                let line = lines[index]
                let trimmed = line.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty {
                    sawBlank = true
                    content.append("")
                    index += 1
                    continue
                }
                let indent = leadingSpaces(line)
                if indent >= current.contentOffset || (indent > current.indent && Self.listMarker(line) != nil) {
                    content.append(String(line.dropFirst(min(indent, current.contentOffset))))
                    sawBlank = false
                    index += 1
                    continue
                }
                if !sawBlank, Self.listMarker(line) == nil, Self.fence(line) == nil, Self.heading(line) == nil,
                   Self.quoteContent(line) == nil, !Self.isRule(line) {
                    // A lazy continuation of the item's paragraph.
                    content.append(trimmed)
                    index += 1
                    continue
                }
                break
            }
            while content.last?.isEmpty == true { content.removeLast() }
            var checked: Bool?
            if let head = content.first {
                if head.hasPrefix("[ ] ") || head == "[ ]" { checked = false }
                if head.lowercased().hasPrefix("[x] ") || head.lowercased() == "[x]" { checked = true }
                if checked != nil { content[0] = String(head.dropFirst(3)).trimmingCharacters(in: .whitespaces) }
            }
            var nested = Parser(lines: content, depth: depth + 1)
            items.append(MarkdownListItem(blocks: nested.parseBlocks(), checked: checked))

            // Skip blank lines between items of the same list.
            var lookahead = index
            while lookahead < lines.count, lines[lookahead].trimmingCharacters(in: .whitespaces).isEmpty { lookahead += 1 }
            if lookahead < lines.count, let next = Self.listMarker(lines[lookahead]), next.continues(first),
               next.indent < first.contentOffset {
                index = lookahead
                marker = next
            } else {
                marker = nil
            }
        }
        return .list(ordered: first.ordered, start: first.number, items: items)
    }

    // MARK: Tables

    static func tableDelimiter(_ line: String) -> [MarkdownBlock.Alignment]? {
        let cells = tableCells(line)
        guard !cells.isEmpty, line.contains("-") else { return nil }
        var alignments: [MarkdownBlock.Alignment] = []
        for cell in cells {
            let trimmed = cell.trimmingCharacters(in: .whitespaces)
            guard trimmed.range(of: #"^:?-+:?$"#, options: .regularExpression) != nil else { return nil }
            switch (trimmed.hasPrefix(":"), trimmed.hasSuffix(":")) {
            case (true, true): alignments.append(.center)
            case (false, true): alignments.append(.trailing)
            default: alignments.append(.leading)
            }
        }
        return alignments
    }

    static func tableCells(_ line: String) -> [String] {
        var body = line.trimmingCharacters(in: .whitespaces)
        if body.hasPrefix("|") { body.removeFirst() }
        if body.hasSuffix("|"), !body.hasSuffix("\\|") { body.removeLast() }
        var cells: [String] = []
        var current = ""
        var escaped = false
        var inCode = false
        for character in body {
            if escaped {
                current.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "`" {
                inCode.toggle()
                current.append(character)
            } else if character == "|", !inCode {
                cells.append(current.trimmingCharacters(in: .whitespaces))
                current = ""
            } else {
                current.append(character)
            }
        }
        cells.append(current.trimmingCharacters(in: .whitespaces))
        return cells
    }

    mutating func parseTable(header: [String], alignments: [MarkdownBlock.Alignment]) -> MarkdownBlock {
        index += 2
        var rows: [[String]] = []
        while index < lines.count {
            let line = lines[index]
            guard !line.trimmingCharacters(in: .whitespaces).isEmpty, line.contains("|") else { break }
            var cells = Self.tableCells(line)
            if cells.count < header.count { cells += Array(repeating: "", count: header.count - cells.count) }
            rows.append(Array(cells.prefix(header.count)))
            index += 1
        }
        return .table(header: header, alignments: alignments, rows: rows)
    }
}

private func leadingSpaces(_ line: String) -> Int {
    line.prefix { $0 == " " }.count
}
