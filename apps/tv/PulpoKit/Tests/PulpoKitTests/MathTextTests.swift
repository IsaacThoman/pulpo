import Testing
@testable import PulpoKit

@Suite("LaTeX as Unicode")
struct MathTextTests {
    @Test(arguments: [
        (#"\text{memory} \propto \text{layers} \times \text{heads}"#, "memory ∝ layers × heads"),
        (#"E = mc^2"#, "E = mc²"),
        (#"x_{i+1} = x_i - \eta \nabla f(x_i)"#, "xᵢ₊₁ = xᵢ - η ∇ f(xᵢ)"),
        (#"\frac{a+b}{2}"#, "(a+b)/2"),
        (#"\frac{1}{n}\sum_{i=1}^{n} x_i"#, "1/n∑ᵢ₌₁ⁿ xᵢ"),
        (#"\sqrt{x^2 + y^2}"#, "√(x² + y²)"),
        (#"\sqrt[3]{8} = 2"#, "³√8 = 2"),
        (#"O(n^2) \to O(n)"#, "O(n²) → O(n)"),
        (#"\left( \frac{a}{b} \right)^{-1}"#, "( a/b )⁻¹"),
        (#"A^{T}A \in \mathbb{R}^{n \times n}"#, "AᵀA ∈ ℝ^(n × n)"),
        (#"\hat{y} \approx y"#, "ŷ ≈ y"),
        (#"\alpha, \beta \geq 0"#, "α, β ≥ 0"),
        (#"a \\ b"#, "a\nb"),
        ("x \\times\ny", "x × y"),
        (#"\begin{aligned} x &= 1 \end{aligned}"#, "x = 1"),
        (#"\unknowncommand{x}"#, "unknowncommandx"),
    ])
    func converts(latex: String, expected: String) {
        #expect(MathText.unicode(latex) == expected)
    }

    @Test func replacesInlineMathOnly() {
        #expect(MathText.replacingInlineMath(in: #"For a sequence of length \(n\):"#) == "For a sequence of length n:")
        #expect(MathText.replacingInlineMath(in: "Area is $\\pi r^2$ here") == "Area is π r² here")
        #expect(MathText.replacingInlineMath(in: "It costs $5 and $10 today") == "It costs $5 and $10 today")
        #expect(MathText.replacingInlineMath(in: "Price: $ 5") == "Price: $ 5")
        #expect(MathText.replacingInlineMath(in: "Use `$x$` literally") == "Use `$x$` literally")
        #expect(MathText.replacingInlineMath(in: "no math") == "no math")
    }

    @Test func survivesHostileInput() {
        let braces = String(repeating: "{", count: 50_000) + "x"
        #expect(MathText.unicode(braces).hasSuffix("x"))
        let fractions = String(repeating: "\\frac", count: 20_000)
        #expect(!MathText.unicode(fractions).isEmpty)
        let clock = ContinuousClock()
        let elapsed = clock.measure {
            _ = MathText.replacingInlineMath(in: String(repeating: "\\(", count: 50_000))
        }
        #expect(elapsed < .seconds(1))
    }

    @Test func parsesSingleLineDisplayMath() {
        #expect(Markdown.parse(#"\[ x^2 \]"#) == [.math("x^2")])
        #expect(Markdown.plainText("Total: \\(n^2\\)\n\n$$\n\\alpha\n$$") == "Total: n²\n\nα")
    }
}
