"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { LessonMaterials, LessonRow, QuizAttemptRow } from "@/lib/db";
import type { DeckMeta } from "@/lib/deck";
import { usePoll } from "./use-poll";
import { Wordmark } from "./bits";
import { Slides } from "./slides";
import { useSlideAnnotations } from "./slide-annotations";
import { Takeaways } from "./takeaways";
import { Quiz } from "./quiz";
import { LessonRail } from "./lesson-rail";

interface LessonResponse {
  lesson: LessonRow;
  materials: LessonMaterials | null;
  deckMeta: DeckMeta | null;
  attempts: QuizAttemptRow[];
  book: { id: string; title: string; accent: number } | null;
  moduleTitle: string | null;
  prevLessonId: string | null;
  nextLessonId: string | null;
}

const TABS = [
  { key: "slides", label: "Slides" },
  { key: "takeaways", label: "Takeaways" },
  { key: "quiz", label: "Quiz" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function Lesson({ lessonId }: { lessonId: string }) {
  const [tab, setTab] = useState<TabKey>("slides");
  const [completing, setCompleting] = useState(false);
  const [index, setIndex] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(true);
  const annos = useSlideAnnotations(lessonId);

  // Tab state lives in ?tab= so a refresh keeps your place.
  useEffect(() => {
    const initial = new URLSearchParams(window.location.search).get("tab");
    if (TABS.some((t) => t.key === initial)) setTab(initial as TabKey);
  }, []);

  useEffect(() => {
    setRailOpen(localStorage.getItem("folio:lesson-rail-open") !== "0");
  }, []);

  function toggleRail(open: boolean) {
    setRailOpen(open);
    localStorage.setItem("folio:lesson-rail-open", open ? "1" : "0");
  }

  function switchTab(next: TabKey) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(null, "", url);
  }

  const { data, error, refresh, setActive } = usePoll<LessonResponse>(
    `/api/lessons/${lessonId}`,
    2500,
    true
  );
  // Stop polling once the lesson is ready: materials are then immutable and the
  // mutation paths (revise, customize, quiz) call refresh() directly, so there's
  // no reason to keep re-fetching the (now large) payload every 2.5s. Keep
  // polling while pending/generating AND on error — the lesson GET route
  // re-enqueues a pending/error lesson, so polling is what drives the automatic
  // retry the error copy promises.
  useEffect(() => {
    setActive(!data || data.lesson.status !== "ready");
  }, [data, setActive]);

  // A regenerated deck may be shorter than where the reader was.
  const slideCount = data?.materials?.slides.length ?? 0;
  useEffect(() => {
    if (slideCount > 0) setIndex((i) => Math.min(i, slideCount - 1));
  }, [slideCount]);

  const pickHighlight = (id: string) => {
    setFocusId(id);
    toggleRail(true);
  };

  const safeIndex = Math.max(0, Math.min(index, slideCount - 1));
  const onJump = (i: number) => {
    switchTab("slides");
    setIndex(i);
    setFocusId(annos.annotations[i]?.highlights[0]?.id ?? null);
  };

  const ready = data?.lesson.status === "ready" && data.materials;

  async function toggleComplete() {
    if (!data) return;
    setCompleting(true);
    await fetch(`/api/lessons/${lessonId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: !data.lesson.completed_at }),
    });
    await refresh();
    setCompleting(false);
  }

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
  if (!data) return <Shell />;

  const { lesson, book, moduleTitle, prevLessonId, nextLessonId } = data;
  const completed = Boolean(lesson.completed_at);

  return (
    <Shell accent={book?.accent} bookId={book?.id} bookTitle={book?.title}>
      <section
        className={`rise mt-8 sm:mt-10 max-w-3xl ${railOpen ? "" : "mx-auto"}`}
      >
        <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
          {moduleTitle ?? "Lesson"}
        </p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-tight text-balance max-w-xl">
            {lesson.title}
          </h1>
          <div className="flex items-center gap-2 pt-1.5">
            <NavArrow
              href={prevLessonId && book ? `/books/${book.id}/lessons/${prevLessonId}` : null}
              label="Previous lesson"
            >
              ←
            </NavArrow>
            <NavArrow
              href={nextLessonId && book ? `/books/${book.id}/lessons/${nextLessonId}` : null}
              label="Next lesson"
              highlight={completed}
            >
              →
            </NavArrow>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <span className="font-mono text-xs text-ink-faint">
            pages {lesson.page_start}–{lesson.page_end}
          </span>
          <button
            type="button"
            onClick={toggleComplete}
            disabled={completing || !ready}
            className={`text-xs rounded-full border px-3 py-1 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-default ${
              completed
                ? "border-accent bg-accent text-accent-ink"
                : "border-line text-ink-soft hover:border-accent hover:text-accent"
            }`}
          >
            {completed ? "✓ Completed" : "Mark complete"}
          </button>
        </div>
      </section>

      {!ready ? (
        <GeneratingState status={lesson.status} error={lesson.error} />
      ) : (
        <>
        <div
            className={
              railOpen
                ? "grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]"
                : "mx-auto max-w-3xl"
            }
          >
          <div className="min-w-0">
            <nav
              aria-label="Lesson sections"
              className="rise sticky top-0 z-10 mt-10 bg-paper/85 backdrop-blur-sm border-b border-line"
            >
              <div className="flex gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => switchTab(t.key)}
                    aria-current={tab === t.key ? "page" : undefined}
                    className={`relative px-4 py-3 text-sm font-medium transition-colors cursor-pointer ${
                      tab === t.key ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                    }`}
                  >
                    {t.label}
                    <span
                      className={`absolute inset-x-3 -bottom-px h-0.5 rounded-full transition-all duration-300 ${
                        tab === t.key ? "bg-accent" : "bg-transparent"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </nav>

            <section className="mt-8 pb-24">
              {tab === "slides" && (
                <Slides
                  lessonId={lessonId}
                  slides={data.materials!.slides}
                  deckMeta={data.deckMeta}
                  lessonTitle={lesson.title}
                  onDeckChange={() => void refresh()}
                  index={index}
                  onIndexChange={setIndex}
                  annos={annos}
                  onPickHighlight={pickHighlight}
                />
              )}
              {tab === "takeaways" && (
                <Takeaways takeaways={data.materials!.takeaways} />
              )}
              {tab === "quiz" && (
                <Quiz
                  lessonId={lessonId}
                  quiz={data.materials!.quiz}
                  attempts={data.attempts}
                  onGraded={() => void refresh()}
                />
              )}
            </section>
          </div>

            {railOpen ? (
              <LessonRail
                tab={tab}
                lessonId={lessonId}
                slides={data.materials!.slides}
                safeIndex={safeIndex}
                annos={annos}
                focusId={focusId}
                onJump={onJump}
                onCollapse={() => toggleRail(false)}
              />
            ) : null}
          </div>
          {!railOpen && (
            <button
              type="button"
              onClick={() => toggleRail(true)}
              className="fixed right-4 top-1/2 z-20 -translate-y-1/2 rounded-full border border-line bg-paper-raised px-3 py-2 text-xs text-ink-soft shadow-[0_10px_24px_-12px_rgba(35,29,18,0.5)] hover:border-accent hover:text-accent transition-colors cursor-pointer print:hidden"
            >
              Notes &amp; Tutor
            </button>
          )}
        </>
      )}
    </Shell>
  );
}

function GeneratingState({
  status,
  error,
}: {
  status: LessonRow["status"];
  error: string | null;
}) {
  if (status === "error") {
    return (
      <div className="rise mt-16 max-w-md">
        <p className="font-display text-xl">This lesson hit a snag.</p>
        <p role="alert" className="mt-2 text-sm text-ink-soft">
          {error ?? "Something went wrong while preparing the materials."}
        </p>
        <p className="mt-4 text-sm text-ink-soft">
          Folio is retrying now — this page will refresh itself.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-16 max-w-xl" role="status" aria-live="polite">
      <p className="rise font-display text-xl">
        Preparing this lesson<span className="caret" />
      </p>
      <p className="rise mt-2 text-sm text-ink-soft" style={{ animationDelay: "80ms" }}>
        Folio is reading these pages and writing your slides, takeaways, and
        quiz. Usually under a minute — it&apos;ll appear right here.
      </p>
      <div className="mt-10 space-y-4" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="working-sheen rounded-xl border border-line-soft bg-paper-raised h-20"
            style={{ animationDelay: `${i * 250}ms` }}
          />
        ))}
      </div>
    </div>
  );
}

function NavArrow({
  href,
  label,
  highlight = false,
  children,
}: {
  href: string | null;
  label: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const base = `inline-flex size-9 items-center justify-center rounded-full border transition-all ${
    highlight
      ? "border-accent bg-accent text-accent-ink hover:opacity-90"
      : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
  }`;
  if (!href) {
    return (
      <span aria-hidden className={`${base} opacity-30 pointer-events-none`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} aria-label={label} className={base}>
      {children}
    </Link>
  );
}

function Shell({
  accent,
  bookId,
  bookTitle,
  children,
}: {
  accent?: number;
  bookId?: string;
  bookTitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <main
      className={`mx-auto w-full max-w-7xl px-6 ${
        accent !== undefined ? `accent-${accent}` : ""
      }`}
    >
      <header className="flex items-center justify-between gap-4 py-6">
        <Wordmark />
        {bookId && (
          <Link
            href={`/books/${bookId}`}
            className="min-w-0 text-sm text-ink-soft hover:text-ink transition-colors truncate"
          >
            ← {bookTitle ?? "Curriculum"}
          </Link>
        )}
      </header>
      {children}
    </main>
  );
}
