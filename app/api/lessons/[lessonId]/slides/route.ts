import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { parseDeckOptions } from "@/lib/deck";
import { generateDeck } from "@/lib/deck-generate";
import { runExclusive } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Params = { params: Promise<{ lessonId: string }> };

/** Regenerate the slide deck with custom options (format, length, focus). */
export async function POST(req: Request, { params }: Params) {
  const { lessonId } = await params;
  const lesson = db.getLesson(lessonId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  if (lesson.status !== "ready" || !db.getMaterials(lessonId)) {
    return NextResponse.json(
      { error: "Lesson materials are not ready yet" },
      { status: 409 }
    );
  }

  const options = parseDeckOptions(await req.json().catch(() => ({})));
  const text = db.getPagesMarked(lesson.book_id, lesson.page_start, lesson.page_end);

  try {
    const slides = await runExclusive(`deck:${lessonId}`, () =>
      generateDeck({ title: lesson.title, summary: lesson.summary }, text, options)
    );
    const deckMeta = { ...options, generatedAt: new Date().toISOString() };
    db.saveDeck(lessonId, slides, deckMeta);
    // The whole deck changed — index-anchored annotations no longer line up.
    db.deleteSlideAnnotations(lessonId);
    return NextResponse.json({ slides, deckMeta });
  } catch (err) {
    const message = (err as Error).message;
    if (message === "BUSY") {
      return NextResponse.json(
        { error: "This deck is already being regenerated" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
