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

// Realistic nav: a toc nav PLUS landmarks + page-list. The extractor must read ONLY
// the toc nav — landmarks/page-list anchors point at real content docs and would
// otherwise pollute the outline. chap2 uses a single-quoted href on purpose.
const NAV = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
  <nav epub:type="toc"><ol>
    <li><a href="chap1.xhtml">Chapter&#160;One</a></li>
    <li><a href='chap2.xhtml'>Chapter Two</a></li>
  </ol></nav>
  <nav epub:type="landmarks"><ol>
    <li><a epub:type="bodymatter" href="chap1.xhtml">Start of Content</a></li>
    <li><a epub:type="cover" href="cover.xhtml">Cover</a></li>
  </ol></nav>
  <nav epub:type="page-list"><ol>
    <li><a href="chap1.xhtml#p1">1</a></li>
    <li><a href="chap2.xhtml#p2">2</a></li>
  </ol></nav>
  </body>
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
    // Exactly two: &#160; decoded+collapsed, single-quoted chap2 captured, and the
    // landmarks/page-list navs ("Start of Content", "Cover", "1", "2") excluded.
    expect(titles).toEqual(["Chapter One", "Chapter Two"]);
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
