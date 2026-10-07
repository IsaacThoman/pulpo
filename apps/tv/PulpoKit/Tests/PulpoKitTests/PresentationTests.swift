import Testing
@testable import PulpoKit

@Suite("Reply segments")
struct ReplySegmentTests {
    @Test func keepsHeadingsWithTheBlockAfterThem() {
        let segments = ReplySegments.make(from: Markdown.parse("# Title\nIntro\n\n## Empty\n## Steps\n- a\n- b"))
        #expect(segments.map(\.blocks) == [
            [.heading(level: 1, text: "Title"), .paragraph("Intro")],
            [.heading(level: 2, text: "Empty")],
            [.heading(level: 2, text: "Steps"), .list(ordered: false, start: 0, items: [
                MarkdownListItem(blocks: [.paragraph("a")]), MarkdownListItem(blocks: [.paragraph("b")]),
            ])],
        ])
        #expect(segments.map(\.id) == [0, 1, 2])
    }

    @Test func splitsLongCodeAndKeepsOnlyTheTailOpen() {
        var limits = ReplySegments.Limits()
        limits.codeLines = 2
        let segments = ReplySegments.make(from: [.code(language: "py", code: "1\n2\n3\n4\n5", isComplete: false)], limits: limits)
        #expect(segments.map(\.blocks) == [
            [.code(language: "py", code: "1\n2", isComplete: true)],
            [.code(language: "py", code: "3\n4", isComplete: true)],
            [.code(language: "py", code: "5", isComplete: false)],
        ])
    }

    @Test func continuesOrderedListNumbering() {
        var limits = ReplySegments.Limits()
        limits.listItems = 2
        let items = (1...3).map { MarkdownListItem(blocks: [.paragraph("\($0)")]) }
        let segments = ReplySegments.make(from: [.list(ordered: true, start: 1, items: items)], limits: limits)
        #expect(segments.map(\.blocks) == [
            [.list(ordered: true, start: 1, items: Array(items[0..<2]))],
            [.list(ordered: true, start: 3, items: [items[2]])],
        ])
    }

    @Test func repeatsTableHeadersAcrossChunks() {
        var limits = ReplySegments.Limits()
        limits.tableRows = 1
        let segments = ReplySegments.make(from: [.table(header: ["A"], alignments: [.leading], rows: [["1"], ["2"]])], limits: limits)
        #expect(segments.map(\.blocks) == [
            [.table(header: ["A"], alignments: [.leading], rows: [["1"]])],
            [.table(header: ["A"], alignments: [.leading], rows: [["2"]])],
        ])
    }

    @Test func splitsLongParagraphsAtSentences() {
        let text = "One two three. Four five six. Seven eight nine."
        let chunks = ReplySegments.sentenceChunks(text, limit: 20)
        #expect(chunks == ["One two three.", "Four five six.", "Seven eight nine."])
        #expect(chunks.joined(separator: " ") == text)
        #expect(ReplySegments.split(.paragraph("short"), limits: .init()) == [.paragraph("short")])
    }
}

@Suite("Syntax highlighting")
struct SyntaxHighlighterTests {
    private func kinds(_ code: String, _ language: String?) -> [String: SyntaxHighlighter.Kind] {
        Dictionary(SyntaxHighlighter.runs(code, language: language).compactMap { run in run.kind.map { (run.text, $0) } }, uniquingKeysWith: { first, _ in first })
    }

    @Test func coversTheWholeSourceExactlyOnce() {
        let code = "let fruits = [\"Apple\", 'b'] // list\n/* block */ print(fruits.count + 0x1F)"
        #expect(SyntaxHighlighter.runs(code, language: "swift").map(\.text).joined() == code)
    }

    @Test func colorsSwift() {
        let result = kinds("let fruits: [String] = [\"Apple\"] // note\nprint(fruits.count + 42)", "swift")
        #expect(result["let"] == .keyword)
        #expect(result["String"] == .type)
        #expect(result["\"Apple\""] == .string)
        #expect(result["// note"] == .comment)
        #expect(result["print"] == .function)
        #expect(result["42"] == .number)
        #expect(result["fruits"] == nil)
    }

    @Test func usesHashCommentsForPython() {
        let result = kinds("def f(x):\n    return None  # nothing\ns = '''multi\nline'''", "python")
        #expect(result["def"] == .keyword)
        #expect(result["None"] == .literal)
        #expect(result["# nothing"] == .comment)
        #expect(result["'''multi\nline'''"] == .string)
    }

    @Test func doesNotTreatApostrophesOrHashesInsideWordsSpecially() {
        let runs = SyntaxHighlighter.runs("it's a#b", language: "bash")
        #expect(runs.allSatisfy { $0.kind != .string && $0.kind != .comment })
    }

    @Test func handlesUnterminatedBlocksWhileStreaming() {
        let result = kinds("x = 1 /* still typing", "js")
        #expect(result["/* still typing"] == .comment)
        let string = kinds("const s = `template\nstill going", "js")
        #expect(string["`template\nstill going"] == .string)
    }

    @Test func colorsSQLAndShell() {
        #expect(kinds("SELECT name FROM users -- all", "sql")["-- all"] == .comment)
        #expect(kinds("SELECT name FROM users", "sql")["SELECT"] == .keyword)
        #expect(kinds("echo $HOME # path", "bash")["# path"] == .comment)
    }
}
