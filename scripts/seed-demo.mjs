// Seed a demo book + lesson with a deck that exercises every slide layout.
// Dev-only helper for visually checking the slides UI without an LLM call:
//   node scripts/seed-demo.mjs   (then open the printed URL)
//
// The schema is owned by lib/db.ts (a .ts module this plain-node script can't
// import), so the app must have created the database first.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbPath = path.join(dataDir, "app.db");
if (!existsSync(dbPath)) {
  console.error(
    `No app database at ${dbPath}.\nStart the app once (npm run dev) so it creates the schema, then re-run this script.`
  );
  process.exit(1);
}
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const bookId = "demo-deck-book-0000-0000-000000000000";
const moduleId = "demo-deck-mod-0000-0000-000000000000";
const lessonId = "demo-deck-les-0000-0000-000000000000";

const slides = [
  {
    layout: "title",
    title: "The Strange Logic of Spin",
    subtitle: "One simple experiment that classical physics cannot explain",
    notes:
      "Welcome everyone. Today we start with the experiment Bernhardt calls the cornerstone of quantum thinking. Don't worry about the math yet — focus on how odd the results are.",
    pages: [12],
  },
  {
    layout: "bullets",
    title: "What is spin?",
    bullets: [
      "An intrinsic quantum property",
      "Not literal rotation",
      "Always measured along a chosen axis",
    ],
    notes:
      "Spin sounds like a top spinning, but that picture fails quickly. The key idea is that it's a measurable property with a direction.",
    pages: [12, 13],
  },
  {
    layout: "big-fact",
    title: "Every measurement, only…",
    fact: { value: "2", label: "possible outcomes — no matter how the apparatus is oriented" },
    notes:
      "This is the shocker. Classically you'd expect a continuum of values as you tilt the magnet. You never see that. Two outcomes, always.",
    pages: [14],
  },
  {
    layout: "section",
    title: "The experiment itself",
    subtitle: "Stern–Gerlach, step by step",
    notes: "Now let's walk through the actual apparatus and what happens to the silver atoms.",
    pages: [15],
  },
  {
    layout: "process",
    title: "How the measurement unfolds",
    steps: [
      { label: "Prepare", detail: "A beam of atoms leaves the oven in random states" },
      { label: "Split", detail: "An inhomogeneous magnetic field deflects each atom" },
      { label: "Detect", detail: "Atoms land in exactly two bands — never a smear" },
      { label: "Repeat", detail: "Re-measuring along a new axis re-randomizes the old one" },
    ],
    notes:
      "Step four is the philosophical bombshell: measuring along a new axis erases what you knew about the old axis.",
    pages: [15, 16, 17],
  },
  {
    layout: "two-column",
    title: "Classical vs quantum expectations",
    columns: [
      {
        heading: "Classical picture",
        bullets: ["Any deflection angle", "Measurement reveals a pre-existing value", "Order doesn't matter"],
      },
      {
        heading: "Quantum reality",
        bullets: ["Exactly two bands", "Measurement creates the outcome", "Order changes results"],
      },
    ],
    notes:
      "Put the two worldviews side by side. Every row of the right column has been verified experimentally thousands of times.",
    pages: [16, 18],
  },
  {
    layout: "quote",
    title: "In the author's words",
    quote: {
      text: "The randomness is not a statement of our ignorance; it is intrinsic to the way the universe works.",
      attribution: "Chris Bernhardt",
    },
    notes:
      "I love this line because it kills the most common misconception — that quantum randomness is just hidden information we haven't found yet.",
    pages: [19],
  },
  {
    layout: "recap",
    title: "What to remember",
    bullets: [
      "Spin measurements are always binary",
      "Measurement order matters",
      "Randomness is intrinsic, not ignorance",
      "This experiment is the foundation of the qubit",
    ],
    notes: "If you remember nothing else, remember these four. The quiz draws on all of them.",
    pages: [12, 19],
  },
];

const takeaways = [
  { point: "Spin is quantized", detail: "Only two outcomes are ever observed, regardless of apparatus orientation." },
  { point: "Measurement disturbs", detail: "Measuring along one axis erases information about other axes." },
  { point: "Randomness is intrinsic", detail: "Outcomes are not determined by hidden pre-existing values." },
];

const quiz = [
  {
    question: "How many outcomes does a spin measurement have?",
    choices: ["One", "Two", "Three", "Infinitely many"],
    answerIndex: 1,
    explanation: "Spin measurements are binary.",
  },
  {
    question: "What happens when you re-measure along a new axis?",
    choices: ["Nothing", "The old axis value is preserved", "The old axis value is re-randomized", "The atom is destroyed"],
    answerIndex: 2,
    explanation: "Measurement along a new axis erases prior-axis information.",
  },
  {
    question: "Quantum randomness reflects…",
    choices: ["Our ignorance", "Instrument error", "Intrinsic nature", "Bad statistics"],
    answerIndex: 2,
    explanation: "It is not due to hidden information.",
  },
];

db.prepare(
  `INSERT OR REPLACE INTO books (id, title, author, filename, num_pages, status, accent) VALUES (?, ?, ?, ?, ?, 'ready', 2)`
).run(bookId, "Quantum Computing for Everyone", "Chris Bernhardt", "demo.pdf", 30);
db.prepare(
  `INSERT OR REPLACE INTO modules (id, book_id, position, title, description) VALUES (?, ?, 0, ?, ?)`
).run(moduleId, bookId, "Spin and Measurement", "The first quantum surprise");
db.prepare(
  `INSERT OR REPLACE INTO lessons (id, module_id, book_id, position, title, summary, page_start, page_end, status) VALUES (?, ?, ?, 0, ?, ?, 12, 19, 'ready')`
).run(lessonId, moduleId, bookId, "The Strange Logic of Spin", "Why one experiment broke classical physics");
const pageInsert = db.prepare(
  `INSERT OR REPLACE INTO pages (book_id, page_number, text) VALUES (?, ?, ?)`
);
for (let p = 12; p <= 19; p++) {
  pageInsert.run(bookId, p, `Demo source text for page ${p}: spin measurements always yield two outcomes...`);
}
db.prepare(
  `INSERT OR REPLACE INTO materials (lesson_id, slides, takeaways, quiz, slides_meta) VALUES (?, ?, ?, ?, ?)`
).run(
  lessonId,
  JSON.stringify(slides),
  JSON.stringify(takeaways),
  JSON.stringify(quiz),
  JSON.stringify({ format: "presenter", length: "default", generatedAt: new Date().toISOString() })
);

console.log(`Seeded. Open: http://localhost:3000/books/${bookId}/lessons/${lessonId}?tab=slides`);
