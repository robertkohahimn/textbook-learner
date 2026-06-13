/**
 * Math helpers — pure, no DOM, so they're testable and importable anywhere
 * (slide rendering, PPTX export, prompts). KaTeX rendering itself lives in
 * components/math-text.tsx; here we only parse and do the lossy LaTeX→Unicode
 * conversion used by the PPTX exporter.
 */

export interface MathSegment {
  type: "text" | "inline" | "display";
  value: string;
}

/** Instruction shared by every generation prompt so the model emits LaTeX. */
export const MATH_INSTRUCTION =
  "MATH NOTATION: Write every mathematical symbol, variable, vector, and formula in LaTeX — " +
  "wrap inline math in $...$ and a standalone equation in $$...$$. " +
  "For example write $|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle$, never |psi> = alpha|0> + beta|1>. " +
  "Use LaTeX for Greek letters ($\\theta$), sub/superscripts ($x_0$, $2^n$), fractions ($\\frac{1}{2}$), " +
  "roots, matrices, and bra-ket notation. Do not wrap ordinary prose in $.";

function findClose(s: string, from: number, delim: "$" | "$$"): number {
  if (delim === "$$") return s.indexOf("$$", from);
  for (let j = from; j < s.length; j++) {
    if (s[j] === "$" && s[j - 1] !== "\\") return j;
  }
  return -1;
}

/**
 * Split a plain string into text and math segments on `$...$` (inline) and
 * `$$...$$` (display). `\$` is a literal dollar; a dangling or empty `$`/`$$`
 * is left as literal text so ordinary prose never breaks.
 */
export function splitMath(input: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) segments.push({ type: "text", value: buf });
    buf = "";
  };

  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\" && input[i + 1] === "$") {
      buf += "$";
      i += 2;
      continue;
    }
    if (ch === "$") {
      const display = input[i + 1] === "$";
      const delim: "$" | "$$" = display ? "$$" : "$";
      const close = findClose(input, i + delim.length, delim);
      if (close === -1) {
        buf += delim;
        i += delim.length;
        continue;
      }
      const raw = input.slice(i + delim.length, close);
      if (raw.trim() === "") {
        // Empty math: keep the delimiters as literal text.
        buf += delim + raw + delim;
        i = close + delim.length;
        continue;
      }
      flush();
      segments.push({ type: display ? "display" : "inline", value: raw.trim() });
      i = close + delim.length;
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  return segments;
}

const SYMBOLS: Record<string, string> = {
  // lower greek
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", omicron: "ο", pi: "π", varpi: "ϖ",
  rho: "ρ", varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ",
  phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  // upper greek
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π",
  Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  // operators & relations
  langle: "⟨", rangle: "⟩", otimes: "⊗", oplus: "⊕", odot: "⊙", cdot: "·",
  times: "×", div: "÷", pm: "±", mp: "∓", leq: "≤", le: "≤", geq: "≥", ge: "≥",
  neq: "≠", ne: "≠", approx: "≈", equiv: "≡", sim: "∼", propto: "∝", infty: "∞",
  partial: "∂", nabla: "∇", sum: "∑", prod: "∏", int: "∫", in: "∈", notin: "∉",
  subset: "⊂", subseteq: "⊆", supset: "⊃", cup: "∪", cap: "∩", forall: "∀",
  exists: "∃", neg: "¬", wedge: "∧", vee: "∨", rightarrow: "→", to: "→",
  leftarrow: "←", Rightarrow: "⇒", Leftarrow: "⇐", leftrightarrow: "↔",
  mapsto: "↦", dagger: "†", ddagger: "‡", star: "⋆", ast: "∗", circ: "∘",
  bullet: "•", dots: "…", ldots: "…", cdots: "⋯", hbar: "ℏ", ell: "ℓ",
  angle: "∠", perp: "⊥", parallel: "∥", prime: "′", emptyset: "∅",
  setminus: "∖", vert: "|", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉",
  sqrt: "√",
};

const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶",
  "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽",
  ")": "⁾", n: "ⁿ", i: "ⁱ",
};

const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆",
  "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍",
  ")": "₎",
};

function scriptOrParen(
  inner: string,
  map: Record<string, string>,
  marker: "^" | "_"
): string {
  const chars = [...inner];
  if (chars.length > 0 && chars.every((c) => map[c] !== undefined)) {
    return chars.map((c) => map[c]).join("");
  }
  return `${marker}(${inner})`;
}

/**
 * Best-effort LaTeX → Unicode for editable PPTX text. Symbols and simple
 * sub/superscripts convert cleanly; matrices and nested constructs degrade to
 * readable source. Not a renderer — the web and PDF use real KaTeX.
 */
export function latexToUnicode(latex: string): string {
  let s = latex;
  s = s.replace(/\\\\/g, " "); // line breaks
  s = s.replace(/\\sqrt\{([^{}]*)\}/g, "√$1");
  // Run frac twice so a frac nested in another resolves.
  for (let pass = 0; pass < 2; pass++) {
    s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  }
  s = s.replace(
    /\\(?:text|mathrm|mathbf|mathit|mathcal|boldsymbol|vec|hat|bar|tilde|operatorname)\{([^{}]*)\}/g,
    "$1"
  );
  s = s.replace(/\\qquad/g, "  ").replace(/\\quad/g, " ");
  s = s.replace(/\\left(?![a-zA-Z])/g, "").replace(/\\right(?![a-zA-Z])/g, "");
  s = s.replace(/\\[,;:!> ]/g, ""); // thin/med spaces
  s = s.replace(/\\([a-zA-Z]+)/g, (_, name: string) =>
    name in SYMBOLS ? SYMBOLS[name] : name
  );
  s = s.replace(/\^(†|‡|′|∗|⋆)/g, "$1"); // dagger-like marks need no caret
  // Single-char form first; the brace fallback emits "_(…)"/"^(…)" which the
  // single-char pass would otherwise re-consume.
  s = s.replace(/\^([^\s{}])/g, (_, ch: string) => SUP[ch] ?? "^" + ch);
  s = s.replace(/\^\{([^{}]*)\}/g, (_, inner: string) =>
    scriptOrParen(inner, SUP, "^")
  );
  s = s.replace(/_([^\s{}])/g, (_, ch: string) => SUB[ch] ?? "_" + ch);
  s = s.replace(/_\{([^{}]*)\}/g, (_, inner: string) =>
    scriptOrParen(inner, SUB, "_")
  );
  s = s.replace(/[{}]/g, "");
  return s;
}

/** Convert only the math segments of a mixed string; leave prose untouched. */
export function latexLineToUnicode(input: string): string {
  return splitMath(input)
    .map((seg) => (seg.type === "text" ? seg.value : latexToUnicode(seg.value)))
    .join("");
}
