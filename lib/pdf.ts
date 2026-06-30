import { extractText, getDocumentProxy } from "unpdf";
import { MIN_TEXT_CHARS, type ExtractedBook, type OutlineItem } from "./extracted";

export type { ExtractedBook, OutlineItem } from "./extracted";

export async function extractBook(buf: Uint8Array): Promise<ExtractedBook> {
  const pdf = await getDocumentProxy(buf);

  const meta = await pdf.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };

  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text as string[];
  const totalChars = pages.reduce((sum, p) => sum + p.length, 0);
  if (totalChars < MIN_TEXT_CHARS) {
    throw new Error(
      "NO_TEXT: this PDF has no extractable text (it may be a scanned book)"
    );
  }

  const outline: OutlineItem[] = [];
  const rawOutline = await pdf.getOutline().catch(() => null);
  for (const item of rawOutline ?? []) {
    let page: number | null = null;
    try {
      const dest =
        typeof item.dest === "string"
          ? await pdf.getDestination(item.dest)
          : item.dest;
      if (Array.isArray(dest) && dest[0]) {
        page = (await pdf.getPageIndex(dest[0])) + 1;
      }
    } catch {
      // unresolvable destination — keep the title without a page
    }
    outline.push({ title: String(item.title ?? "").trim(), page });
  }

  return {
    title: info.Title?.trim() || null,
    author: info.Author?.trim() || null,
    numPages: pdf.numPages,
    pages,
    outline,
  };
}
