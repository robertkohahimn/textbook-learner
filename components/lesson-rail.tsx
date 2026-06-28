"use client";

import { memo } from "react";
import type { Slide } from "@/lib/deck";
import {
  AnnotationPanel,
  NotesRollup,
  type SlideAnnotations,
} from "./slide-annotations";
import { Tutor } from "./tutor";
import { emptyAnnotation } from "@/lib/annotations";

// Memoized so per-keystroke note edits in the rail (which re-render LessonRail)
// do not re-render an actively streaming tutor. Props are primitives that stay
// stable across note edits, so the shallow compare holds.
const TutorPanel = memo(Tutor);

export function LessonRail({
  tab,
  lessonId,
  slides,
  safeIndex,
  annos,
  focusId,
  onJump,
  onCollapse,
}: {
  tab: "slides" | "takeaways" | "quiz";
  lessonId: string;
  slides: Slide[];
  safeIndex: number;
  annos: SlideAnnotations;
  focusId: string | null;
  onJump: (index: number) => void;
  onCollapse: () => void;
}) {
  const ann = annos.annotations[safeIndex] ?? emptyAnnotation();

  return (
    <aside className="mt-8 flex flex-col gap-4 lg:sticky lg:top-0 lg:mt-0 lg:h-[100dvh] lg:py-6 print:hidden">
      <div className="flex shrink-0 items-center justify-between lg:pt-0">
        <p className="font-mono text-xs text-ink-faint">Notes &amp; Tutor</p>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse panel"
          className="rounded-full border border-line px-2 py-1 text-xs text-ink-soft hover:border-ink-faint hover:text-ink transition-colors cursor-pointer"
        >
          Hide ›
        </button>
      </div>
      <section className="rounded-xl border border-line bg-paper-raised px-4 py-3 lg:max-h-[45%] lg:overflow-y-auto">
        {tab === "slides" ? (
          <AnnotationPanel
            annotation={ann}
            focusId={focusId}
            slideNumber={safeIndex + 1}
            onNoteChange={(note) => annos.setSlideNote(safeIndex, note)}
            onHighlightNote={(id, note) =>
              annos.setHighlightNote(safeIndex, id, note)
            }
            onRemove={(id) => annos.removeHighlight(safeIndex, id)}
          />
        ) : (
          <>
            <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
              Your notes
            </p>
            <div className="mt-2">
              <NotesRollup
                annotations={annos.annotations}
                slides={slides}
                onJump={onJump}
              />
            </div>
          </>
        )}
      </section>

      <section className="flex min-h-[60vh] flex-1 flex-col rounded-xl border border-line bg-paper-raised px-4 py-3 lg:min-h-0">
        <p className="mb-2 shrink-0 text-xs uppercase tracking-[0.2em] text-ink-faint">
          Tutor
        </p>
        <TutorPanel
          lessonId={lessonId}
          slideIndex={safeIndex}
          slideTitle={slides[safeIndex]?.title ?? ""}
        />
      </section>
    </aside>
  );
}
