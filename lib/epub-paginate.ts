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
