/**
 * Slide annotations — pure model + render planning, no DOM. Shared by the
 * client (highlight rendering, validation) and the server (API/DB validation).
 *
 * A highlight anchors to a character range in a field's *logical string*:
 * splitMath() segments joined by their values, where each math unit counts as
 * its source length and is atomic (covered whole or not at all). Capture and
 * render use the same model, so offsets survive re-render — the KaTeX HTML never
 * enters the math.
 */

import { splitMath } from "./math";

export interface Highlight {
  id: string;
  field: string;
  start: number;
  end: number;
  quote: string;
  note?: string;
}

export interface SlideAnnotation {
  note: string;
  highlights: Highlight[];
}

export interface FieldPiece {
  kind: "text" | "math";
  value: string;
  marked: boolean;
  ids: string[];
}

export function emptyAnnotation(): SlideAnnotation {
  return { note: "", highlights: [] };
}

/** Total logical length of a field's text (text + atomic math, by source). */
export function logicalLength(text: string): number {
  return splitMath(text).reduce((n, seg) => n + seg.value.length, 0);
}

/**
 * Split a field into ordered render pieces. Text segments are cut at every
 * highlight boundary; a math segment is marked whole if any range overlaps it.
 */
export function buildFieldPieces(
  text: string,
  ranges: Pick<Highlight, "start" | "end" | "id">[]
): FieldPiece[] {
  const segments = splitMath(text);
  const pieces: FieldPiece[] = [];
  let pos = 0;

  const idsCovering = (from: number, to: number): string[] => {
    const ids: string[] = [];
    for (const r of ranges) {
      if (r.start < to && r.end > from && !ids.includes(r.id)) ids.push(r.id);
    }
    return ids;
  };

  for (const seg of segments) {
    const segStart = pos;
    const segEnd = pos + seg.value.length;

    if (seg.type === "text") {
      // Collect every boundary inside this segment, then emit runs between them.
      const cuts = new Set<number>([segStart, segEnd]);
      for (const r of ranges) {
        if (r.start > segStart && r.start < segEnd) cuts.add(r.start);
        if (r.end > segStart && r.end < segEnd) cuts.add(r.end);
      }
      const sorted = [...cuts].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length - 1; i++) {
        const from = sorted[i];
        const to = sorted[i + 1];
        const ids = idsCovering(from, to);
        pieces.push({
          kind: "text",
          value: seg.value.slice(from - segStart, to - segStart),
          marked: ids.length > 0,
          ids,
        });
      }
    } else {
      const ids = idsCovering(segStart, segEnd);
      pieces.push({
        kind: "math",
        value: seg.value,
        marked: ids.length > 0,
        ids,
      });
    }
    pos = segEnd;
  }

  // Coalesce adjacent text pieces that share the exact same mark state.
  const merged: FieldPiece[] = [];
  for (const p of pieces) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.kind === "text" &&
      p.kind === "text" &&
      prev.marked === p.marked &&
      prev.ids.join() === p.ids.join()
    ) {
      prev.value += p.value;
    } else {
      merged.push({ ...p, ids: [...p.ids] });
    }
  }
  return merged;
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

/** Sanitize an annotation from the API or DB into a well-formed object. */
export function validateSlideAnnotation(data: unknown): SlideAnnotation {
  const root = (typeof data === "object" && data !== null ? data : {}) as Record<
    string,
    unknown
  >;
  const note = isString(root.note) ? root.note.trim() : "";

  const rawHighlights = Array.isArray(root.highlights) ? root.highlights : [];
  const highlights: Highlight[] = [];
  for (const h of rawHighlights) {
    const hl = (typeof h === "object" && h !== null ? h : {}) as Record<
      string,
      unknown
    >;
    const field = isString(hl.field) ? hl.field : "";
    const start = typeof hl.start === "number" ? Math.floor(hl.start) : NaN;
    const end = typeof hl.end === "number" ? Math.floor(hl.end) : NaN;
    if (!field || !Number.isFinite(start) || !Number.isFinite(end) || start >= end || start < 0)
      continue;
    const out: Highlight = {
      id: isString(hl.id) && hl.id ? hl.id : `${field}:${start}:${end}`,
      field,
      start,
      end,
      quote: isString(hl.quote) ? hl.quote : "",
    };
    if (isString(hl.note) && hl.note.trim()) out.note = hl.note.trim();
    highlights.push(out);
  }
  return { note, highlights };
}
