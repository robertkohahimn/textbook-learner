import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { validateSlideAnnotation } from "@/lib/annotations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string }> };

/** All of a lesson's slide annotations, keyed by slide index. */
export async function GET(_req: Request, { params }: Params) {
  const { lessonId } = await params;
  if (!db.getLesson(lessonId))
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  return NextResponse.json({ annotations: db.getSlideAnnotations(lessonId) });
}

/** Upsert one slide's annotation. Body: { slideIndex, annotation }. */
export async function PUT(req: Request, { params }: Params) {
  const { lessonId } = await params;
  if (!db.getLesson(lessonId))
    return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    slideIndex?: unknown;
    annotation?: unknown;
  };
  const slideIndex =
    typeof body.slideIndex === "number" ? Math.floor(body.slideIndex) : -1;
  if (slideIndex < 0) {
    return NextResponse.json({ error: "Invalid slideIndex" }, { status: 400 });
  }

  const annotation = validateSlideAnnotation(body.annotation);
  db.saveSlideAnnotation(lessonId, slideIndex, annotation);
  return NextResponse.json({ annotation });
}
