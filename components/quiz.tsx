"use client";

import { useState } from "react";
import type { QuizAttemptRow, QuizQuestion } from "@/lib/db";
import { MathText } from "./math-text";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

interface GradeResponse {
  score: number;
  total: number;
  results: { correct: boolean; answerIndex: number; explanation: string }[];
}

export function Quiz({
  lessonId,
  quiz,
  attempts,
  onGraded,
}: {
  lessonId: string;
  quiz: QuizQuestion[];
  attempts: QuizAttemptRow[];
  onGraded: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<GradeResponse | null>(null);
  const [grading, setGrading] = useState(false);

  const question = quiz[index];
  const best = attempts.reduce(
    (max, a) => Math.max(max, a.score),
    0
  );

  async function next() {
    const finalAnswers = [...answers, picked ?? -1];
    setAnswers(finalAnswers);
    setPicked(null);
    if (index + 1 < quiz.length) {
      setIndex(index + 1);
      return;
    }
    setGrading(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/quiz`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: finalAnswers }),
      });
      if (res.ok) {
        setResult((await res.json()) as GradeResponse);
        onGraded();
      }
    } finally {
      setGrading(false);
    }
  }

  function retake() {
    setIndex(0);
    setAnswers([]);
    setPicked(null);
    setResult(null);
  }

  if (result) {
    const fraction = result.score / result.total;
    return (
      <div className="fade max-w-xl">
        <div className="rise rounded-2xl border border-line bg-paper-raised px-8 py-10 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-ink-faint">
            Your score
          </p>
          <p className="mt-3 font-display text-6xl font-medium">
            {result.score}
            <span className="text-2xl text-ink-faint"> / {result.total}</span>
          </p>
          <p className="mt-3 text-ink-soft">
            {fraction === 1
              ? "Perfect — you own this lesson."
              : fraction >= 0.8
              ? "Strong work. One more pass and it's yours."
              : fraction >= 0.5
              ? "Good start — review the takeaways and try again."
              : "Tough one. Reread the slides, then have another go."}
          </p>
          <button
            type="button"
            onClick={retake}
            className="mt-6 rounded-full bg-accent text-accent-ink px-5 py-2.5 text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer"
          >
            Retake quiz
          </button>
        </div>

        <ol className="mt-8 space-y-5">
          {quiz.map((q, qi) => {
            const r = result.results[qi];
            const my = answers[qi];
            return (
              <li
                key={qi}
                className="rise rounded-xl border border-line-soft bg-paper-raised p-5"
                style={{ animationDelay: `${qi * 70}ms` }}
              >
                <p className="flex gap-2 font-medium leading-snug">
                  <span aria-hidden>{r.correct ? "✓" : "✕"}</span>
                  <span className={r.correct ? "text-good" : "text-bad"}>
                    <MathText>{q.question}</MathText>
                  </span>
                </p>
                <p className="mt-2 text-sm text-ink-soft">
                  {!r.correct && my >= 0 && (
                    <>
                      You said <strong><MathText>{q.choices[my]}</MathText></strong>.{" "}
                    </>
                  )}
                  Correct: <strong><MathText>{q.choices[r.answerIndex]}</MathText></strong>.{" "}
                  <MathText>{r.explanation}</MathText>
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  return (
    <div className="fade max-w-xl">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs text-ink-faint">
          Question {index + 1} of {quiz.length}
        </p>
        {attempts.length > 0 && (
          <p className="font-mono text-xs text-ink-faint">
            best {best}/{quiz.length} · {attempts.length}{" "}
            {attempts.length === 1 ? "attempt" : "attempts"}
          </p>
        )}
      </div>

      <div className="mt-2 h-1 rounded-full bg-line-soft overflow-hidden">
        <div
          className="h-full bg-accent rounded-full transition-[width] duration-500"
          style={{ width: `${(index / quiz.length) * 100}%` }}
        />
      </div>

      <div key={index} className="slide-in mt-8">
        <h2 className="font-display text-xl sm:text-2xl font-medium leading-snug">
          <MathText>{question.question}</MathText>
        </h2>

        <div className="mt-6 space-y-2.5" role="radiogroup" aria-label="Answers">
          {question.choices.map((choice, ci) => {
            const isPicked = picked === ci;
            const isCorrect = ci === question.answerIndex;
            const revealed = picked !== null;
            return (
              <button
                key={ci}
                type="button"
                role="radio"
                aria-checked={isPicked}
                disabled={revealed}
                onClick={() => setPicked(ci)}
                className={`w-full flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-all duration-200 cursor-pointer disabled:cursor-default ${
                  revealed && isCorrect
                    ? "border-good bg-good/10"
                    : revealed && isPicked
                    ? "border-bad bg-bad/10"
                    : revealed
                    ? "border-line-soft opacity-60"
                    : "border-line bg-paper-raised hover:border-accent hover:-translate-y-px"
                }`}
              >
                <span
                  className={`mt-0.5 font-mono text-xs shrink-0 size-5 inline-flex items-center justify-center rounded border ${
                    revealed && isCorrect
                      ? "border-good text-good"
                      : revealed && isPicked
                      ? "border-bad text-bad"
                      : "border-line text-ink-faint"
                  }`}
                >
                  {LETTERS[ci]}
                </span>
                <span className="leading-snug"><MathText>{choice}</MathText></span>
              </button>
            );
          })}
        </div>

        {picked !== null && (
          <div className="rise mt-5 rounded-xl border border-line-soft bg-paper-raised p-4">
            <p className="text-sm font-medium">
              {picked === question.answerIndex ? (
                <span className="text-good">Correct.</span>
              ) : (
                <span className="text-bad">
                  Not quite — it&apos;s {LETTERS[question.answerIndex]}.
                </span>
              )}
            </p>
            <p className="mt-1 text-sm text-ink-soft leading-relaxed">
              <MathText>{question.explanation}</MathText>
            </p>
            <button
              type="button"
              onClick={next}
              disabled={grading}
              className="mt-4 rounded-full bg-accent text-accent-ink px-5 py-2 text-sm font-medium hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
            >
              {grading
                ? "Scoring…"
                : index + 1 < quiz.length
                ? "Next question →"
                : "See my score"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
