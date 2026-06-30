# EPUB upload support — design

**Date:** 2026-06-30
**Goal:** Let users upload EPUB books, not just PDFs. The whole platform already
operates on a uniform `ExtractedBook { title, author, numPages, pages: string[],
outline: OutlineItem[] }` and slices lessons by page number, so the feature
reduces to: *produce that same shape from an EPUB* and widen the upload gate.
No in-app EPUB reader/rendering — PDFs aren't rendered either; they're extracted
to text and turned into a curriculum (slides, takeaways, quiz, tutor).

## Decisions (from the user)
- **Synthetic fixed-size pages.** EPUBs have no fixed pages. Extract chapter text
  and chunk the book into ~one-printed-page-sized synthetic "pages" so the
  page-range-based curriculum engine works unchanged. (Not one-page-per-chapter;
  not dependent on a real EPUB page-list.)
- **Hand-rolled `lib/epub.ts`** using two tiny primitives — `fflate` (zip) +
  `fast-xml-parser` (OPF/NCX) — returning the exact `ExtractedBook` shape. (Not a
  dedicated EPUB library; not `epub.js`.)
- **No-reader, text-only scope** mirroring the PDF path.
- The two cosmetic "PDF" strings in the curriculum prompt are generalized to "book".
- A small `lib/extracted.ts` type module is extracted so `pdf.ts` and `epub.ts`
  share `OutlineItem` / `ExtractedBook`.

## Why this shape

The PDF pipeline today:

```
upload → store ${id}.pdf → lib/pdf.ts:extractBook(buf) → ExtractedBook
       → db.insertPages → generateCurriculum(pages, outline) → lessons (pageStart/pageEnd)
       → generateMaterials(getPagesMarked(book, start, end))
```

Everything after `extractBook` is format-agnostic: it consumes `pages: string[]`
and an `outline` of `{ title, page }`. So EPUB support is one new extractor that
emits the same structure, plus a wider upload gate and a format dispatch in the
job. The `pages`/`lessons`/`materials` tables and all generation code are untouched.

---

## Component 1 — `lib/extracted.ts` (shared types)

Move these out of `lib/pdf.ts` into a neutral module:

```ts
export interface OutlineItem { title: string; page: number | null }
export interface ExtractedBook {
  title: string | null;
  author: string | null;
  numPages: number;
  /** Index 0 = page 1. */
  pages: string[];
  outline: OutlineItem[];
}
export const MIN_TEXT_CHARS = 500;
```

`lib/pdf.ts` imports these (and may re-export them for back-compat).
**Breakage to fix (verified):** `lib/curriculum.ts:2` does
`import type { OutlineItem } from "./pdf"`. Either re-export `OutlineItem` from
`pdf.ts` or update that import to `./extracted`. The build fails otherwise.

## Component 2 — `lib/epub.ts` (the extractor)

`extractEpub(buf: Uint8Array): Promise<ExtractedBook>` — same signature and return
contract as `lib/pdf.ts:extractBook`. Pipeline:

1. **Unzip** with `fflate.unzipSync(buf, { filter })`. The `filter` receives each
   entry's declared metadata (`{ name, size, originalSize, compression }`)
   **before** that entry is decompressed: skip non-content resources (fonts,
   images, audio, video) so they're never inflated, and reject the file if
   `Σ originalSize` over the entries we *do* keep exceeds a **decompressed-bytes
   ceiling**. `originalSize` is a zip-header field and therefore attacker-
   controlled, so this is necessary but not sufficient — see the text-length
   backstop in step 6 and the Error-handling zip-bomb row. (Confidence: `fflate`'s
   `unzipSync` filter is decided pre-inflation; confirm the exact `UnzipFileInfo`
   field name at build time.)
2. **Locate the OPF**: read `META-INF/container.xml`, parse with
   `fast-xml-parser`. `container.xml` may declare multiple `<rootfile>` (multi-
   rendition packages); select the **first `<rootfile>` whose
   `media-type="application/oebps-package+xml"`**, not merely "the rootfile". Do
   **not** assume `OEBPS/content.opf`.
3. **Parse the OPF** with `fast-xml-parser`:
   - metadata: `dc:title` (first), `dc:creator` (first, prefer `opf:role="aut"`).
   - manifest: map `id → { href, media-type, properties }` (href resolved
     relative to the OPF directory).
   - spine: ordered `itemref`s. **Skip `linear="no"`** items (covers, pop-up
     footnotes) from the reading stream.
4. **Resolve the TOC**: EPUB3 nav doc (manifest item with `properties="nav"`) or
   EPUB2 `toc.ncx` (manifest item `media-type=application/x-dtbncx+xml`), selected
   by manifest — not by filename. Parse to a flat list of `{ title, href, anchor }`.
   The nav doc **is XHTML** and NCX titles can carry named entities (`&nbsp;`,
   `&mdash;`); `fast-xml-parser` does not decode HTML named entities by default, so
   run every TOC `title` through the **same named+numeric decode** defined in
   Component 3 before storing it. Otherwise `Chapter&nbsp;1` reaches the curriculum
   prompt and the UI undecoded.
5. **XHTML → text** per linear spine item via `xhtmlToText` (Component 3). Record
   each spine **document's character offset** in the concatenated stream — *not* a
   page index, which does not exist until step 6. (Same for any best-effort anchor
   offsets.)
6. **Synthetic pagination**: concatenate the per-document text in spine order,
   **forcing a page break at each linear spine-document boundary** so every chapter
   starts at a page boundary (see "Document↔page boundary policy" below). Within a
   document, chunk into `PAGE_CHARS`-sized pages **at paragraph boundaries** (never
   split a paragraph unless it alone exceeds `PAGE_CHARS`, then hard-split). Skip
   empty/whitespace-only pages. As a header-independent zip-bomb backstop, hard-cap
   the total concatenated text length and abort past it. Result: `pages: string[]`.
   Once page boundaries are fixed, convert the step-5 character offsets → page
   indices.
7. **Outline → page mapping** (best-effort, document-granular): for each TOC entry,
   map its `href` to the target spine document's **start page** (which, given the
   forced break in step 6, is always exact). Intra-document anchor refinement is
   attempted only if cheaply available (convert a recorded anchor offset → page) and
   **always** falls back to the document start page. Curriculum quality must not
   depend on sub-document anchor resolution. Drop TOC entries whose target isn't in
   the linear spine.
8. **Guards**: DRM check (Component 4) before extraction; total text `< MIN_TEXT_CHARS`
   → throw the existing `NO_TEXT:` sentinel.

Return `{ title, author, numPages: pages.length, pages, outline }`.

### `PAGE_CHARS` is a coupled constant, not a free knob

`PAGE_CHARS = 1800` (≈ 250–330 words ≈ one printed page of prose). This is
constrained by two existing calibrations in `lib/curriculum.ts`:

- `:87` — the prompt says each lesson "covers a contiguous page range of roughly
  4 to 25 pages."
- `:6` / `:80` — `EXCERPT_CHARS = 150`: the prompt emits the first 150 chars of
  **every** page as orientation.

If a synthetic page is much smaller than a print page, page counts balloon, the
per-page excerpt block grows, and "4–25 pages" stops corresponding to a sane
lesson size. ~1800 keeps both heuristics in their tuned regime. Treat the value
as a documented coupling; if it's ever retuned, re-check those two call sites.

### Document↔page boundary policy

Each linear spine document **forces a page break**: a chapter never shares a page
with the next. Rationale: the curriculum prompt emits the first `EXCERPT_CHARS`
(150) of *every* page as orientation (`lib/curriculum.ts:80`). If chapter N's tail
shared a page with chapter N+1's head, the excerpt for that page would show
chapter N's tail, mislabeling exactly the chapter-start signal the curriculum
relies on — and `outline.page` would point mid-page. Forcing the break makes every
chapter start a page boundary, so `outline.page` is exact and step-5 offset→page
conversion is trivial for document starts. Cost: short trailing pages (a one-
paragraph chapter becomes a one-page chapter), so a synthetic page is "≤ `PAGE_CHARS`"
rather than "≈ `PAGE_CHARS`". This is immaterial to the "4–25 pages per lesson"
regime and is the accepted trade.

## Component 3 — `xhtmlToText(xml: string): string` (extraction contract)

The single most quality-critical function. "Strip tags + collapse whitespace" is
**insufficient** (it fuses words across block boundaries and leaks script/style).
Contract, in order:

1. Remove `<script>…</script>` and `<style>…</style>` **including their text**.
2. Replace block-level element edges (`</p>`, `</div>`, `</li>`, `</h1>…</h6>`,
   `</tr>`, `<br/>`) with `"\n"`; leave inline edges (`</span>`, `</em>`, `</a>`,
   …) as no-ops.
3. Delete all remaining tags.
4. Decode entities: numeric (`&#NN;`, `&#xNN;`) **and** a named table — at minimum
   `nbsp amp lt gt quot apos mdash ndash hellip lsquo rsquo ldquo rdquo`.
5. Collapse runs of spaces; collapse 3+ newlines to 2.

Note: parsing chapter XHTML with `fast-xml-parser` is **rejected** — a tree parser
discards the block/inline distinction (you'd reconstruct boundary spacing while
walking the tree anyway), complicates entity handling, and destroys the offsets
that best-effort anchor refinement would want. `fast-xml-parser` is used **only**
for OPF/NCX/nav (clean, machine-generated XML).

Acceptance (property-style): output contains no `<[^>]+>`, no residual `&[a-z]+;`,
and no words fused at a known block boundary.

## Component 4 — DRM detection (not "encryption.xml exists")

`META-INF/encryption.xml` is **also** used by the IDPF/Adobe font-obfuscation
algorithms on perfectly readable books, so "file present → DRM" would falsely
reject a large fraction of EPUBs. Correct check:

- If there is no `encryption.xml` → not encrypted, proceed.
- Parse it, enumerate `<EncryptedData>` target URIs. Reject with `EPUB_DRM:` **only
  if a spine content document** (an XHTML reading-order resource) is encrypted.
- If only fonts (`.otf/.ttf/.woff`) are encrypted → ignore them (we extract text,
  not fonts) and proceed.

## Component 5 — format detection (no DB migration)

`books.filename` already stores `${id}.pdf`; there is no `format` column and the
schema is `CREATE TABLE IF NOT EXISTS` with no migration framework. Store the real
extension (`${id}.epub`) and **derive format from the extension**. No schema change.

## Component 6 — upload gate

**`app/api/books/route.ts`:**
- Accept `.pdf` **and** `.epub`. Error → "Only PDF and EPUB files are supported".
- Write the file with its real extension (`${id}.${ext}`), not hardcoded `.pdf`.
- `titleFromFilename` strips `.pdf` **or** `.epub`.
- 80MB cap unchanged.

**`components/library.tsx`:**
- Client pre-check accepts both extensions; generalized error copy.
- `accept=".pdf,.epub,application/pdf,application/epub+zip"`.
- Drop-zone copy → "drop a PDF or EPUB here".

## Component 7 — job dispatch (`lib/jobs.ts`)

`processBook` derives the format from `book.filename` and calls `extractEpub` or
`extractBook`. Generalize the hardcoded error string:

- `NO_TEXT` → "This book has no extractable text — it may be a scanned or secured
  book, which isn't supported yet." (drop the word "PDF").
- `EPUB_DRM` → "This EPUB is DRM-protected, so it can't be read."

## Component 8 — curriculum prompt wording (`lib/curriculum.ts`)

Two cosmetic strings (`:77` "TABLE OF CONTENTS (from the PDF outline)", `:91`
"PDF page numbers, 1-based") → "book" / "page numbers". Functionally identical
(still 1-based indices into `pages[]`); avoids telling the model "PDF" for an EPUB.

---

## Data flow

```
EPUB upload
  → route.ts: validate, store ${id}.epub, insertBook(filename)
  → enqueueProcessBook
  → jobs.ts processBook: format = ext(filename); extractEpub(buf)
        unzip → container.xml → OPF (meta/manifest/spine, skip linear="no")
        → TOC (nav|ncx) → xhtmlToText per linear doc → synthetic pages
        → outline pages (doc-granular) → ExtractedBook
  → db.insertPages → generateCurriculum(pages, outline) → lessons
  → generateMaterials  (all unchanged)
```

## Error handling

| Condition | Behavior |
|---|---|
| Not `.pdf`/`.epub` | 400 at upload, both client + server |
| > 80MB | 400 (compressed-size cap, unchanged) |
| Zip-bomb — `Σ originalSize` of kept entries exceeds ceiling (`unzipSync` filter, pre-inflation) | reject before inflating → book `status=error` |
| Zip-bomb — header lies; concatenated text exceeds the step-6 length cap | abort extraction → book `status=error` |
| `encryption.xml` encrypts a content doc | `EPUB_DRM` → friendly error |
| Corrupt zip / missing OPF / empty spine | thrown error → book `status=error` |
| Extracted text `< MIN_TEXT_CHARS` | `NO_TEXT` → friendly error |

## Testing — `tests/epub.test.ts` (vitest, lib-only)

The repo's vitest covers `lib/` pure logic; `extractEpub` and `xhtmlToText` fit.

- **In-memory fixtures** built with `fflate`: an EPUB3-nav book and an EPUB2-NCX
  book. Assert metadata, page chunking near `PAGE_CHARS`, outline→page mapping,
  `linear="no"` exclusion, `NO_TEXT` on empty, and content-doc `EPUB_DRM`.
- **≥1 real public-domain EPUB fixture** (e.g., a Project Gutenberg EPUB) — synthetic
  fixtures are too clean to exercise entity decoding, block-boundary joining, and
  namespaced metadata.
- **1 font-obfuscated fixture** — regression guard that font-only `encryption.xml`
  extracts successfully (Component 4).
- **`xhtmlToText` unit tests**: block-boundary spacing, script/style removal,
  numeric + named entity decode.
- Property assertions: no residual tags, no residual named entities (titles
  included), no zero-length pages. **Not** a general invariant: outline page numbers
  are non-decreasing only when the TOC follows spine order, which EPUB does not
  require — assert monotonicity on the known Gutenberg fixture only, not as a
  property of arbitrary input.

## Dependencies

Add to `dependencies`: `fflate` (tiny, zero-dep zip) and `fast-xml-parser`. Both
pure-JS, no native build — important given the repo's native-build sensitivity
(`better-sqlite3` / pnpm history). Run with **npm** (`package-lock.json`).

## Known artifact (accepted)

`components/curriculum.tsx:102` renders `{book.num_pages} pages`. For EPUBs this is
the **synthetic** page count, which won't match the print edition. Accepted as-is.

## Out of scope (YAGNI)

No in-app EPUB reader/rendering, no image/figure extraction, no DRM removal, no
attempt to match the print edition's real pagination, no DB schema/migration change.
