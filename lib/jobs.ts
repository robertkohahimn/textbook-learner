import { readFileSync } from "node:fs";
import path from "node:path";
import * as db from "./db";
import { extractBook } from "./pdf";
import { generateCurriculum } from "./curriculum";
import { generateMaterials } from "./materials";
import { uploadsDir } from "./paths";

interface Job {
  key: string;
  run: () => Promise<void>;
}

interface JobState {
  queue: Job[];
  keys: Set<string>;
  running: boolean;
}

declare global {
  var __tblJobs: JobState | undefined;
}

function state(): JobState {
  globalThis.__tblJobs ??= { queue: [], keys: new Set(), running: false };
  return globalThis.__tblJobs;
}

function enqueue(job: Job, priority = false): void {
  const s = state();
  if (s.keys.has(job.key)) return;
  s.keys.add(job.key);
  if (priority) s.queue.unshift(job);
  else s.queue.push(job);
  void drain();
}

async function drain(): Promise<void> {
  const s = state();
  if (s.running) return;
  s.running = true;
  try {
    // Serial on purpose: one LLM call at a time keeps CLI usage sane.
    while (s.queue.length > 0) {
      const job = s.queue.shift()!;
      try {
        await job.run();
      } catch (err) {
        console.error(`[jobs] ${job.key} failed:`, err);
      } finally {
        s.keys.delete(job.key);
      }
    }
  } finally {
    s.running = false;
  }
}

export function enqueueProcessBook(bookId: string): void {
  enqueue({ key: `book:${bookId}`, run: () => processBook(bookId) }, true);
}

export function enqueueGenerateLesson(lessonId: string, priority = false): void {
  enqueue({ key: `lesson:${lessonId}`, run: () => generateLesson(lessonId) }, priority);
}

async function processBook(bookId: string): Promise<void> {
  const book = db.getBook(bookId);
  if (!book || book.status !== "processing") return;
  try {
    db.updateBook(bookId, { stage: "extracting" });
    const buf = new Uint8Array(
      readFileSync(path.join(uploadsDir(), book.filename))
    );
    const extracted = await extractBook(buf);
    db.insertPages(bookId, extracted.pages);
    db.updateBook(bookId, {
      title: extracted.title ?? book.title,
      author: extracted.author ?? book.author,
      num_pages: extracted.numPages,
      stage: "analyzing",
    });

    const curriculum = await generateCurriculum(
      {
        title: extracted.title ?? book.title,
        author: extracted.author ?? book.author,
        numPages: extracted.numPages,
      },
      extracted.pages,
      extracted.outline
    );
    db.updateBook(bookId, { stage: "curriculum" });
    db.insertCurriculum(bookId, curriculum);
    db.updateBook(bookId, { status: "ready", stage: null, error: null });

    for (const mod of db.getCurriculum(bookId)) {
      for (const lesson of mod.lessons) enqueueGenerateLesson(lesson.id);
    }
  } catch (err) {
    const message = (err as Error).message ?? "Unknown error";
    db.updateBook(bookId, {
      status: "error",
      stage: null,
      error: message.startsWith("NO_TEXT")
        ? "This PDF has no extractable text — it may be a scanned book, which isn't supported yet."
        : message,
    });
  }
}

async function generateLesson(lessonId: string): Promise<void> {
  const lesson = db.getLesson(lessonId);
  if (!lesson || (lesson.status !== "pending" && lesson.status !== "error")) return;
  db.updateLessonStatus(lessonId, "generating");
  try {
    const text = db.getPagesText(lesson.book_id, lesson.page_start, lesson.page_end);
    const materials = await generateMaterials(
      { title: lesson.title, summary: lesson.summary },
      text
    );
    db.saveMaterials(lessonId, materials);
    db.updateLessonStatus(lessonId, "ready");
  } catch (err) {
    db.updateLessonStatus(lessonId, "error", (err as Error).message);
  }
}
