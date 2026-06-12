import { NextResponse } from "next/server";
import * as db from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string }> };

export async function POST(req: Request, { params }: Params) {
  const { lessonId } = await params;
  const lesson = db.getLesson(lessonId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { completed?: boolean };
  db.setLessonCompleted(lessonId, body.completed !== false);
  return NextResponse.json({ lesson: db.getLesson(lessonId) });
}
