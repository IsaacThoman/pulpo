import Testing
@testable import PulpoKit

@Suite("Markdown blocks")
struct MarkdownTests {
    @Test func parsesParagraphsSeparatedByBlankLines() {
        #expect(Markdown.parse("Hello **world**.\nSecond line.\n\nNext paragraph") == [
            .paragraph("Hello **world**.\nSecond line."),
            .paragraph("Next paragraph"),
        ])
    }

    @Test func parsesHeadings() {
        #expect(Markdown.parse("# Title\n## Sub ##\n###### Six\n#NotAHeading") == [
            .heading(level: 1, text: "Title"),
            .heading(level: 2, text: "Sub"),
            .heading(level: 6, text: "Six"),
            .paragraph("#NotAHeading"),
        ])
        #expect(Markdown.parse("Big\n===\nSmaller\n---") == [
            .heading(level: 1, text: "Big"),
            .heading(level: 2, text: "Smaller"),
        ])
    }

    @Test func parsesFencedCode() {
        let source = "Intro\n```swift\nlet x = 1\n\nprint(x)\n```\nAfter"
        #expect(Markdown.parse(source) == [
            .paragraph("Intro"),
            .code(language: "swift", code: "let x = 1\n\nprint(x)", isComplete: true),
            .paragraph("After"),
        ])
    }

    @Test func keepsStreamingCodeOpenUntilTheFenceCloses() {
        #expect(Markdown.parse("```python\ndef f():\n    return 1") == [
            .code(language: "python", code: "def f():\n    return 1", isComplete: false),
        ])
        #expect(Markdown.parse("~~~~\n```\nstill code\n~~~~") == [
            .code(language: nil, code: "```\nstill code", isComplete: true),
        ])
    }

    @Test func parsesBulletAndOrderedLists() {
        #expect(Markdown.parse("- Apple\n- Banana\n* Other list") == [
            .list(ordered: false, start: 0, items: [
                MarkdownListItem(blocks: [.paragraph("Apple")]),
                MarkdownListItem(blocks: [.paragraph("Banana")]),
            ]),
            .list(ordered: false, start: 0, items: [MarkdownListItem(blocks: [.paragraph("Other list")])]),
        ])
        #expect(Markdown.parse("3. Three\n4. Four") == [
            .list(ordered: true, start: 3, items: [
                MarkdownListItem(blocks: [.paragraph("Three")]),
                MarkdownListItem(blocks: [.paragraph("Four")]),
            ]),
        ])
    }

    @Test func parsesNestedAndLooseListItems() {
        let source = """
        1. First
           - nested a
           - nested b
        2. Second

           continued paragraph
        """
        #expect(Markdown.parse(source) == [
            .list(ordered: true, start: 1, items: [
                MarkdownListItem(blocks: [
                    .paragraph("First"),
                    .list(ordered: false, start: 0, items: [
                        MarkdownListItem(blocks: [.paragraph("nested a")]),
                        MarkdownListItem(blocks: [.paragraph("nested b")]),
                    ]),
                ]),
                MarkdownListItem(blocks: [.paragraph("Second"), .paragraph("continued paragraph")]),
            ]),
        ])
    }

    @Test func listsSurviveBlankLinesBetweenItems() {
        #expect(Markdown.parse("- a\n\n- b") == [
            .list(ordered: false, start: 0, items: [
                MarkdownListItem(blocks: [.paragraph("a")]),
                MarkdownListItem(blocks: [.paragraph("b")]),
            ]),
        ])
    }

    @Test func parsesTaskLists() {
        #expect(Markdown.parse("- [x] Done\n- [ ] Todo") == [
            .list(ordered: false, start: 0, items: [
                MarkdownListItem(blocks: [.paragraph("Done")], checked: true),
                MarkdownListItem(blocks: [.paragraph("Todo")], checked: false),
            ]),
        ])
    }

    @Test func numbersInsideParagraphsDoNotStartLists() {
        #expect(Markdown.parse("The year was\n2024. It rained.") == [.paragraph("The year was\n2024. It rained.")])
    }

    @Test func parsesBlockQuotes() {
        #expect(Markdown.parse("> Quoted **text**\n> - item\n\nAfter") == [
            .quote([
                .paragraph("Quoted **text**"),
                .list(ordered: false, start: 0, items: [MarkdownListItem(blocks: [.paragraph("item")])]),
            ]),
            .paragraph("After"),
        ])
    }

    @Test func parsesTables() {
        let source = """
        | Model | Speed | Cost |
        |:------|:-----:|-----:|
        | A | fast | $1 |
        | B \\| C | `a|b` |
        """
        #expect(Markdown.parse(source) == [
            .table(
                header: ["Model", "Speed", "Cost"],
                alignments: [.leading, .center, .trailing],
                rows: [["A", "fast", "$1"], ["B | C", "`a|b`", ""]]
            ),
        ])
    }

    @Test func treatsAnIncompleteTableAsText() {
        #expect(Markdown.parse("| a | b |\n|---") == [.paragraph("| a | b |\n|---")])
    }

    @Test func parsesRulesAndMath() {
        #expect(Markdown.parse("Above\n\n---\n\n$$\nE = mc^2\n$$\n\\[\nx\n\\]\n$$a+b$$") == [
            .paragraph("Above"),
            .rule,
            .math("E = mc^2"),
            .math("x"),
            .math("a+b"),
        ])
    }

    @Test func producesPlainTextForSpeech() {
        let source = "# Plan\nUse **bold** and [a link](https://x.y).\n\n```\ncode()\n```\n- One\n- `Two`"
        #expect(Markdown.plainText(source) == "Plan\n\nUse bold and a link.\n\nOne\nTwo")
    }

    @Test func readsVeryDeepNestingAsText() {
        func depth(_ blocks: [MarkdownBlock]) -> Int {
            blocks.map { block in
                switch block {
                case .quote(let inner): 1 + depth(inner)
                case .list(_, _, let items): 1 + (items.map { depth($0.blocks) }.max() ?? 0)
                default: 0
                }
            }.max() ?? 0
        }
        #expect(depth(Markdown.parse(String(repeating: ">", count: 5_000) + " deep")) == 8)
        #expect(depth(Markdown.parse(String(repeating: "- ", count: 5_000) + "x")) == 8)
        #expect(depth(Markdown.parse("> > quoted")) == 2)
    }

    @Test func handlesEmptyAndWindowsInput() {
        #expect(Markdown.parse("").isEmpty)
        #expect(Markdown.parse("a\r\nb") == [.paragraph("a\nb")])
    }
}
