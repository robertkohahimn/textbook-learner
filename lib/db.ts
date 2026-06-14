import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { dataDir } from "./paths";
import { normalizeSlide, type DeckMeta, type Slide } from "./deck";
import { validateSlideAnnotation, type SlideAnnotation } from "./annotations";

export type { Slide } from "./deck";

export type BookStatus = "processing" | "ready" | "error";
export type LessonStatus = "pending" | "generating" | "ready" | "error";

export interface BookRow {
  id: string;
  title: string;
  author: string | null;
  filename: string;
  num_pages: number;
  status: BookStatus;
  stage: string | null;
  error: string | null;
  accent: number;
  created_at: string;
}

export interface BookListRow extends BookRow {
  total_lessons: number;
  completed_lessons: number;
}

export interface ModuleRow {
  id: string;
  book_id: string;
  position: number;
  title: string;
  description: string | null;
}

export interface LessonRow {
  id: string;
  module_id: string;
  book_id: string;
  position: number;
  title: string;
  summary: string | null;
  page_start: number;
  page_end: number;
  status: LessonStatus;
  error: string | null;
  completed_at: string | null;
}

export interface CurriculumInput {
  title: string;
  description: string;
  lessons: { title: string; summary: string; pageStart: number; pageEnd: number }[];
}

export interface ModuleWithLessons extends ModuleRow {
  lessons: LessonRow[];
}

export interface Takeaway {
  point: string;
  detail: string;
}
export interface QuizQuestion {
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
}
export interface LessonMaterials {
  slides: Slide[];
  takeaways: Takeaway[];
  quiz: QuizQuestion[];
}

export interface QuizAttemptRow {
  id: string;
  lesson_id: string;
  score: number;
  total: number;
  answers: string;
  created_at: string;
}

export interface TutorMessageRow {
  id: string;
  lesson_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  filename TEXT NOT NULL,
  num_pages INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'processing',
  stage TEXT,
  error TEXT,
  accent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pages (
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (book_id, page_number)
);
CREATE TABLE IF NOT EXISTS modules (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT
);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  page_start INTEGER NOT NULL,
  page_end INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  completed_at TEXT
);
CREATE TABLE IF NOT EXISTS materials (
  lesson_id TEXT PRIMARY KEY REFERENCES lessons(id) ON DELETE CASCADE,
  slides TEXT NOT NULL,
  takeaways TEXT NOT NULL,
  quiz TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  answers TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tutor_messages (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS slide_annotations (
  lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  slide_index INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (lesson_id, slide_index)
);
`;

declare global {
  var __tblDb: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis.__tblDb) {
    const db = new Database(path.join(dataDir(), "app.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(SCHEMA);
    migrate(db);
    globalThis.__tblDb = db;
  }
  return globalThis.__tblDb;
}

function migrate(db: Database.Database): void {
  const cols = db.pragma("table_info(materials)") as { name: string }[];
  if (!cols.some((c) => c.name === "slides_meta")) {
    db.exec(`ALTER TABLE materials ADD COLUMN slides_meta TEXT`);
  }
}

export function newId(): string {
  return randomUUID();
}

function accentFor(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 6;
}

// --- books ---

export function insertBook(book: {
  id: string;
  title: string;
  author: string | null;
  filename: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO books (id, title, author, filename, accent) VALUES (?, ?, ?, ?, ?)`
    )
    .run(book.id, book.title, book.author, book.filename, accentFor(book.id));
}

export function listBooks(): BookListRow[] {
  return getDb()
    .prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM lessons l WHERE l.book_id = b.id) AS total_lessons,
        (SELECT COUNT(*) FROM lessons l WHERE l.book_id = b.id AND l.completed_at IS NOT NULL) AS completed_lessons
       FROM books b ORDER BY b.created_at DESC`
    )
    .all() as BookListRow[];
}

export function getBook(id: string): BookRow | undefined {
  return getDb().prepare(`SELECT * FROM books WHERE id = ?`).get(id) as
    | BookRow
    | undefined;
}

export function updateBook(
  id: string,
  fields: Partial<
    Pick<BookRow, "title" | "author" | "num_pages" | "status" | "stage" | "error">
  >
): void {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (keys.length === 0) return;
  const set = keys.map((k) => `${k} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE books SET ${set} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
}

export function deleteBook(id: string): void {
  getDb().prepare(`DELETE FROM books WHERE id = ?`).run(id);
}

// --- pages ---

export function insertPages(bookId: string, pages: string[]): void {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO pages (book_id, page_number, text) VALUES (?, ?, ?)`
  );
  db.transaction(() => {
    pages.forEach((text, i) => stmt.run(bookId, i + 1, text));
  })();
}

export function getPagesText(bookId: string, start: number, end: number): string {
  const rows = getDb()
    .prepare(
      `SELECT text FROM pages WHERE book_id = ? AND page_number BETWEEN ? AND ? ORDER BY page_number`
    )
    .all(bookId, start, end) as { text: string }[];
  return rows.map((r) => r.text).join("\n\n");
}

/** Lesson text with [p.N] markers so generated slides can cite their source pages. */
export function getPagesMarked(bookId: string, start: number, end: number): string {
  const rows = getDb()
    .prepare(
      `SELECT page_number, text FROM pages WHERE book_id = ? AND page_number BETWEEN ? AND ? ORDER BY page_number`
    )
    .all(bookId, start, end) as { page_number: number; text: string }[];
  return rows.map((r) => `[p.${r.page_number}]\n${r.text}`).join("\n\n");
}

// --- curriculum ---

export function insertCurriculum(bookId: string, modules: CurriculumInput[]): void {
  const db = getDb();
  const insertModule = db.prepare(
    `INSERT INTO modules (id, book_id, position, title, description) VALUES (?, ?, ?, ?, ?)`
  );
  const insertLesson = db.prepare(
    `INSERT INTO lessons (id, module_id, book_id, position, title, summary, page_start, page_end)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  db.transaction(() => {
    let lessonPosition = 0;
    modules.forEach((mod, mi) => {
      const moduleId = newId();
      insertModule.run(moduleId, bookId, mi, mod.title, mod.description);
      for (const lesson of mod.lessons) {
        insertLesson.run(
          newId(),
          moduleId,
          bookId,
          lessonPosition++,
          lesson.title,
          lesson.summary,
          lesson.pageStart,
          lesson.pageEnd
        );
      }
    });
  })();
}

export function getCurriculum(bookId: string): ModuleWithLessons[] {
  const db = getDb();
  const modules = db
    .prepare(`SELECT * FROM modules WHERE book_id = ? ORDER BY position`)
    .all(bookId) as ModuleRow[];
  const lessons = db
    .prepare(`SELECT * FROM lessons WHERE book_id = ? ORDER BY position`)
    .all(bookId) as LessonRow[];
  return modules.map((m) => ({
    ...m,
    lessons: lessons.filter((l) => l.module_id === m.id),
  }));
}

// --- lessons ---

export function getLesson(id: string): LessonRow | undefined {
  return getDb().prepare(`SELECT * FROM lessons WHERE id = ?`).get(id) as
    | LessonRow
    | undefined;
}

export function updateLessonStatus(
  id: string,
  status: LessonStatus,
  error?: string
): void {
  getDb()
    .prepare(`UPDATE lessons SET status = ?, error = ? WHERE id = ?`)
    .run(status, error ?? null, id);
}

export function setLessonCompleted(id: string, completed: boolean): void {
  getDb()
    .prepare(
      `UPDATE lessons SET completed_at = ${completed ? "datetime('now')" : "NULL"} WHERE id = ?`
    )
    .run(id);
}

// --- materials ---

export function saveMaterials(
  lessonId: string,
  materials: LessonMaterials,
  deckMeta?: DeckMeta
): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO materials (lesson_id, slides, takeaways, quiz, slides_meta) VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      lessonId,
      JSON.stringify(materials.slides),
      JSON.stringify(materials.takeaways),
      JSON.stringify(materials.quiz),
      deckMeta ? JSON.stringify(deckMeta) : null
    );
}

/** Replace just the slide deck (regeneration or a single-slide revision). */
export function saveDeck(lessonId: string, slides: Slide[], deckMeta: DeckMeta): void {
  getDb()
    .prepare(`UPDATE materials SET slides = ?, slides_meta = ? WHERE lesson_id = ?`)
    .run(JSON.stringify(slides), JSON.stringify(deckMeta), lessonId);
}

export function getMaterials(lessonId: string): LessonMaterials | undefined {
  const row = getDb()
    .prepare(`SELECT slides, takeaways, quiz FROM materials WHERE lesson_id = ?`)
    .get(lessonId) as { slides: string; takeaways: string; quiz: string } | undefined;
  if (!row) return undefined;
  return {
    // Normalizing on read keeps decks saved before layouts existed rendering fine.
    slides: (JSON.parse(row.slides) as unknown[]).map(normalizeSlide),
    takeaways: JSON.parse(row.takeaways),
    quiz: JSON.parse(row.quiz),
  };
}

export function getDeckMeta(lessonId: string): DeckMeta | null {
  const row = getDb()
    .prepare(`SELECT slides_meta FROM materials WHERE lesson_id = ?`)
    .get(lessonId) as { slides_meta: string | null } | undefined;
  if (!row?.slides_meta) return null;
  try {
    return JSON.parse(row.slides_meta) as DeckMeta;
  } catch {
    return null;
  }
}

// --- quiz attempts ---

export function insertQuizAttempt(
  lessonId: string,
  score: number,
  total: number,
  answers: number[]
): void {
  getDb()
    .prepare(
      `INSERT INTO quiz_attempts (id, lesson_id, score, total, answers) VALUES (?, ?, ?, ?, ?)`
    )
    .run(newId(), lessonId, score, total, JSON.stringify(answers));
}

export function getQuizAttempts(lessonId: string): QuizAttemptRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM quiz_attempts WHERE lesson_id = ? ORDER BY created_at DESC, rowid DESC`
    )
    .all(lessonId) as QuizAttemptRow[];
}

// --- tutor messages ---

export function insertTutorMessage(
  lessonId: string,
  role: "user" | "assistant",
  content: string
): void {
  getDb()
    .prepare(
      `INSERT INTO tutor_messages (id, lesson_id, role, content) VALUES (?, ?, ?, ?)`
    )
    .run(newId(), lessonId, role, content);
}

export function getTutorMessages(lessonId: string): TutorMessageRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM tutor_messages WHERE lesson_id = ? ORDER BY created_at, rowid`
    )
    .all(lessonId) as TutorMessageRow[];
}

// --- slide annotations (user highlights + notes) ---

export function getSlideAnnotations(
  lessonId: string
): Record<number, SlideAnnotation> {
  const rows = getDb()
    .prepare(
      `SELECT slide_index, data FROM slide_annotations WHERE lesson_id = ?`
    )
    .all(lessonId) as { slide_index: number; data: string }[];
  const out: Record<number, SlideAnnotation> = {};
  for (const row of rows) {
    try {
      out[row.slide_index] = validateSlideAnnotation(JSON.parse(row.data));
    } catch {
      // skip a corrupt row rather than failing the whole load
    }
  }
  return out;
}

export function saveSlideAnnotation(
  lessonId: string,
  slideIndex: number,
  annotation: SlideAnnotation
): void {
  const clean = validateSlideAnnotation(annotation);
  // An empty annotation is the same as none — keep the table tidy.
  if (clean.note === "" && clean.highlights.length === 0) {
    deleteSlideAnnotation(lessonId, slideIndex);
    return;
  }
  getDb()
    .prepare(
      `INSERT INTO slide_annotations (lesson_id, slide_index, data, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(lesson_id, slide_index)
       DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
    )
    .run(lessonId, slideIndex, JSON.stringify(clean));
}

export function deleteSlideAnnotation(lessonId: string, slideIndex: number): void {
  getDb()
    .prepare(
      `DELETE FROM slide_annotations WHERE lesson_id = ? AND slide_index = ?`
    )
    .run(lessonId, slideIndex);
}

export function deleteSlideAnnotations(lessonId: string): void {
  getDb()
    .prepare(`DELETE FROM slide_annotations WHERE lesson_id = ?`)
    .run(lessonId);
}
