const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
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
  s = s.replace(/[ \t\f\v\u00A0]+/g, " ");
  s = s.replace(/ *\n */g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
