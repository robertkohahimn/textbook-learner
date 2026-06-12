"use client";

import { useEffect, useState } from "react";
import type { Slide } from "@/lib/db";

export function Slides({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  const slide = slides[index];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, slides.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  return (
    <div className="fade">
      <div
        key={index}
        className="slide-in relative rounded-2xl border border-line bg-paper-raised px-8 py-10 sm:px-12 sm:py-14 min-h-[22rem] flex flex-col shadow-[0_18px_40px_-28px_rgba(35,29,18,0.5)]"
        aria-live="polite"
      >
        <span
          aria-hidden
          className="absolute top-0 left-10 right-10 h-[3px] rounded-b bg-accent"
        />
        <h2 className="font-display text-2xl sm:text-[1.9rem] font-medium leading-snug text-balance">
          {slide.title}
        </h2>
        <ul className="mt-7 space-y-4 max-w-xl">
          {slide.bullets.map((bullet, bi) => (
            <li
              key={bi}
              className="rise flex gap-3 leading-relaxed"
              style={{ animationDelay: `${120 + bi * 110}ms` }}
            >
              <span aria-hidden className="mt-[0.65em] size-1.5 shrink-0 rounded-full bg-accent" />
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
        <span className="mt-auto pt-8 self-end font-mono text-xs text-ink-faint">
          {index + 1} / {slides.length}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(i - 1, 0))}
          disabled={index === 0}
          className="rounded-full border border-line px-4 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-default"
        >
          ← Back
        </button>

        <div className="flex items-center gap-1.5" role="tablist" aria-label="Slides">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Slide ${i + 1}: ${s.title}`}
              onClick={() => setIndex(i)}
              className={`rounded-full transition-all duration-300 cursor-pointer ${
                i === index
                  ? "w-6 h-1.5 bg-accent"
                  : "size-1.5 bg-line hover:bg-ink-faint"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIndex((i) => Math.min(i + 1, slides.length - 1))}
          disabled={index === slides.length - 1}
          className="rounded-full border border-line px-4 py-2 text-sm text-ink-soft hover:border-ink-faint hover:text-ink transition-colors disabled:opacity-30 cursor-pointer disabled:cursor-default"
        >
          Next →
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-ink-faint">
        Tip: use ← → arrow keys
      </p>
    </div>
  );
}
