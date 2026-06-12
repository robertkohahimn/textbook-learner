import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { getLlm } from "@/lib/llm";
import { buildTutorPrompt, starterQuestions } from "@/lib/tutor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { lessonId } = await params;
  const lesson = db.getLesson(lessonId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
  const materials = db.getMaterials(lessonId);
  return NextResponse.json({
    messages: db.getTutorMessages(lessonId),
    starters: materials ? starterQuestions(materials) : [],
  });
}

export async function POST(req: Request, { params }: Params) {
  const { lessonId } = await params;
  const lesson = db.getLesson(lessonId);
  if (!lesson) return NextResponse.json({ error: "Lesson not found" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { question?: string };
  const question = body.question?.trim();
  if (!question) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 });
  }

  const history = db.getTutorMessages(lessonId);
  const materials = db.getMaterials(lessonId);
  const lessonText = db.getPagesText(lesson.book_id, lesson.page_start, lesson.page_end);
  const { system, prompt } = buildTutorPrompt(
    { title: lesson.title, summary: lesson.summary },
    materials,
    lessonText,
    history,
    question
  );

  db.insertTutorMessage(lessonId, "user", question);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      let full = "";
      try {
        for await (const chunk of getLlm().stream(prompt, { system })) {
          full += chunk;
          send({ text: chunk });
        }
        if (full.trim()) db.insertTutorMessage(lessonId, "assistant", full);
        send({ done: true });
      } catch (err) {
        send({ error: (err as Error).message || "The tutor hit a snag." });
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
