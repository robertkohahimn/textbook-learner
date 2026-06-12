import { NextResponse } from "next/server";
import * as db from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string }> };

export async function POST(req: Request, { params }: Params) {
  const { lessonId } = await params;
  const materials = db.getMaterials(lessonId);
  if (!materials) {
    return NextResponse.json({ error: "Quiz not ready yet" }, { status: 409 });
  }
  const body = (await req.json().catch(() => ({}))) as { answers?: number[] };
  const answers = body.answers;
  if (!Array.isArray(answers) || answers.length !== materials.quiz.length) {
    return NextResponse.json(
      { error: `Expected ${materials.quiz.length} answers` },
      { status: 400 }
    );
  }

  const results = materials.quiz.map((q, i) => ({
    correct: answers[i] === q.answerIndex,
    answerIndex: q.answerIndex,
    explanation: q.explanation,
  }));
  const score = results.filter((r) => r.correct).length;
  db.insertQuizAttempt(lessonId, score, materials.quiz.length, answers);

  return NextResponse.json({ score, total: materials.quiz.length, results });
}
