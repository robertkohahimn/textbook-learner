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
