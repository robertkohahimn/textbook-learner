import { NextResponse } from "next/server";
import * as db from "@/lib/db";
import { gradeAttempt } from "@/lib/quiz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ lessonId: string }> };

export async function POST(req: Request, { params }: Params) {
  const { lessonId } = await params;
  const materials = db.getMaterials(lessonId);
  if (!materials) {
    return NextResponse.json({ error: "Quiz not ready yet" }, { status: 409 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    questions?: unknown;
    answers?: unknown;
  };
  const questions = body.questions;
  const answers = body.answers;
  if (
    !Array.isArray(questions) ||
    !Array.isArray(answers) ||
    !questions.every((q) => typeof q === "number") ||
    !answers.every((a) => typeof a === "number")
  ) {
    return NextResponse.json(
      { error: "Expected numeric questions[] and answers[]" },
      { status: 400 }
    );
  }

  let graded;
  try {
    graded = gradeAttempt(materials.quiz, questions as number[], answers as number[]);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  db.insertQuizAttempt(
    lessonId,
    graded.score,
    graded.total,
    answers as number[],
    questions as number[]
  );

  return NextResponse.json({
    score: graded.score,
    total: graded.total,
    results: graded.results,
  });
}
