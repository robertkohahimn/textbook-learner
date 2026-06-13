import { describe, expect, it } from "vitest";
import { splitMath, latexToUnicode, latexLineToUnicode } from "@/lib/math";

describe("splitMath", () => {
  it("returns a single text segment for plain prose", () => {
    expect(splitMath("just plain text")).toEqual([
      { type: "text", value: "just plain text" },
    ]);
  });

  it("parses inline math", () => {
    expect(splitMath("energy $E = mc^2$ today")).toEqual([
      { type: "text", value: "energy " },
      { type: "inline", value: "E = mc^2" },
      { type: "text", value: " today" },
    ]);
  });

  it("parses display math", () => {
    expect(splitMath("see: $$\\frac{a}{b}$$")).toEqual([
      { type: "text", value: "see: " },
      { type: "display", value: "\\frac{a}{b}" },
    ]);
  });

  it("handles math at both boundaries and adjacent segments", () => {
    expect(splitMath("$a$$b$")).toEqual([
      { type: "inline", value: "a" },
      { type: "inline", value: "b" },
    ]);
  });

  it("treats an escaped dollar as a literal", () => {
    expect(splitMath("it costs \\$5 today")).toEqual([
      { type: "text", value: "it costs $5 today" },
    ]);
  });

  it("treats a dangling dollar as literal text", () => {
    expect(splitMath("a $ b with no close")).toEqual([
      { type: "text", value: "a $ b with no close" },
    ]);
  });

  it("treats empty math as literal text", () => {
    expect(splitMath("nothing $$  $$ here")).toEqual([
      { type: "text", value: "nothing $$  $$ here" },
    ]);
  });

  it("trims whitespace inside math but keeps surrounding text", () => {
    expect(splitMath("x $ a + b $ y")).toEqual([
      { type: "text", value: "x " },
      { type: "inline", value: "a + b" },
      { type: "text", value: " y" },
    ]);
  });

  it("does not treat $ inside display delimiters as a nested inline", () => {
    expect(splitMath("$$a + b$$")).toEqual([{ type: "display", value: "a + b" }]);
  });
});

describe("latexToUnicode", () => {
  it("maps greek letters", () => {
    expect(latexToUnicode("\\alpha")).toBe("α");
    expect(latexToUnicode("\\Psi")).toBe("Ψ");
    expect(latexToUnicode("\\beta + \\gamma")).toBe("β + γ");
  });

  it("maps bra-ket and operators", () => {
    expect(latexToUnicode("\\langle \\psi |")).toBe("⟨ ψ |");
    expect(latexToUnicode("a \\otimes b")).toBe("a ⊗ b");
    expect(latexToUnicode("U^\\dagger")).toBe("U†");
  });

  it("renders the canonical qubit state legibly", () => {
    expect(latexToUnicode("|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle")).toBe(
      "|ψ⟩ = α|0⟩ + β|1⟩"
    );
  });

  it("maps superscripts and subscripts", () => {
    expect(latexToUnicode("E = mc^2")).toBe("E = mc²");
    expect(latexToUnicode("x_0")).toBe("x₀");
    expect(latexToUnicode("2^{12}")).toBe("2¹²");
    expect(latexToUnicode("a_{ij}")).toBe("a_(ij)"); // letters have no subscript glyphs
  });

  it("converts fractions and roots", () => {
    expect(latexToUnicode("\\frac{1}{\\sqrt{2}}")).toBe("(1)/(√2)");
  });

  it("strips spacing macros and unwraps text/mathbf", () => {
    expect(latexToUnicode("\\left( a \\right)")).toBe("( a )");
    expect(latexToUnicode("\\mathbf{v}")).toBe("v");
    expect(latexToUnicode("\\text{state}")).toBe("state");
  });

  it("passes through plain text", () => {
    expect(latexToUnicode("just letters")).toBe("just letters");
  });
});

describe("latexLineToUnicode", () => {
  it("converts only the math segments of a mixed string", () => {
    expect(
      latexLineToUnicode("A qubit $|\\psi\\rangle$ has amplitude $\\alpha$.")
    ).toBe("A qubit |ψ⟩ has amplitude α.");
  });

  it("flattens display math inline for a text box", () => {
    expect(latexLineToUnicode("Born rule: $$P = |\\alpha|^2$$")).toBe(
      "Born rule: P = |α|²"
    );
  });

  it("leaves plain prose untouched", () => {
    expect(latexLineToUnicode("no math at all")).toBe("no math at all");
  });
});
