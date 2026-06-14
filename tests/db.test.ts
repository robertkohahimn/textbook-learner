import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let db: typeof import("@/lib/db");

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "tbl-test-"));
  db = await import("@/lib/db");
});

describe("db", () => {
  it("inserts and lists books with progress counts", () => {
    const id = db.newId();
    db.insertBook({ id, title: "Test Book", author: "A. Author", filename: "t.pdf" });
    const books = db.listBooks();
    expect(books).toHaveLength(1);
    expect(books[0]).toMatchObject({
      id,
      title: "Test Book",
      status: "processing",
      total_lessons: 0,
      completed_lessons: 0,
    });
  });

  it("stores pages and joins ranges", () => {
    const id = db.newId();
    db.insertBook({ id, title: "Pages", author: null, filename: "p.pdf" });
    db.insertPages(id, ["one", "two", "three", "four"]);
    expect(db.getPagesText(id, 2, 3)).toBe("two\n\nthree");
    expect(db.getPagesMarked(id, 2, 3)).toBe("[p.2]\ntwo\n\n[p.3]\nthree");
  });

  it("upgrades legacy slides on read and swaps decks in place", () => {
    const id = db.newId();
    db.insertBook({ id, title: "Legacy", author: null, filename: "l.pdf" });
    db.insertCurriculum(id, [
      {
        title: "M1",
        description: "",
        lessons: [{ title: "L", summary: "", pageStart: 1, pageEnd: 2 }],
      },
    ]);
    const lessonId = db.getCurriculum(id)[0].lessons[0].id;

    // A row written before deck layouts existed.
    db.saveMaterials(lessonId, {
      slides: [{ title: "Old", bullets: ["a"] } as never],
      takeaways: [{ point: "p", detail: "d" }],
      quiz: [{ question: "q?", choices: ["a", "b"], answerIndex: 0, explanation: "" }],
    });
    expect(db.getDeckMeta(lessonId)).toBeNull();
    expect(db.getMaterials(lessonId)?.slides[0]).toEqual({
      layout: "bullets",
      title: "Old",
      bullets: ["a"],
      notes: "",
    });

    const meta = {
      format: "detailed" as const,
      length: "short" as const,
      focus: "for kids",
      generatedAt: "2026-06-12T00:00:00.000Z",
    };
    db.saveDeck(
      lessonId,
      [{ layout: "section", title: "New deck", notes: "n" }],
      meta
    );
    expect(db.getMaterials(lessonId)?.slides[0].title).toBe("New deck");
    expect(db.getMaterials(lessonId)?.takeaways).toHaveLength(1);
    expect(db.getDeckMeta(lessonId)).toEqual(meta);
  });

  it("inserts a curriculum transactionally and reads it back", () => {
    const id = db.newId();
    db.insertBook({ id, title: "Curr", author: null, filename: "c.pdf" });
    db.insertCurriculum(id, [
      {
        title: "Module One",
        description: "Basics",
        lessons: [
          { title: "L1", summary: "s1", pageStart: 1, pageEnd: 10 },
          { title: "L2", summary: "s2", pageStart: 11, pageEnd: 20 },
        ],
      },
      {
        title: "Module Two",
        description: "More",
        lessons: [{ title: "L3", summary: "s3", pageStart: 21, pageEnd: 30 }],
      },
    ]);
    const curriculum = db.getCurriculum(id);
    expect(curriculum).toHaveLength(2);
    expect(curriculum[0].lessons.map((l) => l.title)).toEqual(["L1", "L2"]);
    expect(curriculum[0].lessons[0].status).toBe("pending");
    expect(curriculum[1].title).toBe("Module Two");

    const lesson = curriculum[0].lessons[0];
    db.updateLessonStatus(lesson.id, "ready");
    db.setLessonCompleted(lesson.id, true);
    expect(db.getLesson(lesson.id)?.status).toBe("ready");
    expect(db.getLesson(lesson.id)?.completed_at).toBeTruthy();

    const books = db.listBooks();
    const book = books.find((b) => b.id === id)!;
    expect(book.total_lessons).toBe(3);
    expect(book.completed_lessons).toBe(1);
  });

  it("round-trips materials, quiz attempts, and tutor messages", () => {
    const id = db.newId();
    db.insertBook({ id, title: "M", author: null, filename: "m.pdf" });
    db.insertCurriculum(id, [
      {
        title: "M1",
        description: "",
        lessons: [{ title: "L", summary: "", pageStart: 1, pageEnd: 2 }],
      },
    ]);
    const lessonId = db.getCurriculum(id)[0].lessons[0].id;

    const materials = {
      slides: [
        { layout: "bullets" as const, title: "S", bullets: ["b1"], notes: "say this" },
      ],
      takeaways: [{ point: "p", detail: "d" }],
      quiz: [
        { question: "q?", choices: ["a", "b", "c", "d"], answerIndex: 2, explanation: "e" },
      ],
    };
    db.saveMaterials(lessonId, materials, {
      format: "presenter",
      length: "default",
      generatedAt: "2026-06-12T00:00:00.000Z",
    });
    expect(db.getMaterials(lessonId)).toEqual(materials);
    expect(db.getDeckMeta(lessonId)?.format).toBe("presenter");

    db.insertQuizAttempt(lessonId, 1, 1, [2]);
    expect(db.getQuizAttempts(lessonId)[0]).toMatchObject({ score: 1, total: 1 });

    db.insertTutorMessage(lessonId, "user", "hi");
    db.insertTutorMessage(lessonId, "assistant", "hello");
    expect(db.getTutorMessages(lessonId).map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("round-trips, updates, and deletes slide annotations", () => {
    const id = db.newId();
    db.insertBook({ id, title: "Anno", author: null, filename: "a.pdf" });
    db.insertCurriculum(id, [
      {
        title: "M1",
        description: "",
        lessons: [{ title: "L", summary: "", pageStart: 1, pageEnd: 2 }],
      },
    ]);
    const lessonId = db.getCurriculum(id)[0].lessons[0].id;

    expect(db.getSlideAnnotations(lessonId)).toEqual({});

    db.saveSlideAnnotation(lessonId, 0, {
      note: "review this slide",
      highlights: [
        { id: "h1", field: "bullet:0", start: 0, end: 4, quote: "abcd", note: "key" },
      ],
    });
    db.saveSlideAnnotation(lessonId, 2, { note: "slide three", highlights: [] });

    const all = db.getSlideAnnotations(lessonId);
    expect(Object.keys(all).sort()).toEqual(["0", "2"]);
    expect(all[0].highlights[0].quote).toBe("abcd");
    expect(all[2].note).toBe("slide three");

    // Saving an empty annotation removes the row.
    db.saveSlideAnnotation(lessonId, 0, { note: "", highlights: [] });
    expect(db.getSlideAnnotations(lessonId)[0]).toBeUndefined();

    db.deleteSlideAnnotations(lessonId);
    expect(db.getSlideAnnotations(lessonId)).toEqual({});
  });

  it("cascade-deletes a book's children", () => {
    const id = db.newId();
    db.insertBook({ id, title: "Del", author: null, filename: "d.pdf" });
    db.insertPages(id, ["x"]);
    db.insertCurriculum(id, [
      {
        title: "M",
        description: "",
        lessons: [{ title: "L", summary: "", pageStart: 1, pageEnd: 1 }],
      },
    ]);
    const lessonId = db.getCurriculum(id)[0].lessons[0].id;
    db.deleteBook(id);
    expect(db.getBook(id)).toBeUndefined();
    expect(db.getLesson(lessonId)).toBeUndefined();
    expect(db.getPagesText(id, 1, 1)).toBe("");
  });
});
