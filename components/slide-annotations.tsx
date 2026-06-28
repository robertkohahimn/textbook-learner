"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import katex from "katex";
import {
  buildFieldPieces,
  emptyAnnotation,
  type Highlight,
  type SlideAnnotation,
} from "@/lib/annotations";

/* ---------------- rendering ---------------- */

function mathHtml(value: string): string {
  // HTML-only output (no MathML) so selecting math doesn't pick up a duplicated
  // accessibility copy, keeping selection offsets and quote text clean.
  return katex.renderToString(value, { throwOnError: false, output: "html" });
}

/**
 * Like MathText, but also paints user highlights. Each field carries
 * `data-anno-field`; math units carry `data-anno-math` (their logical length)
 * and are treated as atomic when mapping selections to offsets.
 */
export function Highlightable({
  field,
  text,
  highlights,
  onPick,
}: {
  field: string;
  text: string;
  highlights: Highlight[];
  onPick?: (id: string) => void;
}) {
  const ranges = highlights.filter((h) => h.field === field);
  const pieces = buildFieldPieces(text, ranges);

  return (
    <span data-anno-field={field}>
      {pieces.map((p, i) => {
        if (p.kind === "math") {
          const atom = (
            <span
              data-anno-math={p.value.length}
              dangerouslySetInnerHTML={{ __html: mathHtml(p.value) }}
            />
          );
          return p.marked ? (
            <mark
              key={i}
              className="anno-mark"
              data-hl-id={p.ids[0]}
              onClick={onPick ? () => onPick(p.ids[0]) : undefined}
            >
              {atom}
            </mark>
          ) : (
            <span key={i}>{atom}</span>
          );
        }
        return p.marked ? (
          <mark
            key={i}
            className="anno-mark"
            data-hl-id={p.ids[0]}
            onClick={onPick ? () => onPick(p.ids[0]) : undefined}
          >
            {p.value}
          </mark>
        ) : (
          <span key={i}>{p.value}</span>
        );
      })}
    </span>
  );
}

/* ---------------- selection → logical offset ---------------- */

interface Leaf {
  node: Node;
  start: number;
  len: number;
  math: boolean;
}

function fieldLeaves(fieldEl: HTMLElement): { leaves: Leaf[]; total: number } {
  const leaves: Leaf[] = [];
  let acc = 0;
  const walk = (el: Node) => {
    el.childNodes.forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const ce = child as HTMLElement;
        const mathAttr = ce.getAttribute("data-anno-math");
        if (mathAttr !== null) {
          const len = parseInt(mathAttr, 10) || 0;
          leaves.push({ node: ce, start: acc, len, math: true });
          acc += len;
        } else {
          walk(ce);
        }
      } else if (child.nodeType === Node.TEXT_NODE) {
        const len = child.textContent?.length ?? 0;
        leaves.push({ node: child, start: acc, len, math: false });
        acc += len;
      }
    });
  };
  walk(fieldEl);
  return { leaves, total: acc };
}

/** Map a DOM boundary to a logical offset within the field. */
function boundaryToLogical(
  fieldEl: HTMLElement,
  leaves: Leaf[],
  total: number,
  node: Node,
  offset: number,
  side: "start" | "end"
): number {
  // Text-node boundary — the common case.
  if (node.nodeType === Node.TEXT_NODE) {
    const leaf = leaves.find((l) => l.node === node);
    if (leaf) return leaf.start + Math.max(0, Math.min(offset, leaf.len));
  }
  // Boundary on an element: a math atom snaps to its edge; any other element
  // resolves through the first leaf inside the child at `offset`.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as HTMLElement;
    const mathLeaf = leaves.find((l) => l.node === el);
    if (mathLeaf) return side === "end" ? mathLeaf.start + mathLeaf.len : mathLeaf.start;

    const children = el.childNodes;
    if (offset >= children.length) return total;
    const target = children[offset];
    const inside = leaves.find(
      (l) => l.node === target || target.contains(l.node)
    );
    if (inside) return inside.start;
  }
  return side === "end" ? total : 0;
}

export interface FieldSelection {
  field: string;
  start: number;
  end: number;
  quote: string;
  rect: DOMRect;
}

/**
 * Read the current selection and resolve it to a single field + logical range.
 * Cross-field selections clamp to the field that holds the selection start.
 */
export function captureFieldSelection(container: HTMLElement): FieldSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!container.contains(range.startContainer)) return null;

  const startField = closestField(range.startContainer);
  if (!startField) return null;
  const endField = closestField(range.endContainer);
  const sameField = endField === startField;

  const { leaves, total } = fieldLeaves(startField);
  let start = boundaryToLogical(
    startField,
    leaves,
    total,
    range.startContainer,
    range.startOffset,
    "start"
  );
  let end = sameField
    ? boundaryToLogical(startField, leaves, total, range.endContainer, range.endOffset, "end")
    : total;
  if (end < start) [start, end] = [end, start];
  if (end - start < 1) return null;

  const field = startField.getAttribute("data-anno-field") ?? "";
  const quote = logicalSlice(startField, leaves, start, end);
  return { field, start, end, quote, rect: range.getBoundingClientRect() };
}

function logicalSlice(
  fieldEl: HTMLElement,
  leaves: Leaf[],
  start: number,
  end: number
): string {
  void fieldEl;
  let out = "";
  for (const leaf of leaves) {
    const segEnd = leaf.start + leaf.len;
    if (segEnd <= start || leaf.start >= end) continue;
    if (leaf.math) {
      // Atomic and fully covered — use the rendered glyphs, not logical offsets.
      out += leaf.node.textContent ?? "";
    } else {
      const from = Math.max(0, start - leaf.start);
      const to = Math.min(leaf.len, end - leaf.start);
      out += (leaf.node.textContent ?? "").slice(from, to);
    }
  }
  return out.trim() || "(highlight)";
}

function closestField(node: Node): HTMLElement | null {
  let el: Node | null = node;
  while (el && el !== document.body) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      const e = el as HTMLElement;
      if (e.hasAttribute("data-anno-field")) return e;
    }
    el = el.parentNode;
  }
  return null;
}

/* ---------------- load / save hook ---------------- */

export function useSlideAnnotations(lessonId: string) {
  const [annotations, setAnnotations] = useState<Record<number, SlideAnnotation>>(
    {}
  );
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    let active = true;
    fetch(`/api/lessons/${lessonId}/annotations`)
      .then((r) => (r.ok ? r.json() : { annotations: {} }))
      .then((d: { annotations?: Record<number, SlideAnnotation> }) => {
        if (active) setAnnotations(d.annotations ?? {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [lessonId]);

  // Drop a pending debounced PUT (one slide, or all) so a server-side clear
  // isn't undone by a stale save that fires afterward.
  const cancelPersist = useCallback((index?: number) => {
    if (index === undefined) {
      for (const handle of Object.values(timers.current)) clearTimeout(handle);
      timers.current = {};
    } else {
      clearTimeout(timers.current[index]);
      delete timers.current[index];
    }
  }, []);

  const persist = useCallback(
    (index: number, ann: SlideAnnotation, debounce: boolean) => {
      const send = () => {
        fetch(`/api/lessons/${lessonId}/annotations`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slideIndex: index, annotation: ann }),
        }).catch(() => {});
      };
      clearTimeout(timers.current[index]);
      if (debounce) timers.current[index] = setTimeout(send, 500);
      else send();
    },
    [lessonId]
  );

  const update = useCallback(
    (
      index: number,
      fn: (a: SlideAnnotation) => SlideAnnotation,
      debounce = false
    ) => {
      setAnnotations((prev) => {
        const next = fn(prev[index] ?? emptyAnnotation());
        persist(index, next, debounce);
        return { ...prev, [index]: next };
      });
    },
    [persist]
  );

  return {
    annotations,
    reset: () => {
      cancelPersist();
      setAnnotations({});
    },
    clearLocal: (i: number) => {
      cancelPersist(i);
      setAnnotations((prev) => {
        if (!(i in prev)) return prev;
        const next = { ...prev };
        delete next[i];
        return next;
      });
    },
    addHighlight: (i: number, hl: Highlight) =>
      update(i, (a) => ({ ...a, highlights: [...a.highlights, hl] })),
    removeHighlight: (i: number, id: string) =>
      update(i, (a) => ({
        ...a,
        highlights: a.highlights.filter((h) => h.id !== id),
      })),
    setHighlightNote: (i: number, id: string, note: string) =>
      update(
        i,
        (a) => ({
          ...a,
          // Store the raw string so spaces type normally; the server trims on
          // save (validateSlideAnnotation), like the per-slide note path.
          highlights: a.highlights.map((h) =>
            h.id === id ? { ...h, note } : h
          ),
        }),
        true
      ),
    setSlideNote: (i: number, note: string) =>
      update(i, (a) => ({ ...a, note }), true),
  };
}

export type SlideAnnotations = ReturnType<typeof useSlideAnnotations>;

/* ---------------- annotation panel ---------------- */

export function AnnotationPanel({
  annotation,
  focusId,
  onNoteChange,
  onHighlightNote,
  onRemove,
}: {
  annotation: SlideAnnotation;
  focusId: string | null;
  onNoteChange: (note: string) => void;
  onHighlightNote: (id: string, note: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="rise mt-5 rounded-xl border border-line bg-paper-raised px-5 py-4">
      <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">Your notes</p>
      <textarea
        value={annotation.note}
        onChange={(e) => onNoteChange(e.target.value)}
        rows={2}
        placeholder="Jot a note for this slide…"
        className="mt-2 w-full resize-none rounded-lg border border-line bg-paper px-3 py-2 text-sm leading-relaxed placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />

      {annotation.highlights.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
            Highlights
          </p>
          <ul className="mt-2 space-y-2.5">
            {annotation.highlights.map((h) => (
              <li
                key={h.id}
                id={`hl-${h.id}`}
                className={`rounded-lg border px-3 py-2.5 transition-colors ${
                  focusId === h.id ? "border-accent bg-accent/5" : "border-line-soft"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm leading-snug">
                    <span className="anno-mark rounded px-1">{h.quote}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => onRemove(h.id)}
                    aria-label="Remove highlight"
                    className="shrink-0 text-xs text-ink-faint hover:text-bad transition-colors cursor-pointer"
                  >
                    Remove
                  </button>
                </div>
                <input
                  value={h.note ?? ""}
                  onChange={(e) => onHighlightNote(h.id, e.target.value)}
                  placeholder="Add a note to this highlight…"
                  className="mt-2 w-full rounded-md border border-line bg-paper px-2.5 py-1.5 text-sm placeholder:text-ink-faint focus:border-accent focus:outline-none"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
