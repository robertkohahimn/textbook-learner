# Slide LaTeX / math rendering — design

**Date:** 2026-06-13
**Goal:** Slides (and the tutor) render mathematical notation legibly, on par with
NotebookLM. Today there is no math rendering anywhere, so notation in a book like
*Quantum Computing for Everyone* is unreadable — either raw LaTeX
(`|\psi\rangle = \alpha|0\rangle`) or cramped ASCII (`|psi> = alpha|0>`).

## Decisions

- **Engine: KaTeX.** Synchronous (no layout shift — slides must screenshot/print
  instantly), fast, covers the textbook subset (bra-ket, matrices, `\frac`,
  `\otimes`, `\dagger`, sums). KaTeX sizes math in `em`, so it inherits the
  slide's `cqw`-based font sizes and scales from thumbnail → fullscreen → print
  for free.
- **Authoring convention:** standard delimiters — `$...$` inline, `$$...$$`
  display. The generation prompts instruct the model to use them for all math.
- **PPTX export:** Unicode approximation (keeps text boxes editable). Web + PDF
  get true KaTeX rendering; PPTX is the one intentionally-lossy surface.
- **Scope:** slide deck + AI tutor.

## Architecture

Two layers, split by purity so the parser is testable and reusable everywhere:

### `lib/math.ts` (pure, no DOM — unit tested)
- `splitMath(input: string): MathSegment[]` — tokenizes a plain string into
  `{ type: "text" | "inline" | "display"; value: string }[]`.
  - Handles `$$…$$` (display) and `$…$` (inline).
  - `\$` is a literal dollar sign.
  - An unmatched/dangling `$` is treated as literal text (so prose with a stray
    `$` never breaks).
  - Empty math (`$$ $$`) degrades to literal text.
- `latexToUnicode(latex: string): string` — best-effort LaTeX→Unicode for PPTX.
  Greek letters, `\langle/\rangle` → ⟨/⟩, `\otimes` → ⊗, `\dagger` → †, `\sqrt`
  → √, `\pm`, `\leq`, `\to`, etc.; digit/sign super- and sub-scripts
  (`^2` → ², `_0` → ₀, `^{12}` → ¹²); `\frac{a}{b}` → `(a)/(b)`; strips spacing
  macros (`\left`, `\right`, `\,`, `\;`) and unwraps `\text{}` / `\mathbf{}`.
  Matrices and complex constructs degrade to cleaned source — acceptable for an
  editable export.
- `latexLineToUnicode(input: string): string` — convenience: run `splitMath`,
  convert math segments via `latexToUnicode`, pass text through unchanged. Used
  by the PPTX exporter on every text field.

### `components/math-text.tsx` (`<MathText>`)
- Props: `{ children: string; display?: boolean; className?: string }`.
- Runs `splitMath`, renders text segments verbatim and math segments via
  `katex.renderToString(value, { displayMode, throwOnError: false })` into a
  span with `dangerouslySetInnerHTML`. `throwOnError: false` makes invalid LaTeX
  render in red rather than crash a slide. `renderToString` is pure JS, so the
  component needs no effects.
- A string with no math returns the plain string unchanged (zero overhead).

## Integration points

- **`app/globals.css`** — `@import "katex/dist/katex.min.css";`. Verify it
  survives the print media query (KaTeX spans live inside `.print-deck`, which
  print keeps visible).
- **`components/slides.tsx`** — wrap every author-text field in `<MathText>`:
  titles, subtitles, bullets, two-column headings + bullets, quote text, fact
  value + label, process step label + detail, recap bullets, and speaker notes
  (on-screen panel, present-mode line, and print). Display layout (`$$`) is used
  inside the big-fact value when the model emits a full formula.
- **`components/quiz.tsx` + `components/takeaways.tsx`** — the materials prompt
  instructs LaTeX for takeaways and quiz too (a quantum lesson's questions and
  takeaways are full of notation), so those components render their strings
  through `<MathText>` as well: question, choices, explanation; point + detail.
  Without this, math would show as raw LaTeX there — so it's required, not
  optional, once the prompt emits `$`.
- **`components/tutor.tsx`** — add `remark-math` + `rehype-katex` to the existing
  `ReactMarkdown` (its content is already markdown, so it doesn't use MathText).
- **`lib/pptx.ts`** — run each text field through `latexLineToUnicode` before
  adding it to a text box.
- **Prompts** — `lib/deck.ts` (`deckSpec`, `buildRevisePrompt`),
  `lib/materials.ts`, and `lib/tutor.ts` gain one instruction: write math in
  LaTeX with `$...$` / `$$...$$`; use it for symbols, variables, vectors, and
  formulas (e.g. `$|\psi\rangle = \alpha|0\rangle + \beta|1\rangle$`).

## Testing

- `tests/math.test.ts` — exhaustive on the pure layer:
  - `splitMath`: plain text, inline, display, mixed, escaped `\$`, dangling `$`,
    empty math, adjacent math, math at string boundaries.
  - `latexToUnicode`: the canonical quantum cases (`\alpha`, `|\psi\rangle`,
    `\langle\phi|`, `\otimes`, `^2`, `_0`, `^{12}`, `\frac{1}{\sqrt{2}}`,
    `\dagger`), plus passthrough of plain text.
- Existing suites stay green (math lives inside existing string fields; no schema
  change, so `deck.ts` / `materials.ts` / `db.ts` validation is untouched).
- Visual: regenerate the demo deck via the live LLM with math-heavy content and
  screenshot web + grid + print; export PPTX and confirm Unicode in the text.

## Out of scope

- No new slide layout or schema field — math is inline within existing strings.
- No PPTX OMML (native Office math) — Unicode is the chosen tradeoff.
- No server-side image rasterization of formulas.
