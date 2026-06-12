import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { enqueueGenerateLesson } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { lessonId } = await params;
  const lesson = db.getLesson(lessonId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  // Opening a lesson that isn't ready jumps it to the front of the queue.
  if (lesson.status === "pending" || lesson.status === "error") {
    enqueueGenerateLesson(lesson.id, true);
  }

  const book = db.getBook(lesson.book_id);
  const modules = db.getCurriculum(lesson.book_id);
  const flat = modules.flatMap((m) => m.lessons);
  const index = flat.findIndex((l) => l.id === lesson.id);
  const moduleRow = modules.find((m) => m.id === lesson.module_id);

  return NextResponse.json({
    lesson: db.getLesson(lessonId),
    materials: db.getMaterials(lessonId) ?? null,
    attempts: db.getQuizAttempts(lessonId),
    book: book ? { id: book.id, title: book.title, accent: book.accent } : null,
    moduleTitle: moduleRow?.title ?? null,
    prevLessonId: index > 0 ? flat[index - 1].id : null,
    nextLessonId: index >= 0 && index < flat.length - 1 ? flat[index + 1].id : null,
  });
}
