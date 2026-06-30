# EPUB Upload Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users upload EPUB books, not just PDFs, by feeding EPUBs through the existing curriculum pipeline.

**Architecture:** A new `lib/epub.ts` extracts an EPUB into the *same* `ExtractedBook { title, author, numPages, pages: string[], outline }` shape the PDF path already produces, via synthetic fixed-size pages. Everything downstream (curriculum, slides, quiz, tutor) is format-agnostic and unchanged. The upload gate widens to accept `.epub`, and the processing job dispatches to the right extractor by file extension. No in-app EPUB rendering.

**Tech Stack:** Next.js 16, React 19, TypeScript (strict), better-sqlite3, vitest. New deps: `fflate` (zip), `fast-xml-parser` (OPF/NCX).

**Spec:** `docs/superpowers/specs/2026-06-30-epub-support-design.md`

## Global Constraints

Every task's requirements implicitly include these (exact values from the spec):

- **Package manager: npm** (`package-lock.json`). New deps must be pure-JS, **no native build**.
- **Typecheck command:** `node_modules/.bin/tsc --noEmit -p tsconfig.json` (a global shim hijacks bare `tsc`). tsconfig is `strict`, `noEmit`, no `noUnusedLocals`, no ESLint.
- **Tests = vitest**, run with `npm test` (`vitest run`). Tests cover **`lib/` pure logic only** — there is no React/DOM test harness. Routes/components are verified by typecheck + `npm run build` + manual.
- **Build gate:** `npm run build` (`next build`) typechecks end-to-end and is a valid CI-style gate.
- **`ExtractedBook` shape is the integration contract** — `extractEpub` must return exactly it: `{ title: string|null, author: string|null, numPages: number, pages: string[], outline: { title: string, page: number|null }[] }`, `pages` index 0 = page 1.
- **Error sentinels** (matched by `lib/jobs.ts` via `String.startsWith`): `NO_TEXT:` (too little text) and `EPUB_DRM:` (DRM-protected content). Reuse these exact prefixes.
- **`MIN_TEXT_CHARS = 500`** minimum total extracted text, else `NO_TEXT`.
- **`PAGE_CHARS = 1800`** synthetic page size — a *coupled* constant (matches the curriculum prompt's "4–25 pages per lesson" and `EXCERPT_CHARS=150` orientation in `lib/curriculum.ts`). Do not change without re-checking those two call sites.
- **Forced page break at each linear spine-document boundary** (every chapter starts a page boundary).
- **DRM ≠ `encryption.xml` exists** — font obfuscation also uses it. Reject only when a *content document in the linear spine* is encrypted.
- **Upload accepts `.pdf` and `.epub`.** Rejection copy: "Only PDF and EPUB files are supported" (server). 80MB compressed cap unchanged. Stored filename uses the real extension `${id}.${ext}`.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/extracted.ts` | Shared `OutlineItem` / `ExtractedBook` types + `MIN_TEXT_CHARS` | 1 |
| `lib/pdf.ts` | (modified) import shared types, re-export for back-compat | 1 |
| `lib/book-format.ts` | `BookFormat`, `formatFromFilename`, `titleFromFilename` (pure) | 2 |
| `lib/epub-text.ts` | `decodeEntities`, `xhtmlToText` (pure) | 3 |
| `lib/epub-paginate.ts` | `paginate` — synthetic pages + per-doc start pages (pure) | 4 |
| `lib/epub.ts` | `extractEpub` — unzip→OPF→TOC→DRM→pages→outline | 5 |
| `lib/jobs.ts` | (modified) dispatch by format; format-neutral error copy | 6 |
| `app/api/books/route.ts` | (modified) accept `.epub`, store real ext | 7 |
| `components/library.tsx` | (modified) accept `.epub`, UI copy | 7 |
| `lib/curriculum.ts` | (modified) prompt copy "PDF"→"book" | 8 |
| `tests/*.test.ts` | unit tests per pure module | per task |

---

## Task 1: Shared types module + dependencies

**Files:**
- Create: `lib/extracted.ts`
- Modify: `lib/pdf.ts` (lines 3–17 type defs + line 17 `MIN_TEXT_CHARS`)
- Modify: `package.json` (add deps)

**Interfaces:**
- Produces: `interface OutlineItem { title: string; page: number | null }`, `interface ExtractedBook { title: string|null; author: string|null; numPages: number; pages: string[]; outline: OutlineItem[] }`, `const MIN_TEXT_CHARS = 500` — all exported from `lib/extracted.ts`. `lib/pdf.ts` re-exports the two types so existing `import type { OutlineItem } from "./pdf"` (in `lib/curriculum.ts:2`) keeps working.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install fflate fast-xml-parser
```
Expected: both added to `dependencies` in `package.json`; `package-lock.json` updated; no native build step runs.

- [ ] **Step 2: Verify the new deps are pure-JS (no native build)**

Run:
```bash
ls node_modules/fflate/package.json node_modules/fast-xml-parser/package.json && find node_modules/fflate node_modules/fast-xml-parser -name '*.node' -o -name binding.gyp 2>/dev/null
```
Expected: both `package.json` paths print; the `find` prints nothing (no `.node` / `binding.gyp`).

- [ ] **Step 3: Create `lib/extracted.ts`**

```ts
/** Uniform extraction contract shared by the PDF and EPUB extractors. */
export interface OutlineItem {
  title: string;
  page: number | null;
}

export interface ExtractedBook {
  title: string | null;
  author: string | null;
  numPages: number;
  /** Index 0 = page 1. */
  pages: string[];
  outline: OutlineItem[];
}

/** Below this many total characters, a book is treated as having no usable text. */
export const MIN_TEXT_CHARS = 500;
```

- [ ] **Step 4: Point `lib/pdf.ts` at the shared module**

Replace the top of `lib/pdf.ts` (the `OutlineItem`/`ExtractedBook` interface block and the local `const MIN_TEXT_CHARS = 500;`) so it imports from `./extracted` and re-exports the types. The new header:

```ts
import { extractText, getDocumentProxy } from "unpdf";
import { MIN_TEXT_CHARS, type ExtractedBook, type OutlineItem } from "./extracted";

export type { ExtractedBook, OutlineItem } from "./extracted";
```

Delete the now-duplicated `export interface OutlineItem {…}`, `export interface ExtractedBook {…}`, and `const MIN_TEXT_CHARS = 500;` lines from `pdf.ts`. The body of `extractBook` is unchanged (it still references `MIN_TEXT_CHARS`, `ExtractedBook`, `OutlineItem`).

- [ ] **Step 5: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no errors (clean exit). Confirms `lib/curriculum.ts:2`'s `import type { OutlineItem } from "./pdf"` still resolves via the re-export.

- [ ] **Step 6: Run existing tests**

Run: `npm test`
Expected: PASS (PDF tests unaffected; the reference-book test is `skipIf` and may be skipped).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json lib/extracted.ts lib/pdf.ts
git commit -m "refactor: extract shared ExtractedBook types; add fflate + fast-xml-parser"
```

---

## Task 2: Format + title helpers

**Files:**
- Create: `lib/book-format.ts`
- Test: `tests/book-format.test.ts`

**Interfaces:**
- Produces: `type BookFormat = "pdf" | "epub"`; `function formatFromFilename(name: string): BookFormat | null`; `function titleFromFilename(name: string): string`. Pure, no node imports — safe to import from both server and client code.

- [ ] **Step 1: Write the failing test**

Create `tests/book-format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatFromFilename, titleFromFilename } from "@/lib/book-format";

describe("formatFromFilename", () => {
  it("detects pdf and epub case-insensitively", () => {
    expect(formatFromFilename("a.pdf")).toBe("pdf");
    expect(formatFromFilename("a.PDF")).toBe("pdf");
    expect(formatFromFilename("a.epub")).toBe("epub");
    expect(formatFromFilename("My Book.EPUB")).toBe("epub");
  });
  it("returns null for unsupported types", () => {
    expect(formatFromFilename("a.txt")).toBeNull();
    expect(formatFromFilename("epub")).toBeNull();
    expect(formatFromFilename("a.pdf.zip")).toBeNull();
  });
});

describe("titleFromFilename", () => {
  it("strips either extension and tidies separators", () => {
    expect(titleFromFilename("quantum_computing-intro.epub")).toBe("quantum computing intro");
    expect(titleFromFilename("Some Book.pdf")).toBe("Some Book");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- book-format`
Expected: FAIL — cannot find module `@/lib/book-format`.

- [ ] **Step 3: Write the implementation**

Create `lib/book-format.ts`:
```ts
export type BookFormat = "pdf" | "epub";

/** Returns the supported format for a filename, or null if unsupported. */
export function formatFromFilename(name: string): BookFormat | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".epub")) return "epub";
  return null;
}

/** Human-ish title from an upload filename: drop the extension, tidy separators. */
export function titleFromFilename(name: string): string {
  return name
    .replace(/\.(pdf|epub)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- book-format`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/book-format.ts tests/book-format.test.ts
git commit -m "feat: add book-format helpers (format + title from filename)"
```

---

## Task 3: XHTML → text extraction contract

**Files:**
- Create: `lib/epub-text.ts`
- Test: `tests/epub-text.test.ts`

**Interfaces:**
- Produces: `function decodeEntities(s: string): string` (numeric `&#NN;`/`&#xNN;` + a named table); `function xhtmlToText(xml: string): string` (block-boundary aware, drops script/style, decodes entities, normalizes whitespace).

- [ ] **Step 1: Write the failing test**

Create `tests/epub-text.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeEntities, xhtmlToText } from "@/lib/epub-text";

describe("decodeEntities", () => {
  it("decodes numeric and named entities", () => {
    expect(decodeEntities("a&#65;b")).toBe("aAb");
    expect(decodeEntities("x&#x41;y")).toBe("xAy");
    expect(decodeEntities("Chapter&nbsp;1")).toBe("Chapter 1");
    expect(decodeEntities("&ldquo;hi&rdquo; &amp; &mdash;")).toBe("“hi” & —");
  });
  it("leaves unknown named entities intact", () => {
    expect(decodeEntities("a&unknownentity;b")).toBe("a&unknownentity;b");
  });
});

describe("xhtmlToText", () => {
  it("inserts a boundary between block elements (no word fusion)", () => {
    expect(xhtmlToText("<p>alpha</p><p>beta</p>")).toBe("alpha\nbeta");
  });
  it("does not insert boundaries inside inline elements", () => {
    expect(xhtmlToText("<p>a<em>b</em><span>c</span>d</p>")).toBe("abcd");
  });
  it("drops script and style content", () => {
    expect(xhtmlToText("<p>keep</p><style>.x{color:red}</style><script>var x=1;</script>"))
      .toBe("keep");
  });
  it("decodes entities and collapses whitespace", () => {
    expect(xhtmlToText("<p>a&nbsp;&nbsp;b   c</p>")).toBe("a b c");
  });
  it("treats <br/> as a line boundary", () => {
    expect(xhtmlToText("<p>a<br/>b</p>")).toBe("a\nb");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- epub-text`
Expected: FAIL — cannot find module `@/lib/epub-text`.

- [ ] **Step 3: Write the implementation**

Create `lib/epub-text.ts`:
```ts
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

/** Decode numeric (&#NN; / &#xNN;) and a fixed named-entity table. Unknown names are left intact. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const named = NAMED_ENTITIES[body];
    return named ?? m;
  });
}

// Block-level elements whose closing tag (or void self) ends a line of text.
const BLOCK_CLOSE =
  /<\/(p|div|li|ul|ol|dl|dd|dt|h[1-6]|tr|table|thead|tbody|section|article|aside|header|footer|nav|figure|figcaption|blockquote|pre)\s*>/gi;
const VOID_BLOCK = /<(br|hr)\b[^>]*\/?>/gi;

/** Convert a chapter's XHTML to plain reading text with paragraph boundaries preserved. */
export function xhtmlToText(xml: string): string {
  let s = xml;
  // 1. Remove script/style WITH their text content.
  s = s.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  // 2. Block boundaries -> newline.
  s = s.replace(BLOCK_CLOSE, "\n");
  s = s.replace(VOID_BLOCK, "\n");
  // 3. Strip all remaining tags.
  s = s.replace(/<[^>]+>/g, "");
  // 4. Decode entities.
  s = decodeEntities(s);
  // 5. Normalize whitespace: horizontal runs (incl. nbsp) -> single space; tidy newlines.
  s = s.replace(/[ \t\f\v ]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- epub-text`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add lib/epub-text.ts tests/epub-text.test.ts
git commit -m "feat: add xhtmlToText extraction contract + entity decoding"
```

---

## Task 4: Synthetic pagination

**Files:**
- Create: `lib/epub-paginate.ts`
- Test: `tests/epub-paginate.test.ts`

**Interfaces:**
- Consumes: nothing from prior tasks.
- Produces: `interface PaginateResult { pages: string[]; docStartPage: number[] }` (`docStartPage[i]` = 0-based page index where document `i` begins); `interface PaginateOptions { pageChars?: number; maxTotalChars?: number }`; `function paginate(docs: string[], opts?: PaginateOptions): PaginateResult`. Throws `Error("EPUB_TOO_LARGE: …")` if total text exceeds `maxTotalChars`. Default `pageChars = 1800`, `maxTotalChars = 40_000_000`.

- [ ] **Step 1: Write the failing test**

Create `tests/epub-paginate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { paginate } from "@/lib/epub-paginate";

const para = (n: number, fill = "x") => fill.repeat(n);

describe("paginate", () => {
  it("forces a page break at each document boundary", () => {
    const { pages, docStartPage } = paginate(["short one", "short two"], { pageChars: 1800 });
    expect(pages).toEqual(["short one", "short two"]);
    expect(docStartPage).toEqual([0, 1]);
  });

  it("chunks a long document into multiple pages at paragraph boundaries", () => {
    const doc = [para(1000, "a"), para(1000, "b"), para(1000, "c")].join("\n\n");
    const { pages, docStartPage } = paginate([doc], { pageChars: 1800 });
    expect(docStartPage).toEqual([0]);
    expect(pages.length).toBe(2); // ~3000 chars / 1800
    expect(pages.every((p) => p.length <= 1800)).toBe(true);
  });

  it("hard-splits a single paragraph longer than pageChars", () => {
    const { pages } = paginate([para(4000, "z")], { pageChars: 1800 });
    expect(pages.length).toBe(3); // 1800 + 1800 + 400
    expect(pages[0].length).toBe(1800);
  });

  it("skips empty/whitespace documents but still records a start page", () => {
    const { pages, docStartPage } = paginate(["real text", "   \n  ", "more text"], { pageChars: 1800 });
    expect(pages).toEqual(["real text", "more text"]);
    // empty doc 1 points at the page that follows it (doc 2's page).
    expect(docStartPage).toEqual([0, 1, 1]);
  });

  it("throws when total text exceeds the backstop", () => {
    expect(() => paginate([para(50, "q")], { pageChars: 1800, maxTotalChars: 10 })).toThrow(
      /EPUB_TOO_LARGE/
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- epub-paginate`
Expected: FAIL — cannot find module `@/lib/epub-paginate`.

- [ ] **Step 3: Write the implementation**

Create `lib/epub-paginate.ts`:
```ts
export interface PaginateResult {
  pages: string[];
  /** docStartPage[i] = 0-based index of the page where document i begins. */
  docStartPage: number[];
}

export interface PaginateOptions {
  pageChars?: number;
  maxTotalChars?: number;
}

/**
 * Turn per-document reading text into fixed-size synthetic "pages".
 * Each document forces a page break (chapters start on a page boundary).
 * Within a document, accumulate paragraphs up to pageChars, breaking at
 * paragraph boundaries; a paragraph longer than pageChars is hard-split.
 */
export function paginate(docs: string[], opts: PaginateOptions = {}): PaginateResult {
  const pageChars = opts.pageChars ?? 1800;
  const maxTotal = opts.maxTotalChars ?? 40_000_000;

  const pages: string[] = [];
  const docStartPage: number[] = [];
  let total = 0;

  for (const doc of docs) {
    // Forced break: this document's first page is the next page index.
    docStartPage.push(pages.length);

    const text = doc.trim();
    if (!text) continue;

    total += text.length;
    if (total > maxTotal) {
      throw new Error("EPUB_TOO_LARGE: decompressed text exceeds the allowed limit");
    }

    let buf = "";
    const flush = () => {
      const t = buf.trim();
      if (t) pages.push(t);
      buf = "";
    };

    for (const rawPara of text.split(/\n{2,}/)) {
      let para = rawPara.trim();
      if (!para) continue;

      // Hard-split paragraphs that exceed a whole page on their own.
      while (para.length > pageChars) {
        flush();
        pages.push(para.slice(0, pageChars));
        para = para.slice(pageChars);
      }

      if (buf && buf.length + para.length + 2 > pageChars) flush();
      buf = buf ? `${buf}\n\n${para}` : para;
    }
    flush();
  }

  return { pages, docStartPage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- epub-paginate`
Expected: PASS (all cases).

> Note on the "skips empty" case: the empty doc records `docStartPage = pages.length` at the moment it's visited (which equals the next real page's index), satisfying `[0, 1, 1]`.

- [ ] **Step 5: Commit**

```bash
git add lib/epub-paginate.ts tests/epub-paginate.test.ts
git commit -m "feat: add synthetic pagination with forced per-document page breaks"
```

---

## Task 5: The EPUB extractor

**Files:**
- Create: `lib/epub.ts`
- Test: `tests/epub.test.ts`

**Interfaces:**
- Consumes: `decodeEntities`, `xhtmlToText` (Task 3); `paginate` (Task 4); `MIN_TEXT_CHARS`, `ExtractedBook`, `OutlineItem` (Task 1); `unzipSync` + `zipSync` from `fflate`; `XMLParser` from `fast-xml-parser`.
- Produces: `function extractEpub(buf: Uint8Array): Promise<ExtractedBook>`. Throws `NO_TEXT:` (too little text) and `EPUB_DRM:` (a linear content doc is encrypted). Returns the `ExtractedBook` contract.

**Implementation notes (read before the test):**
- An EPUB is a zip. `META-INF/container.xml` → the OPF package path. OPF has `<metadata>` (`dc:title`, `dc:creator`), `<manifest>` (id→href+media-type+properties), `<spine>` (ordered `itemref`s with optional `linear`).
- TOC: EPUB3 = manifest item with `properties` containing `nav` (an XHTML nav doc); EPUB2 = manifest item with media-type `application/x-dtbncx+xml` (`toc.ncx`).
- All hrefs are resolved to **zip-root-relative absolute paths** before matching (manifest hrefs are relative to the OPF dir; TOC hrefs are relative to the TOC file's dir).

- [ ] **Step 1: Write the failing test**

Create `tests/epub.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { extractEpub } from "@/lib/epub";

type Files = Record<string, string>;

function buildEpub(files: Files): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, content] of Object.entries(files)) entries[name] = strToU8(content);
  return zipSync(entries);
}

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function opf(opts: { nav?: boolean; ncx?: boolean }): string {
  const navItem = opts.nav
    ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
    : "";
  const ncxItem = opts.ncx
    ? `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
    : "";
  const spineToc = opts.ncx ? ` toc="ncx"` : "";
  return `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Test Book</dc:title>
    <dc:creator>Ada Lovelace</dc:creator>
  </metadata>
  <manifest>
    <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    ${navItem}${ncxItem}
  </manifest>
  <spine${spineToc}>
    <itemref idref="cover" linear="no"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;
}

const NAV = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body><nav epub:type="toc"><ol>
    <li><a href="chap1.xhtml">Chapter&#160;One</a></li>
    <li><a href="chap2.xhtml">Chapter Two</a></li>
  </ol></nav></body>
</html>`;

const NCX = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>Chapter One</text></navLabel><content src="chap1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>Chapter Two</text></navLabel><content src="chap2.xhtml"/></navPoint>
  </navMap>
</ncx>`;

const chap = (heading: string, body: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>${heading}</h1><p>${body}</p></body></html>`;

describe("extractEpub", () => {
  it("extracts metadata, pages (skipping linear=no), and an EPUB3 nav outline", async () => {
    const epub = buildEpub({
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": opf({ nav: true }),
      "OEBPS/nav.xhtml": NAV,
      "OEBPS/cover.xhtml": chap("Cover", "front matter that should be skipped ".repeat(30)),
      "OEBPS/chap1.xhtml": chap("One", "alpha ".repeat(200)),
      "OEBPS/chap2.xhtml": chap("Two", "beta ".repeat(200)),
    });
    const book = await extractEpub(epub);

    expect(book.title).toBe("The Test Book");
    expect(book.author).toBe("Ada Lovelace");
    expect(book.numPages).toBe(book.pages.length);
    expect(book.pages.length).toBeGreaterThanOrEqual(2);
    // cover (linear="no") text must not appear.
    expect(book.pages.join("\n")).not.toContain("front matter");

    const titles = book.outline.map((o) => o.title);
    expect(titles).toEqual(["Chapter One", "Chapter Two"]); // &#160; decoded to nbsp then collapsed
    expect(book.outline[0].page).toBe(1); // chap1 is the first linear doc
    expect(book.outline[1].page!).toBeGreaterThan(book.outline[0].page!);
  });

  it("reads an EPUB2 NCX outline", async () => {
    const epub = buildEpub({
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": opf({ ncx: true }),
      "OEBPS/toc.ncx": NCX,
      "OEBPS/cover.xhtml": chap("Cover", "skip me ".repeat(30)),
      "OEBPS/chap1.xhtml": chap("One", "alpha ".repeat(200)),
      "OEBPS/chap2.xhtml": chap("Two", "beta ".repeat(200)),
    });
    const book = await extractEpub(epub);
    expect(book.outline.map((o) => o.title)).toEqual(["Chapter One", "Chapter Two"]);
    expect(book.outline[0].page).toBe(1);
  });

  it("throws NO_TEXT when there is too little text", async () => {
    const epub = buildEpub({
      "META-INF/container.xml": CONTAINER,
      "OEBPS/content.opf": opf({ nav: true }),
      "OEBPS/nav.xhtml": NAV,
      "OEBPS/cover.xhtml": chap("Cover", "x"),
      "OEBPS/chap1.xhtml": chap("One", "tiny"),
      "OEBPS/chap2.xhtml": chap("Two", "tiny"),
    });
    await expect(extractEpub(epub)).rejects.toThrow(/NO_TEXT/);
  });

  it("rejects DRM when a content document is encrypted", async () => {
    const enc = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <CipherData><CipherReference URI="OEBPS/chap1.xhtml"/></CipherData>
  </EncryptedData>
</encryption>`;
    const epub = buildEpub({
      "META-INF/container.xml": CONTAINER,
      "META-INF/encryption.xml": enc,
      "OEBPS/content.opf": opf({ nav: true }),
      "OEBPS/nav.xhtml": NAV,
      "OEBPS/cover.xhtml": chap("Cover", "x ".repeat(30)),
      "OEBPS/chap1.xhtml": chap("One", "alpha ".repeat(200)),
      "OEBPS/chap2.xhtml": chap("Two", "beta ".repeat(200)),
    });
    await expect(extractEpub(epub)).rejects.toThrow(/EPUB_DRM/);
  });

  it("ignores encryption that only covers fonts (obfuscation, not DRM)", async () => {
    const enc = `<?xml version="1.0"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <CipherData><CipherReference URI="OEBPS/fonts/obf.otf"/></CipherData>
  </EncryptedData>
</encryption>`;
    const epub = buildEpub({
      "META-INF/container.xml": CONTAINER,
      "META-INF/encryption.xml": enc,
      "OEBPS/content.opf": opf({ nav: true }),
      "OEBPS/nav.xhtml": NAV,
      "OEBPS/cover.xhtml": chap("Cover", "x ".repeat(30)),
      "OEBPS/chap1.xhtml": chap("One", "alpha ".repeat(200)),
      "OEBPS/chap2.xhtml": chap("Two", "beta ".repeat(200)),
    });
    const book = await extractEpub(epub);
    expect(book.pages.length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- "tests/epub.test"`
Expected: FAIL — cannot find module `@/lib/epub`.

- [ ] **Step 3: Write the implementation**

Create `lib/epub.ts`:
```ts
import { unzipSync, type Unzipped } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { decodeEntities, xhtmlToText } from "./epub-text";
import { paginate } from "./epub-paginate";
import { MIN_TEXT_CHARS, type ExtractedBook, type OutlineItem } from "./extracted";

const PAGE_CHARS = 1800;
const TEXT_DECODER = new TextDecoder("utf-8");

// Entry extensions we parse; everything else (fonts, images, css, av) is skipped pre-inflation.
const KEPT_EXT = /\.(opf|ncx|xhtml|html|htm|xml)$/i;
const MAX_DECOMPRESSED_BYTES = 300 * 1024 * 1024;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep namespace prefixes (dc:title, etc.) as-is.
});

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

/** Text content of a fast-xml-parser node (string, or { "#text", ...attrs }). */
function textOf(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node.trim();
  if (typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in (node as Record<string, unknown>)) {
    return String((node as Record<string, unknown>)["#text"]).trim();
  }
  return "";
}

/** Resolve a relative href against a base directory, into a zip-root-relative path. */
function resolvePath(baseDir: string, rel: string): string {
  const stack = baseDir ? baseDir.split("/").filter(Boolean) : [];
  for (const part of rel.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function readText(zip: Unzipped, path: string): string | null {
  const bytes = zip[path];
  return bytes ? TEXT_DECODER.decode(bytes) : null;
}

interface ManifestItem {
  id: string;
  href: string; // absolute (zip-root-relative)
  mediaType: string;
  properties: string;
}

export async function extractEpub(buf: Uint8Array): Promise<ExtractedBook> {
  // 1. Unzip, skipping non-parsed resources and budgeting declared decompressed size.
  let budget = 0;
  const zip = unzipSync(buf, {
    filter: (file) => {
      const keep = file.name.startsWith("META-INF/") || KEPT_EXT.test(file.name);
      if (keep) {
        budget += file.originalSize;
        if (budget > MAX_DECOMPRESSED_BYTES) {
          throw new Error("EPUB_TOO_LARGE: declared decompressed size exceeds the allowed limit");
        }
      }
      return keep;
    },
  });

  // 2. container.xml -> OPF path (first OEBPS-package rootfile).
  const containerXml = readText(zip, "META-INF/container.xml");
  if (!containerXml) throw new Error("EPUB_INVALID: missing META-INF/container.xml");
  const container = parser.parse(containerXml);
  const rootfiles = asArray(container?.container?.rootfiles?.rootfile);
  const opfPath = (
    rootfiles.find((r) => r?.["@_media-type"] === "application/oebps-package+xml") ?? rootfiles[0]
  )?.["@_full-path"];
  if (!opfPath || typeof opfPath !== "string") throw new Error("EPUB_INVALID: no OPF rootfile");
  const opfDir = dirOf(opfPath);

  // 3. Parse the OPF: metadata, manifest, spine.
  const opfXml = readText(zip, opfPath);
  if (!opfXml) throw new Error(`EPUB_INVALID: OPF not found at ${opfPath}`);
  const pkg = parser.parse(opfXml)?.package;
  if (!pkg) throw new Error("EPUB_INVALID: malformed OPF package");

  const meta = pkg.metadata ?? {};
  const title = textOf(asArray(meta["dc:title"])[0]) || null;
  const author = textOf(asArray(meta["dc:creator"])[0]) || null;

  const idToItem = new Map<string, ManifestItem>();
  const hrefToItem = new Map<string, ManifestItem>();
  for (const raw of asArray(pkg.manifest?.item)) {
    const href = resolvePath(opfDir, String(raw["@_href"] ?? ""));
    const item: ManifestItem = {
      id: String(raw["@_id"] ?? ""),
      href,
      mediaType: String(raw["@_media-type"] ?? ""),
      properties: String(raw["@_properties"] ?? ""),
    };
    idToItem.set(item.id, item);
    hrefToItem.set(href, item);
  }

  // Linear spine documents, in reading order (skip linear="no").
  const linearItems: ManifestItem[] = [];
  for (const ref of asArray(pkg.spine?.itemref)) {
    if (String(ref["@_linear"] ?? "yes").toLowerCase() === "no") continue;
    const item = idToItem.get(String(ref["@_idref"] ?? ""));
    if (item) linearItems.push(item);
  }
  const linearHrefs = new Set(linearItems.map((i) => i.href));

  // 4. DRM detection: reject only if a linear content document is encrypted.
  const encXml = readText(zip, "META-INF/encryption.xml");
  if (encXml) {
    const enc = parser.parse(encXml);
    for (const data of asArray(enc?.encryption?.EncryptedData)) {
      const uri = data?.CipherData?.CipherReference?.["@_URI"];
      if (typeof uri === "string" && linearHrefs.has(resolvePath("", decodeURIComponent(uri)))) {
        throw new Error("EPUB_DRM: a content document is encrypted");
      }
    }
  }

  // 5. Resolve the TOC (prefer EPUB3 nav; fall back to EPUB2 NCX).
  const navItem = [...idToItem.values()].find((i) =>
    i.properties.split(/\s+/).includes("nav")
  );
  const ncxItem =
    [...idToItem.values()].find((i) => i.mediaType === "application/x-dtbncx+xml") ?? null;

  let tocEntries: { title: string; href: string }[] = [];
  if (navItem) {
    const navXml = readText(zip, navItem.href);
    if (navXml) tocEntries = parseNav(navXml, dirOf(navItem.href));
  } else if (ncxItem) {
    const ncxXml = readText(zip, ncxItem.href);
    if (ncxXml) tocEntries = parseNcx(ncxXml, dirOf(ncxItem.href));
  }

  // 6. Read each linear document's text, in spine order.
  const docs: string[] = [];
  const docHrefs: string[] = [];
  for (const item of linearItems) {
    const xml = readText(zip, item.href);
    docs.push(xml ? xhtmlToText(xml) : "");
    docHrefs.push(item.href);
  }

  // 7. Paginate into synthetic pages.
  const { pages, docStartPage } = paginate(docs, { pageChars: PAGE_CHARS });

  const totalChars = pages.reduce((sum, p) => sum + p.length, 0);
  if (totalChars < MIN_TEXT_CHARS) {
    throw new Error("NO_TEXT: this EPUB has no extractable text");
  }

  // 8. Map TOC entries to synthetic page numbers (document-granular, 1-based).
  const hrefToPage = new Map<string, number>();
  docHrefs.forEach((href, i) => hrefToPage.set(href, docStartPage[i] + 1));

  const outline: OutlineItem[] = [];
  for (const entry of tocEntries) {
    const page = hrefToPage.get(entry.href);
    if (page === undefined) continue; // target not a linear content doc
    outline.push({ title: entry.title, page });
  }

  return { title, author, numPages: pages.length, pages, outline };
}

/** Extract ordered TOC anchors from an EPUB3 nav document. */
function parseNav(xhtml: string, baseDir: string): { title: string; href: string }[] {
  const entries: { title: string; href: string }[] = [];
  const re = /<a\b[^>]*\shref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xhtml)) !== null) {
    const rawHref = m[1].split("#")[0];
    if (!rawHref) continue;
    const title = decodeEntities(m[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    entries.push({ title, href: resolvePath(baseDir, rawHref) });
  }
  return entries;
}

/** Extract ordered TOC entries from an EPUB2 NCX, flattening nested navPoints. */
function parseNcx(xml: string, baseDir: string): { title: string; href: string }[] {
  const ncx = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(xml);
  const out: { title: string; href: string }[] = [];
  const walk = (points: unknown) => {
    for (const p of asArray(points)) {
      const label = (p as Record<string, unknown>)["navLabel"] as
        | { text?: unknown }
        | undefined;
      const title = decodeEntities(textOf(label?.text)).replace(/\s+/g, " ").trim();
      const src = (p as Record<string, { "@_src"?: unknown }>)["content"]?.["@_src"];
      if (title && typeof src === "string") {
        out.push({ title, href: resolvePath(baseDir, src.split("#")[0]) });
      }
      walk((p as Record<string, unknown>)["navPoint"]);
    }
  };
  walk(ncx?.ncx?.navMap?.navPoint);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- "tests/epub.test"`
Expected: PASS (all six cases).

- [ ] **Step 5: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/epub.ts tests/epub.test.ts
git commit -m "feat: add EPUB extractor (unzip, OPF, nav/NCX TOC, DRM, synthetic pages)"
```

---

## Task 6: Dispatch by format in the processing job

**Files:**
- Modify: `lib/jobs.ts` (imports near line 4; `processBook` body lines 84–127)

**Interfaces:**
- Consumes: `extractEpub` (Task 5); `extractBook` (existing); `formatFromFilename` (Task 2).
- Produces: no new exports — behavior change only.

- [ ] **Step 1: Add imports**

In `lib/jobs.ts`, alongside the existing `import { extractBook } from "./pdf";` (line 4), add:
```ts
import { extractEpub } from "./epub";
import { formatFromFilename } from "./book-format";
```

- [ ] **Step 2: Dispatch to the right extractor**

In `processBook`, replace the single extraction line:
```ts
    const extracted = await extractBook(buf);
```
with:
```ts
    const extracted =
      formatFromFilename(book.filename) === "epub"
        ? await extractEpub(buf)
        : await extractBook(buf);
```

- [ ] **Step 3: Make the failure copy format-neutral**

In the `catch` block of `processBook`, replace the `error:` expression:
```ts
      error: message.startsWith("NO_TEXT")
        ? "This PDF has no extractable text — it may be a scanned book, which isn't supported yet."
        : message,
```
with:
```ts
      error: message.startsWith("NO_TEXT")
        ? "This book has no extractable text — it may be a scanned or secured book, which isn't supported yet."
        : message.startsWith("EPUB_DRM")
          ? "This EPUB is DRM-protected, so it can't be read."
          : message.startsWith("EPUB_TOO_LARGE")
            ? "This EPUB is too large to process."
            : message.startsWith("EPUB_INVALID")
              ? "This EPUB couldn't be read — the file may be corrupt."
              : message,
```

- [ ] **Step 4: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add lib/jobs.ts
git commit -m "feat: dispatch book processing by format; format-neutral error copy"
```

---

## Task 7: Widen the upload gate (API route + library UI)

**Files:**
- Modify: `app/api/books/route.ts` (lines 13–19 helper, 31–43 handler)
- Modify: `components/library.tsx` (lines 27–32 upload check, 104 copy, 109 accept)

**Interfaces:**
- Consumes: `formatFromFilename`, `titleFromFilename` (Task 2).
- Produces: no new exports.

- [ ] **Step 1: Update the API route**

In `app/api/books/route.ts`:

(a) Remove the local `titleFromFilename` function (lines 13–19) and import the shared helpers. Replace the import block region by adding:
```ts
import { formatFromFilename, titleFromFilename } from "@/lib/book-format";
```
(Delete the local `function titleFromFilename(...) {...}`.)

(b) Replace the extension check + filename construction. The current:
```ts
  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json({ error: "Only PDF files are supported" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 80MB)" }, { status: 400 });
  }

  const id = db.newId();
  const filename = `${id}.pdf`;
```
becomes:
```ts
  const format = formatFromFilename(file.name);
  if (!format) {
    return NextResponse.json(
      { error: "Only PDF and EPUB files are supported" },
      { status: 400 }
    );
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "File too large (max 80MB)" }, { status: 400 });
  }

  const id = db.newId();
  const filename = `${id}.${format}`;
```

- [ ] **Step 2: Update the library component**

In `components/library.tsx`:

(a) Add the import near the top (after the existing imports):
```ts
import { formatFromFilename } from "@/lib/book-format";
```

(b) Replace the client-side guard in `upload`:
```ts
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Folio reads PDF books — that file isn't one.");
      return;
    }
```
with:
```ts
    if (!formatFromFilename(file.name)) {
      setUploadError("Folio reads PDF and EPUB books — that file isn't one.");
      return;
    }
```

(c) Update the drop-zone copy (line ~104):
```tsx
            drop a PDF here or click to browse
```
to:
```tsx
            drop a PDF or EPUB here or click to browse
```

(d) Update the file input `accept` (line ~109):
```tsx
            accept="application/pdf,.pdf"
```
to:
```tsx
            accept=".pdf,.epub,application/pdf,application/epub+zip"
```

- [ ] **Step 3: Typecheck**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 4: Build (verifies route + client component compile)**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/api/books/route.ts components/library.tsx
git commit -m "feat: accept EPUB uploads in API route and library UI"
```

---

## Task 8: Format-neutral curriculum prompt copy

**Files:**
- Modify: `lib/curriculum.ts` (line 77 and line 91 prompt strings)

**Interfaces:**
- Consumes: nothing new. Produces: no new exports (prompt wording only).

- [ ] **Step 1: Update the two PDF-specific strings**

In `lib/curriculum.ts`, change line 77:
```ts
TABLE OF CONTENTS (from the PDF outline):
```
to:
```ts
TABLE OF CONTENTS (from the book outline):
```

And change line 91:
```ts
- Use the printed page positions [p.N] above for pageStart/pageEnd (PDF page numbers, 1-based).
```
to:
```ts
- Use the printed page positions [p.N] above for pageStart/pageEnd (page numbers, 1-based).
```

- [ ] **Step 2: Typecheck + tests**

Run: `node_modules/.bin/tsc --noEmit -p tsconfig.json && npm test`
Expected: no type errors; tests PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/curriculum.ts
git commit -m "chore: make curriculum prompt copy format-neutral (PDF -> book)"
```

---

## Task 9: Real-world EPUB fixture test (optional, recommended)

In-memory fixtures are clean by construction. Add a real public-domain EPUB to catch entity decoding, block-boundary joining, and namespaced metadata in the wild — guarded by `existsSync` like the reference-PDF test so CI without the file still passes.

**Files:**
- Add: `tests/fixtures/<some-public-domain>.epub` (e.g. a Project Gutenberg EPUB)
- Modify: `tests/epub.test.ts` (append a `describe.skipIf` block)

**Interfaces:**
- Consumes: `extractEpub` (Task 5).

- [ ] **Step 1: Add a small public-domain EPUB fixture**

Download a small Project Gutenberg EPUB (no DRM, public domain) into `tests/fixtures/`. Example:
```bash
mkdir -p tests/fixtures
curl -L -o tests/fixtures/alice.epub https://www.gutenberg.org/ebooks/11.epub.images
```
(Any small public-domain EPUB is fine; adjust the filename in the test accordingly.)

- [ ] **Step 2: Append the guarded test**

Append to `tests/epub.test.ts`:
```ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REAL_EPUB = path.join(__dirname, "fixtures", "alice.epub");

describe.skipIf(!existsSync(REAL_EPUB))("extractEpub (real fixture)", () => {
  it("extracts clean text and an outline from a real EPUB", async () => {
    const book = await extractEpub(new Uint8Array(readFileSync(REAL_EPUB)));
    expect(book.title).toBeTruthy();
    expect(book.pages.length).toBeGreaterThan(3);
    const joined = book.pages.join("\n");
    expect(joined).not.toMatch(/<[^>]+>/);        // no residual tags
    expect(joined).not.toMatch(/&[a-zA-Z]+;/);    // no residual named entities
    expect(book.pages.every((p) => p.trim().length > 0)).toBe(true); // no empty pages
    expect(book.outline.length).toBeGreaterThan(0);
  }, 30_000);
});
```
> Do **not** assert outline page numbers are non-decreasing as a general invariant — EPUB TOCs may not follow spine order. If this specific fixture's TOC is in reading order, a fixture-scoped monotonicity check is acceptable, but keep it out of the universal assertions.

- [ ] **Step 3: Run tests**

Run: `npm test -- "tests/epub.test"`
Expected: PASS (the real-fixture block runs if the file exists, otherwise is skipped).

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures tests/epub.test.ts
git commit -m "test: add real-world EPUB extraction fixture (guarded)"
```

---

## Final verification

- [ ] **Full typecheck:** `node_modules/.bin/tsc --noEmit -p tsconfig.json` → clean.
- [ ] **Full test suite:** `npm test` → all PASS.
- [ ] **Production build:** `npm run build` → succeeds.
- [ ] **Manual smoke (optional):** `npm run dev`, upload a `.epub`, confirm the book moves through `extracting → analyzing → curriculum → ready` and a curriculum with sensible page ranges appears.

---

## Self-review notes (coverage map)

- Shared `ExtractedBook` contract → Task 1.
- `xhtmlToText` extraction contract (block boundaries, script/style, entities) → Task 3.
- Synthetic pages + forced per-document breaks + length backstop → Task 4.
- Unzip filter (skip non-content, declared-size budget) + OPF-by-media-type + spine `linear="no"` skip + nav/NCX selection + decoded TOC titles + content-doc DRM detection (vs font obfuscation) + document-granular outline mapping + `NO_TEXT` → Task 5.
- Format detection (no DB migration) → Task 2 (`formatFromFilename`), used in Tasks 6 & 7.
- Job dispatch + `EPUB_DRM`/`NO_TEXT` copy → Task 6.
- Upload gate (server + client), real-extension storage → Task 7.
- Curriculum prompt copy → Task 8.
- Real-world + DRM + obfuscation + NCX + nav test coverage → Tasks 5 & 9.
- Dependencies pure-JS, npm → Task 1.
