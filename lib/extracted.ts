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
