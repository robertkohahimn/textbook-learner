"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { BookListRow } from "@/lib/db";
import { formatFromFilename } from "@/lib/book-format";
import type { NewsletterBookshelfItem } from "./newsletter-bookshelf";
import { usePoll } from "./use-poll";
import { ProgressBar, Wordmark, WorkingDot } from "./bits";

const STAGE_LABELS: Record<string, string> = {
  extracting: "Reading every page…",
  analyzing: "Mapping the ideas…",
  curriculum: "Assembling your curriculum…",
};

/**
 * Book-cloth accents, keyed by `books.accent`. The canvas can't read CSS
 * classes, so these mirror `.accent-N` in globals.css — and `accentFor()` in
 * lib/db.ts mods by this length. Keep all three in step.
 */
const ACCENT_HEX = [
  "#7c2f2f", // oxblood
  "#2f5d3e", // forest
  "#36436e", // navy
  "#8a5a14", // ochre
  "#2c5f5d", // teal
  "#5d3b5e", // plum
  "#7a2f4a", // wine
  "#6b4a2f", // chestnut
  "#55672e", // olive
  "#24455c", // slate
  "#9c5a22", // amber
  "#453f75", // indigo
  "#8a3a20", // brick
  "#4a6076", // steel
];

/** three.js is ~249KB gzipped and needs a real WebGL context, so keep it off the server. */
const NewsletterBookshelf = dynamic(
  () => import("./newsletter-bookshelf").then((m) => m.NewsletterBookshelf),
  {
    ssr: false,
    // Renders inside ShelfFrame, so this is a bare spacer — a second
    // ShelfFrame here would draw a border inside a border. The heights track
    // `useShelfHeight`, whose breakpoint is Tailwind's `sm`.
    loading: () => <div className="h-[400px] sm:h-[560px]" />,
  }
);

export function Library() {
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const shelfHeight = useShelfHeight();
  const webgl = useWebGLSupport();

  const { data, refresh } = usePoll<{ books: BookListRow[] }>(
    "/api/books",
    2000,
    true
  );
  const books = data?.books;

  // Every poll hands back a fresh array, and the shelf rebuilds all of its
  // canvas cover textures whenever `items` changes identity. Memoise on the
  // fields that are actually painted onto a cover so a 2s poll stays free.
  const coverKey = (books ?? [])
    .map((b) => `${b.id}|${b.title}|${b.author ?? ""}|${b.accent}|${b.status}`)
    .join("~");
  const items = useMemo<NewsletterBookshelfItem[]>(
    () =>
      (books ?? []).map((book) => ({
        id: book.id,
        title: book.title,
        date: coverLine(book),
        color: ACCENT_HEX[book.accent % ACCENT_HEX.length],
        // Only finished books are openable; the shelf ignores a missing href.
        href: book.status === "ready" ? `/books/${book.id}` : undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [coverKey]
  );

  // Wired to both shelf callbacks, because neither covers the other:
  // onCurrentChange follows the camera while panning, but the camera clamps to
  // [bounds.min, bounds.max], so books past either end can be clicked and
  // focused without ever becoming the nearest book. onSelect carries the
  // clicked index regardless. `books[0]` covers only the frame before the
  // shelf's first callback.
  const trackCurrent = useCallback(
    (item: NewsletterBookshelfItem) => setSelectedId(item.id),
    []
  );
  const selected =
    books?.find((b) => b.id === selectedId) ?? books?.[0] ?? null;

  async function upload(file: File) {
    setUploadError(null);
    if (!formatFromFilename(file.name)) {
      setUploadError("Folio reads PDF and EPUB books — that file isn't one.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/books", { method: "POST", body: form });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setUploadError(body.error ?? "Upload failed — try again.");
      return;
    }
    void refresh();
  }

  async function remove(book: BookListRow) {
    if (!confirm(`Remove “${book.title}” and all its study materials?`)) return;
    setUploadError(null);
    try {
      const res = await fetch(`/api/books/${book.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setUploadError(body.error ?? `Couldn’t remove “${book.title}”.`);
        return;
      }
    } catch {
      setUploadError("Couldn’t reach Folio — check your connection.");
      return;
    }
    if (selectedId === book.id) setSelectedId(null);
    void refresh();
  }

  return (
    <main
      className="mx-auto w-full max-w-6xl px-6 pb-24"
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void upload(file);
      }}
    >
      <header className="flex items-center justify-between gap-4 py-8">
        <Wordmark />
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-full border border-line bg-paper-raised px-4 py-2 text-sm text-ink transition-colors hover:border-ink-faint cursor-pointer"
          >
            <span aria-hidden className="text-ink-faint">
              +
            </span>{" "}
            Add a book
          </button>
          <Link
            href="/settings"
            className="text-sm text-ink-soft hover:text-ink transition-colors"
          >
            Settings
          </Link>
        </div>
      </header>

      {uploadError && (
        <p role="alert" className="fade mb-6 text-sm text-bad">
          {uploadError}
        </p>
      )}

      {books === undefined || webgl === null ? (
        <ShelfFrame height={shelfHeight} />
      ) : books.length === 0 ? (
        <EmptyShelf onBrowse={() => inputRef.current?.click()} />
      ) : webgl === false ? (
        <BookGrid books={books} onRemove={remove} />
      ) : (
        <>
          <ShelfFrame height={shelfHeight}>
            <NewsletterBookshelf
              items={items}
              brand="Folio"
              height={shelfHeight}
              onSelect={trackCurrent}
              onCurrentChange={trackCurrent}
              className="bg-transparent"
            />
          </ShelfFrame>
          <BookDetail book={selected} onRemove={remove} />
          <ShelfIndex books={books} />
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />

      {dragging && (
        <div
          aria-hidden
          className="fade pointer-events-none fixed inset-4 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-paper/80 backdrop-blur-sm"
        >
          <p className="font-display text-2xl text-ink">
            Drop it — Folio takes it from here.
          </p>
        </div>
      )}
    </main>
  );
}

/** Paper-toned surround so the WebGL stage sits in the page rather than on it. */
function ShelfFrame({
  children,
  height,
}: {
  children?: React.ReactNode;
  height: number;
}) {
  return (
    <div className="rise overflow-hidden rounded-xl border border-line bg-paper-deep">
      {/* Same height as the mounted shelf, so nothing below it shifts. */}
      {children ?? (
        <div aria-busy="true" aria-label="Loading your shelf" style={{ height }} />
      )}
    </div>
  );
}

function EmptyShelf({ onBrowse }: { onBrowse: () => void }) {
  return (
    <section className="rise">
      <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-tight max-w-2xl text-balance">
        Your library, turned into lessons.
      </h1>
      <p className="mt-3 max-w-xl text-ink-soft">
        Drop in a book and Folio builds a curriculum around it — slides, key
        takeaways, quizzes, and a tutor who has read every page.
      </p>
      <button
        type="button"
        onClick={onBrowse}
        className="group mt-10 flex h-[clamp(280px,38vh,380px)] w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line text-ink-soft transition-colors hover:border-ink-faint hover:bg-paper-raised cursor-pointer"
      >
        <span
          aria-hidden
          className="font-display text-5xl leading-none text-ink-faint transition-colors group-hover:text-accent"
        >
          +
        </span>
        <span className="text-sm font-medium">Add your first book</span>
        <span className="text-xs text-ink-faint">
          drop a PDF or EPUB anywhere on this page, or click to browse
        </span>
      </button>
    </section>
  );
}

/**
 * A `<canvas>` can't be read by a screen reader, so mirror the shelf as plain
 * links. Hidden until something inside it takes focus, so keyboard users don't
 * tab into anything invisible.
 */
function ShelfIndex({ books }: { books: BookListRow[] }) {
  return (
    <nav
      aria-label="All books"
      className="sr-only focus-within:not-sr-only focus-within:mt-10 focus-within:border-t focus-within:border-line focus-within:pt-6"
    >
      <ul className="space-y-2 text-sm">
        {books.map((book) => (
          <li key={book.id}>
            {book.status === "ready" ? (
              <Link
                href={`/books/${book.id}`}
                className="text-ink-soft underline-offset-4 hover:text-ink hover:underline"
              >
                {book.title}
                {book.author ? ` — ${book.author}` : ""} (
                {book.completed_lessons} of {book.total_lessons} lessons done)
              </Link>
            ) : (
              <span className="text-ink-faint">
                {book.title}
                {book.author ? ` — ${book.author}` : ""} (
                {book.status === "error"
                  ? "couldn’t be processed"
                  : "still processing"}
                )
              </span>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

function BookDetail({
  book,
  onRemove,
}: {
  book: BookListRow | null;
  onRemove: (book: BookListRow) => void;
}) {
  if (!book) return null;

  const progress =
    book.total_lessons > 0 ? book.completed_lessons / book.total_lessons : 0;
  const processing = book.status === "processing";
  const failed = book.status === "error";

  return (
    <section
      className={`fade mt-8 flex flex-wrap items-end justify-between gap-x-8 gap-y-5 accent-${book.accent}`}
    >
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-2xl sm:text-3xl font-medium tracking-tight text-balance">
          {book.title}
        </h1>
        {book.author && (
          <p className="mt-1 text-sm text-ink-soft">{book.author}</p>
        )}

        {/* Only the status announces. Wrapping the whole panel meant the 2s
            poll re-read the title, author, and every control label. */}
        <div aria-live="polite">
          {processing ? (
            <div className="mt-4">
              <WorkingDot label={STAGE_LABELS[book.stage ?? ""] ?? "Getting started…"} />
            </div>
          ) : failed ? (
            <p role="alert" className="mt-4 text-sm text-bad">
              {book.error ?? "Couldn’t process this book."}
            </p>
          ) : (
            <div className="mt-4 max-w-sm">
              <p className="flex items-baseline justify-between font-mono text-xs text-ink-soft">
                <span>
                  {book.completed_lessons}/{book.total_lessons} lessons
                </span>
                <span>{Math.round(progress * 100)}%</span>
              </p>
              <ProgressBar value={progress} className="mt-2" />
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-5">
        {!processing && !failed && (
          <Link
            href={`/books/${book.id}`}
            className="rounded-full border border-accent bg-accent px-5 py-2 text-sm text-accent-ink transition-opacity hover:opacity-90"
          >
            Study
          </Link>
        )}
        <button
          type="button"
          onClick={() => onRemove(book)}
          className="text-sm text-ink-faint transition-colors hover:text-bad cursor-pointer"
        >
          Remove
        </button>
      </div>
    </section>
  );
}

/**
 * No WebGL — fall back to the flat cover grid the shelf replaced, so a browser
 * with hardware acceleration off still reaches every book.
 */
function BookGrid({
  books,
  onRemove,
}: {
  books: BookListRow[];
  onRemove: (book: BookListRow) => void;
}) {
  return (
    <>
      <p className="fade mb-6 text-xs text-ink-faint">
        This browser can’t draw the 3D shelf — here’s the flat view.
      </p>
      <section
        aria-label="Your books"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10"
      >
        {books.map((book, i) => (
          <BookCard
            key={book.id}
            book={book}
            index={i}
            onRemove={() => onRemove(book)}
          />
        ))}
      </section>
    </>
  );
}

function BookCard({
  book,
  index,
  onRemove,
}: {
  book: BookListRow;
  index: number;
  onRemove: () => void;
}) {
  const progress =
    book.total_lessons > 0 ? book.completed_lessons / book.total_lessons : 0;
  const processing = book.status === "processing";
  const failed = book.status === "error";

  const cover = (
    <div
      className={`book-cover aspect-[3/4] p-5 pl-7 flex flex-col transition-transform duration-300 ${
        !processing && !failed ? "group-hover:-translate-y-1.5" : ""
      } ${processing ? "working-sheen" : ""}`}
    >
      <span className="relative text-[10px] uppercase tracking-[0.22em] opacity-70">
        Folio
      </span>
      <span className="relative mt-5 font-display text-lg sm:text-xl font-medium leading-snug line-clamp-5 text-balance">
        {book.title}
      </span>
      {book.author && (
        <span className="relative mt-2 text-xs opacity-75 line-clamp-2">
          {book.author}
        </span>
      )}
      <span className="relative mt-auto">
        {processing ? (
          <span className="text-xs opacity-90">
            {STAGE_LABELS[book.stage ?? ""] ?? "Getting started…"}
          </span>
        ) : failed ? (
          <span className="text-xs opacity-90">Couldn&apos;t process</span>
        ) : (
          <span className="flex items-center justify-between text-[11px] opacity-90 font-mono">
            <span>
              {book.completed_lessons}/{book.total_lessons} lessons
            </span>
            <span>{Math.round(progress * 100)}%</span>
          </span>
        )}
        {!processing && !failed && (
          <span className="mt-1.5 block h-[3px] rounded-full bg-black/25 overflow-hidden">
            <span
              className="block h-full rounded-full bg-white/85 transition-[width] duration-700"
              style={{ width: `${progress * 100}%` }}
            />
          </span>
        )}
      </span>
    </div>
  );

  return (
    <div
      className={`rise group relative accent-${book.accent}`}
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      {failed ? (
        <div className="opacity-90">{cover}</div>
      ) : processing ? (
        cover
      ) : (
        <Link
          href={`/books/${book.id}`}
          aria-label={`Study ${book.title}`}
          className="block focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-4 rounded-lg"
        >
          {cover}
        </Link>
      )}

      {failed && (
        <p role="alert" className="mt-2 text-xs text-bad leading-snug">
          {book.error}
        </p>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${book.title}`}
        className="absolute -top-2 -right-2 z-10 size-7 rounded-full bg-paper-raised border border-line text-ink-soft text-sm leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-bad hover:border-bad cursor-pointer"
      >
        ×
      </button>
    </div>
  );
}

/**
 * The shelf needs a WebGL context; without one it would paint an empty frame
 * and strand every book behind it. `null` means "still checking" — the probe
 * runs in an effect so the server render and the first client render agree.
 */
function useWebGLSupport() {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    setSupported(Boolean(gl));
    // Browsers cap how many live contexts a page may hold, so hand this one
    // back rather than waiting for the probe canvas to be collected.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }, []);

  return supported;
}

/** The shelf frames its camera from a pixel height, so give it a real number. */
function useShelfHeight() {
  const [height, setHeight] = useState(560);

  useEffect(() => {
    // Tailwind's `sm` starts at 640px, so stop just below it — otherwise the
    // shelf and the loading spacer disagree at exactly 640px wide.
    const compact = window.matchMedia("(max-width: 639.98px)");
    const update = () => setHeight(compact.matches ? 400 : 560);
    update();
    compact.addEventListener("change", update);
    return () => compact.removeEventListener("change", update);
  }, []);

  return height;
}

/**
 * The mono line printed across the top of each generated cover. `coverTexture`
 * draws it with a single fillText that doesn't wrap, so it has to stay short —
 * book metadata routinely carries half a dozen authors.
 */
const COVER_LINE_MAX = 28;

function coverLine(book: BookListRow) {
  if (book.author) {
    const author = book.author.toUpperCase();
    return author.length > COVER_LINE_MAX
      ? `${author.slice(0, COVER_LINE_MAX - 1).trimEnd()}…`
      : author;
  }
  // SQLite hands back `datetime('now')` as "YYYY-MM-DD HH:MM:SS" in UTC, so
  // format in UTC too — otherwise a book added at 02:00Z dates a day early for
  // readers west of it.
  const added = new Date(`${book.created_at.replace(" ", "T")}Z`);
  return Number.isNaN(added.valueOf())
    ? "ADDED TO FOLIO"
    : added
        .toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })
        .toUpperCase();
}
