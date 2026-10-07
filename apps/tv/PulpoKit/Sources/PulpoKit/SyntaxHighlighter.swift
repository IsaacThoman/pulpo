import Foundation

/// A small, language-aware tokenizer for coloring code blocks. It recognizes
/// comments, strings, numbers, keywords, literals, types, and calls in the
/// languages models write most; anything else is left plain.
public enum SyntaxHighlighter {
    public enum Kind: Hashable, Sendable {
        case keyword, string, comment, number, literal, type, function
    }

    public struct Run: Hashable, Sendable {
        public let text: String
        public let kind: Kind?
    }

    public static func runs(_ code: String, language: String?) -> [Run] {
        let style = CommentStyle(language: language)
        var runs: [Run] = []
        var plain = ""
        func flush() {
            if !plain.isEmpty { runs.append(Run(text: plain, kind: nil)) }
            plain = ""
        }
        func emit(_ text: Substring, _ kind: Kind) {
            flush()
            runs.append(Run(text: String(text), kind: kind))
        }

        var index = code.startIndex
        let end = code.endIndex
        while index < end {
            let rest = code[index...]
            let character = code[index]

            if let marker = style.lineMarkers.first(where: { rest.hasPrefix($0) }), style.startsComment(marker, in: code, at: index) {
                let lineEnd = rest.firstIndex(of: "\n") ?? end
                emit(code[index..<lineEnd], .comment)
                index = lineEnd
                continue
            }
            if let (open, close) = style.blockMarkers.first(where: { rest.hasPrefix($0.0) }) {
                let searchStart = code.index(index, offsetBy: open.count)
                let closeRange = code[searchStart...].range(of: close)
                let commentEnd = closeRange?.upperBound ?? end
                emit(code[index..<commentEnd], .comment)
                index = commentEnd
                continue
            }
            if character == "\"" || character == "'" || character == "`" {
                if let stringEnd = closingQuote(character, in: code, after: index, multiline: character == "`" || rest.hasPrefix("\"\"\"")) {
                    emit(code[index..<stringEnd], .string)
                    index = stringEnd
                    continue
                }
            }
            if character.isNumber, !isIdentifierCharacter(before: index, in: code) {
                let numberEnd = rest.firstIndex { !($0.isHexDigit || $0 == "." || $0 == "_" || $0 == "x" || $0 == "X") } ?? end
                if numberEnd > index {
                    emit(code[index..<numberEnd], .number)
                    index = numberEnd
                    continue
                }
            }
            if character.isLetter || character == "_" || character == "@" || (character == "$" && style.dollarIdentifiers) {
                let wordEnd = code[code.index(after: index)...].firstIndex { !($0.isLetter || $0.isNumber || $0 == "_") } ?? end
                let word = code[index..<wordEnd]
                if keywords.contains(String(word)) {
                    emit(word, .keyword)
                } else if literals.contains(String(word)) {
                    emit(word, .literal)
                } else if wordEnd < end, code[wordEnd] == "(" {
                    emit(word, .function)
                } else if let first = word.first, first.isUppercase, word.count > 1, !word.allSatisfy({ $0.isUppercase || $0 == "_" }) {
                    emit(word, .type)
                } else {
                    plain += word
                }
                index = wordEnd
                continue
            }
            plain.append(character)
            index = code.index(after: index)
        }
        flush()
        return runs
    }

    private static func isIdentifierCharacter(before index: String.Index, in code: String) -> Bool {
        guard index > code.startIndex else { return false }
        let previous = code[code.index(before: index)]
        return previous.isLetter || previous == "_"
    }

    /// The index just past the closing quote, or nil when the string doesn't
    /// close (an apostrophe in prose, a Rust lifetime).
    private static func closingQuote(_ quote: Character, in code: String, after start: String.Index, multiline: Bool) -> String.Index? {
        let triple = String(repeating: quote, count: 3)
        if code[start...].hasPrefix(triple), quote != "`" {
            let bodyStart = code.index(start, offsetBy: 3)
            return code[bodyStart...].range(of: triple)?.upperBound ?? code.endIndex
        }
        var index = code.index(after: start)
        while index < code.endIndex {
            let character = code[index]
            if character == "\\" {
                index = code.index(after: index)
                if index < code.endIndex { index = code.index(after: index) }
                continue
            }
            if character == quote { return code.index(after: index) }
            if character == "\n", !multiline { return nil }
            index = code.index(after: index)
        }
        return multiline ? code.endIndex : nil
    }

    private struct CommentStyle {
        var lineMarkers: [String]
        var blockMarkers: [(String, String)]
        var dollarIdentifiers = false

        init(language: String?) {
            switch language?.lowercased() ?? "" {
            case "python", "py", "ruby", "rb", "sh", "bash", "shell", "zsh", "console", "yaml", "yml", "toml", "r",
                 "perl", "pl", "dockerfile", "makefile", "make", "elixir", "ex", "exs", "nix", "conf", "ini", "powershell", "ps1":
                lineMarkers = ["#"]
                blockMarkers = []
                dollarIdentifiers = true
            case "sql", "lua", "haskell", "hs":
                lineMarkers = ["--"]
                blockMarkers = [("/*", "*/")]
            case "html", "xml", "svg", "vue", "markdown", "md":
                lineMarkers = []
                blockMarkers = [("<!--", "-->")]
            case "css", "scss", "less":
                lineMarkers = []
                blockMarkers = [("/*", "*/")]
            case "php":
                lineMarkers = ["//", "#"]
                blockMarkers = [("/*", "*/")]
                dollarIdentifiers = true
            default:
                lineMarkers = ["//"]
                blockMarkers = [("/*", "*/")]
            }
        }

        /// `#` starts a comment only at a word boundary (not in `a#b` or `$#`).
        func startsComment(_ marker: String, in code: String, at index: String.Index) -> Bool {
            guard marker == "#", index > code.startIndex else { return true }
            let previous = code[code.index(before: index)]
            return previous.isWhitespace || previous == ";"
        }
    }

    static let literals: Set<String> = ["true", "false", "nil", "null", "None", "True", "False", "undefined", "NaN", "self", "this", "super", "Self"]

    static let keywords: Set<String> = [
        // Shared C-family and scripting keywords.
        "if", "else", "elif", "for", "while", "do", "switch", "case", "default", "break", "continue", "return",
        "function", "func", "fn", "def", "class", "struct", "enum", "interface", "protocol", "extension", "impl",
        "trait", "type", "typealias", "let", "var", "const", "val", "mut", "static", "public", "private",
        "protected", "internal", "fileprivate", "open", "final", "override", "abstract", "virtual", "import",
        "from", "export", "package", "module", "use", "using", "namespace", "include", "require", "new", "delete",
        "try", "catch", "finally", "throw", "throws", "rethrows", "raise", "except", "async", "await", "yield",
        "in", "of", "is", "as", "not", "and", "or", "where", "guard", "defer", "lambda", "with", "pass", "match",
        "when", "loop", "go", "chan", "select", "unsafe", "pub", "crate", "mod", "dyn", "ref", "inout", "some",
        "any", "void", "int", "float", "double", "char", "bool", "string", "long", "short", "unsigned", "signed",
        "extends", "implements", "instanceof", "typeof", "keyof", "readonly", "declare", "goto", "then", "end",
        "begin", "local", "elseif", "until", "repeat", "echo", "fi", "done", "esac", "SELECT", "FROM", "WHERE",
        "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "TABLE", "JOIN", "LEFT", "RIGHT",
        "INNER", "ON", "GROUP", "BY", "ORDER", "LIMIT", "AND", "OR", "NOT", "AS", "DISTINCT", "HAVING",
    ]
}
