"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatPageRefs,
  type DeckFormat,
  type DeckLength,
  type DeckMeta,
  type Slide,
} from "@/lib/deck";
import { WorkingDot } from "./bits";
import { MathText } from "./math-text";
import {
  AnnotationPanel,
  captureFieldSelection,
  Highlightable,
  useSlideAnnotations,
  type FieldSelection,
} from "./slide-annotations";
import { emptyAnnotation, type Highlight } from "@/lib/annotations";

export function Slides({
  lessonId,
  slides,
  deckMeta,
  lessonTitle,
  onDeckChange,
}: {
  lessonId: string;
  slides: Slide[];
  deckMeta: DeckMeta | null;
  lessonTitle: string;
  onDeckChange: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [view, setView] = useState<"deck" | "grid">("deck");
  const [showNotes, setShowNotes] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [annotateOpen, setAnnotateOpen] = useState(false);
  const [selection, setSelection] = useState<FieldSelection | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const presentRef = useRef<HTMLDivElement>(null);
  const annos = useSlideAnnotations(lessonId);

  const slide = slides[Math.min(index, slides.length - 1)];
  const safeIndex = Math.min(index, slides.length - 1);
  const ann = annos.annotations[safeIndex] ?? emptyAnnotation();

  const captureSelection = useCallback(() => {
    if (!stageRef.current) return;
    setSelection(captureFieldSelection(stageRef.current));
  }, []);

  function addHighlightFromSelection() {
    if (!selection) return;
    const hl: Highlight = {
      id: crypto.randomUUID(),
      field: selection.field,
      start: selection.start,
      end: selection.end,
      quote: selection.quote,
    };
    annos.addHighlight(safeIndex, hl);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
    setAnnotateOpen(true);
  }

  const pickHighlight = useCallback((id: string) => {
    setAnnotateOpen(true);
    setFocusId(id);
    setTimeout(() => {
      document
        .getElementById(`hl-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 60);
  }, []);

  // A regenerated deck may be shorter than where the reader was.
  useEffect(() => {
    setIndex((i) => Math.min(i, slides.length - 1));
  }, [slides.length]);

  const prev = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);
  const next = useCallback(
    () => setIndex((i) => Math.min(i + 1, slides.length - 1)),
    [slides.length]
  );

  // A pending selection belongs to the slide it was made on — drop it on any
  // navigation so the floating Highlight button can't save to the wrong slide.
  useEffect(() => {
    setSelection(null);
  }, [index, view, slides]);

  const present = useCallback(() => {
    presentRef.current?.requestFullscreen?.().catch((err: unknown) => {
      console.warn("Fullscreen unavailable:", err);
    });
  }, []);

  useEffect(() => {
    function onFullscreen() {
      setPresenting(document.fullscreenElement === presentRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      )
        return;
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
      if (e.key === "n" || e.key === "N") setShowNotes((v) => !v);
      if (e.key === "g" || e.key === "G")
        setView((v) => (v === "grid" ? "deck" : "grid"));
      if (e.key === "f" || e.key === "F") present();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev, present]);

  async function exportPptx() {
    setExportOpen(false);
    const accent = stageRef.current
      ? getComputedStyle(stageRef.current).getPropertyValue("--accent").trim()
      : undefined;
    const { exportDeckPptx } = await import("@/lib/pptx");
    await exportDeckPptx(slides, { lessonTitle, accent });
  }

  function exportPdf() {
    setExportOpen(false);
    window.print();
  }

  return (
    <div className="fade">
      {/* toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="font-mono text-xs text-ink-faint">
          {deckMeta?.format === "detailed" ? "Detailed deck" : "Presenter deck"} ·{" "}
          {slides.length} slides
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <ToolButton
            onClick={() => setShowNotes((v) => !v)}
            active={showNotes}
            title="Speaker notes (N)"
          >
            Notes
          </ToolButton>
          <ToolButton
            onClick={() => setView((v) => (v === "grid" ? "deck" : "grid"))}
            active={view === "grid"}
            title="Overview grid (G)"
          >
            Grid
          </ToolButton>
          <ToolButton onClick={present} title="Present fullscreen (F)">
            Present
          </ToolButton>
          <div className="relative">
            <ToolButton onClick={() => setExportOpen((v) => !v)} active={exportOpen}>
              Export
            </ToolButton>
            {exportOpen && (
              <div className="absolute right-0 top-full z-20 mt-1.5 w-44 rounded-xl border border-line bg-paper-raised py-1.5 shadow-[0_14px_30px_-18px_rgba(35,29,18,0.5)]">
                <MenuItem onClick={() => void exportPptx()}>
                  PowerPoint (.pptx)
                </MenuItem>
                <MenuItem onClick={exportPdf}>PDF (print)</MenuItem>
              </div>
            )}
          </div>
          <ToolButton
            onClick={() => setAnnotateOpen((v) => !v)}
            active={annotateOpen}
            title="Highlights & your notes"
          >
            Annotate
            {(ann.highlights.length > 0 || ann.note) && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />
            )}
          </ToolButton>
          <ToolButton
            onClick={() => setCustomizeOpen((v) => !v)}
            active={customizeOpen}
          >
            Customize
          </ToolButton>
        </div>
      </div>

      {customizeOpen && (
        <CustomizePanel
          lessonId={lessonId}
          deckMeta={deckMeta}
          onDone={() => {
            setCustomizeOpen(false);
            setIndex(0);
            annos.reset(); // the server cleared this deck's annotations
            onDeckChange();
          }}
        />
      )}

      {selection && (
        <div
          className="fixed z-30 print:hidden"
          style={{
            left: selection.rect.left + selection.rect.width / 2,
            top: selection.rect.top - 8,
            transform: "translate(-50%, -100%)",
          }}
          onMouseDown={(e) => e.preventDefault()} // keep the text selection alive
        >
          <button
            type="button"
            onClick={addHighlightFromSelection}
            className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-ink px-3 py-1.5 text-xs text-paper shadow-[0_10px_24px_-12px_rgba(35,29,18,0.7)] cursor-pointer"
          >
            <span aria-hidden>✦</span> Highlight
          </button>
        </div>
      )}

      {view === "grid" ? (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 print:hidden">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setIndex(i);
                setView("deck");
              }}
              className={`group text-left cursor-pointer rounded-xl transition-all ${
                i === index ? "ring-2 ring-accent ring-offset-2 ring-offset-paper" : ""
              }`}
              aria-label={`Go to slide ${i + 1}: ${s.title}`}
            >
              <Stage
                slide={s}
                index={i}
                total={slides.length}
                thumb
                highlights={(annos.annotations[i] ?? emptyAnnotation()).highlights}
              />
              <p className="mt-1.5 truncate font-mono text-[11px] text-ink-faint group-hover:text-ink-soft">
                {i + 1} · {s.title}
              </p>
            </button>
          ))}
        </div>
      ) : (
        <div className="print:hidden">
          {/* presentation surface: fullscreen target wraps the stage */}
          <div
            ref={presentRef}
            className={
              presenting
                ? "flex h-full w-full flex-col items-center justify-center bg-paper p-[3vmin]"
                : "mt-5"
            }
          >
            <div
              ref={stageRef}
              key={index}
              onMouseDown={() => setSelection(null)}
              onMouseUp={captureSelection}
              // Keyboard entry point: a selection made via the browser's caret
              // (Shift+arrows / caret browsing) is captured on keyup, then the
              // floating Highlight button (a real <button>) is focusable.
              onKeyUp={captureSelection}
              className={`slide-in w-full ${
                presenting ? "max-w-[min(100vw,170vh)]" : ""
              }`}
            >
              <Stage
                slide={slide}
                index={index}
                total={slides.length}
                highlights={ann.highlights}
                onPick={pickHighlight}
              />
            </div>

            {presenting && (
              <div className="mt-4 flex w-full max-w-[min(100vw,170vh)] items-center justify-between">
                <NavButton onClick={prev} disabled={index === 0}>
                  ← Back
                </NavButton>
                {showNotes && slide.notes ? (
                  <p className="mx-6 max-w-3xl text-center text-sm leading-relaxed text-ink-soft">
                    <MathText>{slide.notes}</MathText>
                  </p>
                ) : (
                  <span className="font-mono text-xs text-ink-faint">
                    {index + 1} / {slides.length} · N notes · esc exits
                  </span>
                )}
                <NavButton onClick={next} disabled={index === slides.length - 1}>
                  Next →
                </NavButton>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <NavButton onClick={prev} disabled={index === 0}>
              ← Back
            </NavButton>
            <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
              {slides.map((s, i) => {
                const a = annos.annotations[i];
                const annotated = Boolean(a && (a.highlights.length > 0 || a.note));
                return (
                  <button
                    key={i}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={`Slide ${i + 1}: ${s.title}${
                      annotated ? " (annotated)" : ""
                    }`}
                    onClick={() => setIndex(i)}
                    className={`rounded-full transition-all duration-300 cursor-pointer ${
                      i === index
                        ? "w-6 h-1.5 bg-accent"
                        : "size-1.5 bg-line hover:bg-ink-faint"
                    } ${
                      annotated && i !== index
                        ? "ring-1 ring-[rgba(217,164,38,0.95)] ring-offset-1 ring-offset-paper"
                        : ""
                    }`}
                  />
                );
              })}
            </div>
            <NavButton onClick={next} disabled={index === slides.length - 1}>
              Next →
            </NavButton>
          </div>

          {showNotes && (
            <div className="rise mt-5 rounded-xl border border-line-soft bg-paper-raised px-5 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
                Speaker notes
              </p>
              <p className="mt-2 leading-relaxed text-ink-soft">
                <MathText>{slide.notes || "No notes for this slide."}</MathText>
              </p>
            </div>
          )}

          {annotateOpen && (
            <AnnotationPanel
              annotation={ann}
              focusId={focusId}
              onNoteChange={(note) => annos.setSlideNote(safeIndex, note)}
              onHighlightNote={(id, note) =>
                annos.setHighlightNote(safeIndex, id, note)
              }
              onRemove={(id) => annos.removeHighlight(safeIndex, id)}
            />
          )}

          <div className="mt-4">
            {reviseOpen ? (
              <RevisePanel
                lessonId={lessonId}
                index={index}
                onClose={() => setReviseOpen(false)}
                onDone={() => {
                  setReviseOpen(false);
                  annos.clearLocal(safeIndex); // server cleared this slide's annotations
                  onDeckChange();
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setReviseOpen(true)}
                className="text-xs text-ink-faint hover:text-accent transition-colors cursor-pointer"
              >
                ✎ Revise this slide
              </button>
            )}
          </div>

          <p className="mt-3 text-center text-xs text-ink-faint">
            Tip: select text to highlight · ← → slides · N notes · G grid · F present
          </p>
        </div>
      )}

      {/* print-only: the whole deck, one slide per page, notes underneath */}
      <div className="print-deck hidden print:block">
        {slides.map((s, i) => (
          <div key={i} className="break-after-page pb-6">
            <Stage
              slide={s}
              index={i}
              total={slides.length}
              highlights={(annos.annotations[i] ?? emptyAnnotation()).highlights}
            />
            {s.notes && (
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                <span className="font-mono text-xs text-ink-faint">Notes · </span>
                <MathText>{s.notes}</MathText>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- the slide surface ---------- */

function Stage({
  slide,
  index,
  total,
  thumb = false,
  highlights = [],
  onPick,
}: {
  slide: Slide;
  index: number;
  total: number;
  thumb?: boolean;
  highlights?: Highlight[];
  onPick?: (id: string) => void;
}) {
  return (
    <div
      className={`slide-stage relative flex aspect-[16/9] w-full flex-col overflow-hidden rounded-2xl border border-line bg-paper-raised ${
        thumb ? "" : "shadow-[0_18px_40px_-28px_rgba(35,29,18,0.5)]"
      }`}
      aria-live={thumb ? undefined : "polite"}
    >
      <span
        aria-hidden
        className="absolute top-0 left-[6cqw] right-[6cqw] h-[0.45cqw] min-h-[2px] rounded-b bg-accent"
      />
      <SlideBody slide={slide} highlights={highlights} onPick={onPick} />
      <div className="absolute bottom-[3cqw] left-[6cqw] right-[6cqw] flex items-end justify-between">
        {slide.pages?.length ? (
          <span className="font-mono text-[1.5cqw] text-ink-faint">
            {formatPageRefs(slide.pages)}
          </span>
        ) : (
          <span />
        )}
        <span className="font-mono text-[1.5cqw] text-ink-faint">
          {index + 1} / {total}
        </span>
      </div>
    </div>
  );
}

function SlideBody({
  slide,
  highlights,
  onPick,
}: {
  slide: Slide;
  highlights: Highlight[];
  onPick?: (id: string) => void;
}) {
  // Render one annotatable field by its stable key.
  const H = (field: string, text: string) => (
    <Highlightable
      field={field}
      text={text}
      highlights={highlights}
      onPick={onPick}
    />
  );

  switch (slide.layout) {
    case "title":
      return (
        <div className="flex flex-1 flex-col items-center justify-center px-[8cqw] text-center">
          <h2 className="font-display text-[5.6cqw] font-medium leading-[1.12] text-balance">
            {H("title", slide.title)}
          </h2>
          {slide.subtitle && (
            <p className="mt-[2.4cqw] max-w-[70cqw] text-[2.4cqw] leading-snug text-ink-soft">
              {H("subtitle", slide.subtitle)}
            </p>
          )}
        </div>
      );
    case "section":
      return (
        <div className="flex flex-1 flex-col justify-center px-[8cqw]">
          <p className="text-[1.7cqw] uppercase tracking-[0.25em] text-accent">
            Section
          </p>
          <h2 className="mt-[1.6cqw] font-display text-[5cqw] font-medium leading-[1.12] text-balance">
            {H("title", slide.title)}
          </h2>
          {slide.subtitle && (
            <p className="mt-[1.8cqw] max-w-[64cqw] text-[2.2cqw] leading-snug text-ink-soft">
              {H("subtitle", slide.subtitle)}
            </p>
          )}
        </div>
      );
    case "two-column":
      return (
        <ContentFrame title={slide.title} renderField={H}>
          <div
            className="grid flex-1 content-start gap-[3.4cqw]"
            style={{
              gridTemplateColumns: `repeat(${slide.columns?.length ?? 2}, 1fr)`,
            }}
          >
            {slide.columns?.map((col, ci) => (
              <div key={ci}>
                <h3 className="border-b border-line pb-[1cqw] text-[2.1cqw] font-semibold text-accent">
                  {H(`col:${ci}:heading`, col.heading)}
                </h3>
                <ul className="mt-[1.6cqw] space-y-[1.3cqw]">
                  {col.bullets.map((b, bi) => (
                    <li key={bi} className="flex gap-[1cqw] text-[1.95cqw] leading-snug">
                      <span
                        aria-hidden
                        className="mt-[0.85cqw] size-[0.7cqw] shrink-0 rounded-full bg-accent"
                      />
                      <span>{H(`col:${ci}:bullet:${bi}`, b)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </ContentFrame>
      );
    case "quote":
      return (
        <ContentFrame title={slide.title} renderField={H}>
          <div className="flex flex-1 flex-col items-center justify-center px-[4cqw] text-center">
            <span aria-hidden className="font-display text-[7cqw] leading-none text-accent">
              “
            </span>
            <blockquote className="-mt-[2cqw] max-w-[64cqw] font-display text-[3.1cqw] italic leading-[1.3] text-balance">
              {H("quote", slide.quote?.text ?? "")}
            </blockquote>
            {slide.quote?.attribution && (
              <p className="mt-[2cqw] text-[1.9cqw] text-ink-soft">
                — {H("attribution", slide.quote.attribution)}
              </p>
            )}
          </div>
        </ContentFrame>
      );
    case "big-fact":
      return (
        <ContentFrame title={slide.title} renderField={H}>
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="font-display text-[10cqw] font-medium leading-none text-accent">
              {H("fact:value", slide.fact?.value ?? "")}
            </p>
            <p className="mt-[2cqw] max-w-[58cqw] text-[2.3cqw] leading-snug text-ink-soft">
              {H("fact:label", slide.fact?.label ?? "")}
            </p>
          </div>
        </ContentFrame>
      );
    case "process":
      return (
        <ContentFrame title={slide.title} renderField={H}>
          <ol className="flex flex-1 flex-col justify-center gap-[2.2cqw]">
            {slide.steps?.map((step, si) => (
              <li key={si} className="flex gap-[2cqw]">
                <span className="font-mono text-[2cqw] leading-[1.4] text-accent">
                  {String(si + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="text-[2.1cqw] font-semibold leading-[1.35]">
                    {H(`step:${si}:label`, step.label)}
                  </p>
                  {step.detail && (
                    <p className="text-[1.85cqw] leading-snug text-ink-soft">
                      {H(`step:${si}:detail`, step.detail)}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </ContentFrame>
      );
    case "recap":
    case "bullets":
    default:
      return (
        <ContentFrame title={slide.title} renderField={H}>
          <ul className="flex max-w-[72cqw] flex-1 flex-col justify-center gap-[2.2cqw]">
            {slide.bullets?.map((bullet, bi) => (
              <li key={bi} className="flex gap-[1.6cqw] text-[2.4cqw] leading-snug">
                <span
                  aria-hidden
                  className={`mt-[0.95cqw] shrink-0 ${
                    slide.layout === "recap"
                      ? "font-mono text-[1.8cqw] leading-none text-accent"
                      : "size-[0.8cqw] rounded-full bg-accent"
                  }`}
                >
                  {slide.layout === "recap" ? String(bi + 1).padStart(2, "0") : ""}
                </span>
                <span>{H(`bullet:${bi}`, bullet)}</span>
              </li>
            ))}
          </ul>
        </ContentFrame>
      );
  }
}

function ContentFrame({
  title,
  renderField,
  children,
}: {
  title: string;
  renderField: (field: string, text: string) => React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col px-[6cqw] pt-[5cqw] pb-[7cqw]">
      <h2 className="font-display text-[3.4cqw] font-medium leading-[1.15] text-balance">
        {renderField("title", title)}
      </h2>
      <div className="mt-[2.6cqw] flex flex-1 flex-col">{children}</div>
    </div>
  );
}

/* ---------- customize & revise ---------- */

const FORMATS: { value: DeckFormat; label: string; hint: string }[] = [
  { value: "presenter", label: "Presenter", hint: "punchy talking points + notes" },
  { value: "detailed", label: "Detailed", hint: "full text, reads on its own" },
];

const LENGTHS: { value: DeckLength; label: string }[] = [
  { value: "short", label: "Short" },
  { value: "default", label: "Standard" },
  { value: "long", label: "In-depth" },
];

function CustomizePanel({
  lessonId,
  deckMeta,
  onDone,
}: {
  lessonId: string;
  deckMeta: DeckMeta | null;
  onDone: () => void;
}) {
  const [format, setFormat] = useState<DeckFormat>(deckMeta?.format ?? "presenter");
  const [length, setLength] = useState<DeckLength>(deckMeta?.length ?? "default");
  const [focus, setFocus] = useState(deckMeta?.focus ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, length, focus: focus.trim() || undefined }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Regeneration failed");
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rise mt-4 rounded-xl border border-line bg-paper-raised px-5 py-4 print:hidden">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <fieldset>
          <legend className="text-xs uppercase tracking-[0.2em] text-ink-faint">
            Format
          </legend>
          <div className="mt-2 flex gap-1.5">
            {FORMATS.map((f) => (
              <ChoiceChip
                key={f.value}
                active={format === f.value}
                onClick={() => setFormat(f.value)}
                title={f.hint}
              >
                {f.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs uppercase tracking-[0.2em] text-ink-faint">
            Length
          </legend>
          <div className="mt-2 flex gap-1.5">
            {LENGTHS.map((l) => (
              <ChoiceChip
                key={l.value}
                active={length === l.value}
                onClick={() => setLength(l.value)}
              >
                {l.label}
              </ChoiceChip>
            ))}
          </div>
        </fieldset>
      </div>
      <label className="mt-4 block">
        <span className="text-xs uppercase tracking-[0.2em] text-ink-faint">
          Focus
        </span>
        <textarea
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="Optional — audience, tone, or emphasis. e.g. “Explain it for a curious 12-year-old” or “Go deep on the math.”"
          className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm leading-relaxed placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
      </label>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={() => void regenerate()}
          disabled={busy}
          className="rounded-full border border-accent bg-accent px-4 py-2 text-sm text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer disabled:cursor-default"
        >
          Regenerate deck
        </button>
        {busy && <WorkingDot label="Rewriting your deck — usually under a minute" />}
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function RevisePanel({
  lessonId,
  index,
  onClose,
  onDone,
}: {
  lessonId: string;
  index: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revise() {
    if (!instruction.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/slides/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index, instruction: instruction.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Revision failed");
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="rise rounded-xl border border-line bg-paper-raised px-4 py-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void revise();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          autoFocus
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          maxLength={500}
          placeholder={`Revise slide ${index + 1} — e.g. “simplify this” or “turn it into a comparison”`}
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !instruction.trim()}
          className="rounded-full border border-accent bg-accent px-4 py-2 text-sm text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer disabled:cursor-default"
        >
          Apply
        </button>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="text-sm text-ink-faint hover:text-ink-soft transition-colors cursor-pointer"
        >
          Cancel
        </button>
      </form>
      <div className="mt-2 flex items-center gap-4 empty:hidden">
        {busy && <WorkingDot label="Revising this slide…" />}
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/* ---------- small bits ---------- */

function ToolButton({
  children,
  onClick,
  active = false,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-xs transition-colors cursor-pointer ${
        active
          ? "border-accent bg-accent text-accent-ink"
          : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ChoiceChip({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm transition-colors cursor-pointer ${
        active
          ? "border-accent bg-accent text-accent-ink"
          : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function MenuItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-4 py-2 text-left text-sm text-ink-soft hover:bg-paper-deep hover:text-ink transition-colors cursor-pointer"
    >
      {children}
    </button>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-line px-4 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-default"
    >
      {children}
    </button>
  );
}
