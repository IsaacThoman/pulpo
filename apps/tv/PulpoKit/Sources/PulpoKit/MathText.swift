import Foundation

/// Renders common LaTeX as readable Unicode text (`\frac{a}{b}` → `a/b`,
/// `x^2` → `x²`, `\alpha` → `α`). Television has no KaTeX, and models use
/// LaTeX freely, so this keeps formulas legible without a math engine.
public enum MathText {
    public static func unicode(_ latex: String) -> String {
        var converter = Converter(Array(latex))
        let result = converter.sequence(until: nil)
        return result
            .replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
            .replacingOccurrences(of: #" *\n *"#, with: "\n", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Replaces inline math (`\(…\)` and `$…$`) in Markdown text, leaving code
    /// spans and currency like "$5 and $10" alone.
    public static func replacingInlineMath(in text: String) -> String {
        guard text.contains("\\(") || text.contains("$") else { return text }
        // Searching only up to the last `\)` keeps unclosed `\(` linear.
        let lastClose = text.range(of: "\\)", options: .backwards)?.lowerBound
        var result = ""
        var index = text.startIndex
        var inCode = false
        while index < text.endIndex {
            let character = text[index]
            if character == "`" {
                inCode.toggle()
                result.append(character)
                index = text.index(after: index)
                continue
            }
            if !inCode, let lastClose, index < lastClose, text[index...].hasPrefix("\\("),
               let close = text[text.index(index, offsetBy: 2)...].range(of: "\\)") {
                result += unicode(String(text[text.index(index, offsetBy: 2)..<close.lowerBound]))
                index = close.upperBound
                continue
            }
            if !inCode, character == "$", let (formula, end) = dollarMath(in: text, at: index) {
                result += unicode(formula)
                index = end
                continue
            }
            result.append(character)
            index = text.index(after: index)
        }
        return result
    }

    private static func dollarMath(in text: String, at start: String.Index) -> (String, String.Index)? {
        let open = text.index(after: start)
        guard open < text.endIndex else { return nil }
        let first = text[open]
        // `$$` is display math; `$ ` and `$5` are prose or currency.
        guard first != "$", !first.isWhitespace, !first.isNumber else { return nil }
        if start > text.startIndex, text[text.index(before: start)] == "\\" { return nil }
        var index = open
        while index < text.endIndex, text[index] != "\n" {
            if text[index] == "$", text[text.index(before: index)] != "\\" {
                let previous = text[text.index(before: index)]
                let after = text.index(after: index)
                let followedByDigit = after < text.endIndex && text[after].isNumber
                guard !previous.isWhitespace, !followedByDigit else { return nil }
                return (String(text[open..<index]), after)
            }
            index = text.index(after: index)
        }
        return nil
    }

    // MARK: Conversion

    private struct Converter {
        /// Groups and commands nested deeper than this are kept as typed, so
        /// hostile input can't exhaust the stack.
        static let maxDepth = 24

        let characters: [Character]
        var index = 0
        var depth = 0

        init(_ characters: [Character]) {
            self.characters = characters
        }

        var atEnd: Bool { index >= characters.count }

        mutating func sequence(until terminator: Character?) -> String {
            depth += 1
            defer { depth -= 1 }
            var output = ""
            while !atEnd {
                let character = characters[index]
                if character == terminator {
                    index += 1
                    return output
                }
                guard depth <= Self.maxDepth else {
                    index += 1
                    output.append(character)
                    continue
                }
                switch character {
                case "\\":
                    output += command()
                case "{":
                    index += 1
                    output += sequence(until: "}")
                case "^":
                    index += 1
                    output += script(argument(), table: superscripts, marker: "^")
                case "_":
                    index += 1
                    output += script(argument(), table: subscripts, marker: "_")
                case "~", "&", "\n":
                    // Source line breaks are spaces in LaTeX; only `\\` breaks a line.
                    index += 1
                    output += " "
                default:
                    index += 1
                    output.append(character)
                }
            }
            return output
        }

        /// The next argument: a braced group, a command, or one character.
        mutating func argument() -> String {
            while !atEnd, characters[index] == " " { index += 1 }
            guard !atEnd else { return "" }
            let character = characters[index]
            if character == "{" {
                index += 1
                return sequence(until: "}")
            }
            if character == "\\" { return command() }
            index += 1
            return String(character)
        }

        mutating func optionalArgument() -> String? {
            guard !atEnd, characters[index] == "[" else { return nil }
            index += 1
            return sequence(until: "]")
        }

        mutating func command() -> String {
            index += 1
            guard !atEnd else { return "" }
            var name = ""
            if characters[index].isLetter {
                while !atEnd, characters[index].isLetter {
                    name.append(characters[index])
                    index += 1
                }
            } else {
                name = String(characters[index])
                index += 1
            }
            depth += 1
            defer { depth -= 1 }
            guard depth <= Self.maxDepth else { return name }
            switch name {
            case "text", "mathrm", "mathbf", "mathit", "mathsf", "mathtt", "operatorname", "textbf", "textit",
                 "textrm", "mbox", "boldsymbol", "mathcal", "mathfrak", "emph":
                return argument()
            case "mathbb":
                let content = argument()
                return doubleStruck[content] ?? content
            case "frac", "dfrac", "tfrac", "cfrac":
                let numerator = argument()
                let denominator = argument()
                return "\(grouped(numerator))/\(grouped(denominator))"
            case "sqrt":
                let degree = optionalArgument()
                let radicand = argument()
                let root = degree.map { script($0, table: superscripts, marker: "") } ?? ""
                return "\(root)√\(grouped(radicand))"
            case "hat", "widehat": return accent(argument(), "\u{0302}")
            case "bar", "overline": return accent(argument(), "\u{0304}")
            case "vec": return accent(argument(), "\u{20D7}")
            case "dot": return accent(argument(), "\u{0307}")
            case "ddot": return accent(argument(), "\u{0308}")
            case "tilde", "widetilde": return accent(argument(), "\u{0303}")
            case "left", "right", "bigl", "bigr", "Bigl", "Bigr", "big", "Big", "bigg", "Bigg":
                // `\left.` is an invisible delimiter.
                if !atEnd, characters[index] == "." { index += 1 }
                return ""
            case "displaystyle", "textstyle", "limits", "nolimits", "nonumber", "notag":
                return ""
            case "begin", "end":
                _ = argument()
                return name == "end" ? "\n" : ""
            case ",", ":", ";", " ", "quad", "qquad", "enspace": return " "
            case "!": return ""
            case "\\": return "\n"
            case "{", "}", "%", "$", "&", "#", "_": return name
            case "|": return "‖"
            default:
                return symbols[name] ?? name
            }
        }

        func grouped(_ value: String) -> String {
            let trimmed = value.trimmingCharacters(in: .whitespaces)
            let needsParentheses = trimmed.count > 1 && trimmed.contains { " +-−×·/=±".contains($0) }
            return needsParentheses ? "(\(trimmed))" : trimmed
        }

        func accent(_ value: String, _ mark: Character) -> String {
            value.count == 1 ? value + String(mark) : value
        }

        func script(_ value: String, table: [Character: Character], marker: String) -> String {
            let trimmed = value.trimmingCharacters(in: .whitespaces)
            let mapped = trimmed.compactMap { table[$0] }
            if mapped.count == trimmed.count, !trimmed.isEmpty { return String(mapped) }
            if marker.isEmpty { return trimmed }
            return trimmed.count == 1 ? marker + trimmed : "\(marker)(\(trimmed))"
        }
    }

    static let superscripts: [Character: Character] = [
        "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
        "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ", "T": "ᵀ", "x": "ˣ",
        "a": "ᵃ", "b": "ᵇ", "c": "ᶜ", "d": "ᵈ", "e": "ᵉ", "k": "ᵏ", "m": "ᵐ", "t": "ᵗ", "′": "′", "*": "*",
    ]

    static let subscripts: [Character: Character] = [
        "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
        "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎", "a": "ₐ", "e": "ₑ", "o": "ₒ", "x": "ₓ",
        "h": "ₕ", "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ", "p": "ₚ", "s": "ₛ", "t": "ₜ", "i": "ᵢ", "j": "ⱼ",
        "r": "ᵣ", "u": "ᵤ", "v": "ᵥ",
    ]

    static let doubleStruck: [String: String] = ["R": "ℝ", "N": "ℕ", "Z": "ℤ", "Q": "ℚ", "C": "ℂ", "P": "ℙ", "E": "𝔼"]

    static let symbols: [String: String] = [
        // Greek
        "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ε", "varepsilon": "ε", "zeta": "ζ",
        "eta": "η", "theta": "θ", "vartheta": "ϑ", "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν",
        "xi": "ξ", "pi": "π", "rho": "ρ", "sigma": "σ", "tau": "τ", "upsilon": "υ", "phi": "φ", "varphi": "φ",
        "chi": "χ", "psi": "ψ", "omega": "ω", "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ",
        "Pi": "Π", "Sigma": "Σ", "Phi": "Φ", "Psi": "Ψ", "Omega": "Ω",
        // Operators and relations
        "times": "×", "cdot": "·", "div": "÷", "pm": "±", "mp": "∓", "propto": "∝", "approx": "≈", "sim": "∼",
        "simeq": "≃", "cong": "≅", "equiv": "≡", "neq": "≠", "ne": "≠", "le": "≤", "leq": "≤", "ge": "≥",
        "geq": "≥", "ll": "≪", "gg": "≫", "infty": "∞", "sum": "∑", "prod": "∏", "int": "∫", "oint": "∮",
        "partial": "∂", "nabla": "∇", "forall": "∀", "exists": "∃", "in": "∈", "notin": "∉", "ni": "∋",
        "subset": "⊂", "subseteq": "⊆", "supset": "⊃", "supseteq": "⊇", "cup": "∪", "cap": "∩",
        "emptyset": "∅", "varnothing": "∅", "setminus": "∖", "land": "∧", "wedge": "∧", "lor": "∨", "vee": "∨",
        "neg": "¬", "lnot": "¬", "oplus": "⊕", "otimes": "⊗", "circ": "∘", "bullet": "•", "star": "⋆", "ast": "∗",
        // Arrows
        "to": "→", "rightarrow": "→", "leftarrow": "←", "gets": "←", "Rightarrow": "⇒", "Leftarrow": "⇐",
        "implies": "⇒", "impliedby": "⇐", "leftrightarrow": "↔", "Leftrightarrow": "⇔", "iff": "⇔",
        "mapsto": "↦", "uparrow": "↑", "downarrow": "↓", "longrightarrow": "⟶", "longleftarrow": "⟵",
        // Dots, delimiters, and misc
        "ldots": "…", "dots": "…", "cdots": "⋯", "vdots": "⋮", "ddots": "⋱", "langle": "⟨", "rangle": "⟩",
        "lceil": "⌈", "rceil": "⌉", "lfloor": "⌊", "rfloor": "⌋", "lvert": "|", "rvert": "|", "vert": "|",
        "mid": "|", "Vert": "‖", "lVert": "‖", "rVert": "‖", "prime": "′", "degree": "°", "angle": "∠",
        "perp": "⊥", "parallel": "∥", "therefore": "∴", "because": "∵", "hbar": "ℏ", "ell": "ℓ", "Re": "ℜ",
        "Im": "ℑ", "aleph": "ℵ", "checkmark": "✓",
        // Named functions keep their names.
        "log": "log", "ln": "ln", "exp": "exp", "sin": "sin", "cos": "cos", "tan": "tan", "max": "max",
        "min": "min", "lim": "lim", "arg": "arg", "det": "det", "dim": "dim", "gcd": "gcd", "sup": "sup",
        "inf": "inf", "argmax": "argmax", "argmin": "argmin",
    ]
}
