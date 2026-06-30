"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { BookListRow } from "@/lib/db";
import { formatFromFilename } from "@/lib/book-format";
import { usePoll } from "./use-poll";
import { ProgressBar, Wordmark } from "./bits";

const STAGE_LABELS: Record<string, string> = {
  extracting: "Reading every page…",
  analyzing: "Mapping the ideas…",
  curriculum: "Assembling your curriculum…",
};

export function Library() {
  const [dragging, setDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, refresh } = usePoll<{ books: BookListRow[] }>(
    "/api/books",
    2000,
    true
  );
  const books = data?.books;

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
    await fetch(`/api/books/${book.id}`, { method: "DELETE" });
    void refresh();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 pb-24">
      <header className="flex items-center justify-between py-8">
        <Wordmark />
      </header>

      <section className="rise mt-6 sm:mt-10">
        <h1 className="font-display text-4xl sm:text-5xl font-medium tracking-tight max-w-2xl text-balance">
          Your library, turned into lessons.
        </h1>
        <p className="mt-3 max-w-xl text-ink-soft">
          Drop in a book and Folio builds a curriculum around it — slides, key
          takeaways, quizzes, and a tutor who has read every page.
        </p>
      </section>

      {uploadError && (
        <p role="alert" className="fade mt-6 text-sm text-bad">
          {uploadError}
        </p>
      )}

      <section
        aria-label="Your books"
        className="mt-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-10"
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) void upload(file);
          }}
          className={`rise group aspect-[3/4] rounded-lg border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center gap-3 text-ink-soft cursor-pointer ${
            dragging
              ? "border-accent bg-paper-raised scale-[1.02]"
              : "border-line hover:border-ink-faint hover:bg-paper-raised"
          }`}
        >
          <span
            aria-hidden
            className="font-display text-4xl leading-none text-ink-faint group-hover:text-accent transition-colors"
          >
            +
          </span>
          <span className="text-sm font-medium">Add a book</span>
          <span className="text-xs text-ink-faint px-6 text-center">
            drop a PDF or EPUB here or click to browse
          </span>
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
        </button>

        {books?.map((book, i) => (
          <BookCard
            key={book.id}
            book={book}
            index={i}
            onRemove={() => remove(book)}
          />
        ))}
      </section>

      {books && books.length === 0 && (
        <p className="rise mt-12 text-sm text-ink-faint italic">
          The shelf is empty — your first book is one drop away.
        </p>
      )}
    </main>
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
