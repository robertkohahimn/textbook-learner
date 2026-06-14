import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { reviseSlide } from "@/lib/deck-generate";
import { runExclusive } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ lessonId: string }> };

/** Revise one slide following a free-form instruction, grounded in the source. */
export async function POST(req: Request, { params }: Params) {
  const { lessonId } = await params;
  const lesson = db.getLesson(lessonId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  const materials = db.getMaterials(lessonId);
  if (lesson.status !== "ready" || !materials) {
    return NextResponse.json(
      { error: "Lesson materials are not ready yet" },
      { status: 409 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    index?: unknown;
    instruction?: unknown;
  };
  const index = typeof body.index === "number" ? Math.round(body.index) : -1;
  const instruction =
    typeof body.instruction === "string" ? body.instruction.trim().slice(0, 500) : "";
  if (index < 0 || index >= materials.slides.length || instruction === "") {
    return NextResponse.json(
      { error: "Provide a valid slide index and a revision instruction" },
      { status: 400 }
    );
  }

  const text = db.getPagesMarked(lesson.book_id, lesson.page_start, lesson.page_end);

  try {
    const revised = await runExclusive(`revise:${lessonId}:${index}`, () =>
      reviseSlide(
        { title: lesson.title, summary: lesson.summary },
        text,
        materials.slides,
        index,
        instruction
      )
    );
    const slides = [...materials.slides];
    slides[index] = revised;
    const deckMeta = db.getDeckMeta(lessonId) ?? {
      format: "presenter" as const,
      length: "default" as const,
      generatedAt: new Date().toISOString(),
    };
    db.saveDeck(lessonId, slides, deckMeta);
    // This slide's text changed — its highlights/notes would point at stale text.
    db.deleteSlideAnnotation(lessonId, index);
    return NextResponse.json({ slides, slide: revised, index });
  } catch (err) {
    const message = (err as Error).message;
    if (message === "BUSY") {
      return NextResponse.json(
        { error: "This slide is already being revised" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
