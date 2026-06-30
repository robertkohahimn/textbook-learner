import { Unzip, UnzipInflate, type Unzipped } from "fflate";
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

/** Normalize fast-xml-parser output (single node vs array vs absent) to an array. */
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

/** Directory portion of a zip path ("" if top-level). */
function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function readText(zip: Unzipped, path: string): string | null {
  const bytes = zip[path];
  return bytes ? TEXT_DECODER.decode(bytes) : null;
}

/**
 * Stream-unzip only the entries we parse (META-INF + XML/XHTML), enforcing a ceiling on
 * the ACTUAL number of decompressed bytes emitted. Unlike `unzipSync`'s declared-size
 * filter (`originalSize` is attacker-controlled header metadata), this bounds real output,
 * so a zip bomb that under-reports its sizes still aborts mid-inflation before exhausting
 * memory. Non-content entries (fonts, images, css, a/v) are never started, so never inflated.
 */
export function unzipBounded(buf: Uint8Array, maxBytes: number): Unzipped {
  const out: Unzipped = {};
  let total = 0;
  const unzip = new Unzip((file) => {
    const keep = file.name.startsWith("META-INF/") || KEPT_EXT.test(file.name);
    if (!keep) return; // never call start() => this entry is not decompressed
    const parts: Uint8Array[] = [];
    file.ondata = (err, chunk, final) => {
      if (err) throw err;
      if (chunk && chunk.length) {
        total += chunk.length;
        if (total > maxBytes) {
          throw new Error("EPUB_TOO_LARGE: decompressed output exceeds the allowed limit");
        }
        parts.push(chunk);
      }
      if (final) {
        const size = parts.reduce((n, p) => n + p.length, 0);
        const merged = new Uint8Array(size);
        let off = 0;
        for (const p of parts) {
          merged.set(p, off);
          off += p.length;
        }
        out[file.name] = merged;
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.push(buf, true);
  return out;
}

interface ManifestItem {
  id: string;
  href: string; // absolute (zip-root-relative)
  mediaType: string;
  properties: string;
}

/**
 * Extract an EPUB into the shared `ExtractedBook` shape (same contract as the PDF path).
 * Throws `NO_TEXT:` (too little text), `EPUB_DRM:` (a linear content doc is encrypted),
 * `EPUB_TOO_LARGE:` (decompression ceiling), or `EPUB_INVALID:` (missing/malformed OPF).
 */
export async function extractEpub(buf: Uint8Array): Promise<ExtractedBook> {
  // 1. Unzip only the entries we parse, bounding ACTUAL decompressed bytes (zip-bomb safe).
  const zip = unzipBounded(buf, MAX_DECOMPRESSED_BYTES);

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
  // KNOWN LIMITATION: anchors (#fragment) are ignored, so every TOC entry resolves to
  // its CONTAINER document's start page. For single-file EPUBs (whole book in one
  // content doc — common for Project Gutenberg), all entries collapse to page 1 and the
  // outline gives no positional signal; the curriculum then leans on per-page excerpts.
  // This is the accepted spec trade-off (anchor resolution deliberately out of scope).
  // Clamp to the valid range: a text-less (e.g. trailing empty) linear doc has
  // docStartPage[i] === pages.length, which would otherwise yield numPages + 1.
  const hrefToPage = new Map<string, number>();
  docHrefs.forEach((href, i) =>
    hrefToPage.set(href, Math.min(docStartPage[i] + 1, pages.length))
  );

  const outline: OutlineItem[] = [];
  for (const entry of tocEntries) {
    const page = hrefToPage.get(entry.href);
    if (page === undefined) continue; // target not a linear content doc
    outline.push({ title: entry.title, page });
  }

  return { title, author, numPages: pages.length, pages, outline };
}

/**
 * Extract ordered TOC anchors from an EPUB3 nav document.
 * IMPORTANT: a nav doc contains several <nav> sections (toc, landmarks, page-list).
 * Scope extraction to the `epub:type="toc"` nav only — landmarks/page-list anchors
 * point at real content docs and would otherwise flood the outline. Fall back to the
 * whole document only if no typed toc nav exists. Accept single- or double-quoted href.
 */
function parseNav(xhtml: string, baseDir: string): { title: string; href: string }[] {
  const tocNav = /<nav\b[^>]*epub:type\s*=\s*"[^"]*\btoc\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i.exec(xhtml);
  const scope = tocNav ? tocNav[1] : xhtml;

  const entries: { title: string; href: string }[] = [];
  const re = /<a\b[^>]*\shref=(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scope)) !== null) {
    const rawHref = (m[1] ?? m[2]).split("#")[0];
    if (!rawHref) continue;
    const title = decodeEntities(m[3].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
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
