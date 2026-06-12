"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BookRow, ModuleWithLessons, LessonRow } from "@/lib/db";
import { usePoll } from "./use-poll";
import { CheckRing, ProgressBar, WorkingDot, Wordmark } from "./bits";

interface BookResponse {
  book: BookRow;
  modules: ModuleWithLessons[];
}

const STAGE_LABELS: Record<string, string> = {
  extracting: "Reading every page…",
  analyzing: "Mapping the ideas…",
  curriculum: "Assembling your curriculum…",
};

export function Curriculum({ bookId }: { bookId: string }) {
  const router = useRouter();
  const { data, error } = usePoll<BookResponse>(
    `/api/books/${bookId}`,
    2500,
    true
  );

  if (error) {
    return (
      <Shell>
        <p role="alert" className="mt-16 text-bad">
          {error}
        </p>
        <Link href="/" className="mt-4 inline-block text-sm underline">
          Back to your library
        </Link>
      </Shell>
    );
  }
  if (!data) {
    return <Shell />;
  }

  const { book, modules } = data;
  const lessons = modules.flatMap((m) => m.lessons);
  const completed = lessons.filter((l) => l.completed_at).length;
  const next =
    lessons.find((l) => !l.completed_at) ?? lessons[lessons.length - 1];

  if (book.status === "processing") {
    return (
      <Shell accent={book.accent}>
        <div className="rise mt-24 flex flex-col items-center text-center">
          <div className="book-cover working-sheen w-40 aspect-[3/4] p-4 pl-6 flex flex-col">
            <span className="text-[9px] uppercase tracking-[0.22em] opacity-70">
              Folio
            </span>
            <span className="relative mt-3 font-display text-sm font-medium leading-snug line-clamp-6 text-balance">
              {book.title}
            </span>
          </div>
          <h1 className="mt-8 font-display text-2xl font-medium">
            {STAGE_LABELS[book.stage ?? ""] ?? "Getting started…"}
          </h1>
          <p className="mt-2 max-w-sm text-sm text-ink-soft">
            Folio is studying your book and designing a curriculum. This takes a
            minute or two — the page will update by itself.
          </p>
        </div>
      </Shell>
    );
  }

  if (book.status === "error") {
    return (
      <Shell accent={book.accent}>
        <div className="rise mt-24 max-w-md">
          <h1 className="font-display text-3xl font-medium">
            That one didn&apos;t take.
          </h1>
          <p role="alert" className="mt-3 text-ink-soft">
            {book.error}
          </p>
          <Link href="/" className="mt-6 inline-block text-sm underline">
            Back to your library
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell accent={book.accent}>
      <section className="rise mt-12 sm:mt-16 max-w-3xl">
        <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
          {book.author ?? "Curriculum"}
        </p>
        <h1 className="mt-2 font-display text-4xl sm:text-5xl font-medium tracking-tight text-balance">
          {book.title}
        </h1>
        <p className="mt-4 text-sm text-ink-soft font-mono">
          {book.num_pages} pages · {modules.length} modules · {lessons.length}{" "}
          lessons
        </p>

        <div className="mt-8 flex items-center gap-5">
          <div className="flex-1">
            <ProgressBar value={lessons.length ? completed / lessons.length : 0} />
            <p className="mt-2 text-xs text-ink-faint font-mono">
              {completed} of {lessons.length} lessons complete
            </p>
          </div>
          {next && (
            <button
              type="button"
              onClick={() => router.push(`/books/${book.id}/lessons/${next.id}`)}
              className="shrink-0 rounded-full bg-accent text-accent-ink px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
            >
              {completed === 0 ? "Start studying" : "Continue studying"}
            </button>
          )}
        </div>
      </section>

      <section aria-label="Curriculum" className="mt-14 max-w-3xl">
        {modules.map((mod, mi) => (
          <article
            key={mod.id}
            className="rise border-t border-line py-8"
            style={{ animationDelay: `${mi * 80}ms` }}
          >
            <header className="flex items-baseline gap-4">
              <span className="font-mono text-sm text-ink-faint">
                {String(mi + 1).padStart(2, "0")}
              </span>
              <div>
                <h2 className="font-display text-2xl font-medium">{mod.title}</h2>
                {mod.description && (
                  <p className="mt-1 text-sm text-ink-soft">{mod.description}</p>
                )}
              </div>
            </header>

            <ul className="mt-5 space-y-1">
              {mod.lessons.map((lesson) => (
                <LessonRowItem key={lesson.id} bookId={book.id} lesson={lesson} />
              ))}
            </ul>
          </article>
        ))}
      </section>
    </Shell>
  );
}

function LessonRowItem({ bookId, lesson }: { bookId: string; lesson: LessonRow }) {
  return (
    <li>
      <Link
        href={`/books/${bookId}/lessons/${lesson.id}`}
        className="group flex items-center gap-4 rounded-lg px-3 py-3 -mx-3 hover:bg-paper-raised transition-colors"
      >
        <CheckRing done={Boolean(lesson.completed_at)} />
        <span className="flex-1 min-w-0">
          <span className="block font-medium leading-snug group-hover:text-accent transition-colors">
            {lesson.title}
          </span>
          {lesson.summary && (
            <span className="block mt-0.5 text-sm text-ink-soft line-clamp-1">
              {lesson.summary}
            </span>
          )}
        </span>
        <span className="hidden sm:block shrink-0 font-mono text-xs text-ink-faint">
          p.{lesson.page_start}–{lesson.page_end}
        </span>
        <span className="shrink-0 w-24 text-right">
          {lesson.status === "generating" ? (
            <WorkingDot label="Preparing" />
          ) : lesson.status === "pending" ? (
            <span className="text-xs text-ink-faint">Queued</span>
          ) : lesson.status === "error" ? (
            <span className="text-xs text-bad">Retry</span>
          ) : (
            <span
              aria-hidden
              className="text-ink-faint group-hover:text-accent group-hover:translate-x-0.5 inline-block transition-all"
            >
              →
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

function Shell({
  accent,
  children,
}: {
  accent?: number;
  children?: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full max-w-6xl px-6 pb-24 ${
        accent !== undefined ? `accent-${accent}` : ""
      }`}
    >
      <header className="flex items-center justify-between py-8">
        <Wordmark />
        <Link
          href="/"
          className="text-sm text-ink-soft hover:text-ink transition-colors"
        >
          ← Library
        </Link>
      </header>
      {children}
    </main>
  );
}
