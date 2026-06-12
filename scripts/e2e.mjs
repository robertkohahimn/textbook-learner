// End-to-end journey through Folio against a running dev server (port 3000)
// with an already-processed book. Run: node scripts/e2e.mjs
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const SHOTS = "e2e-shots";
let failures = 0;

function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.setDefaultTimeout(15_000);
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

try {
  // --- Library ---
  await page.goto(BASE, { waitUntil: "networkidle" });
  check("library loads", await page.getByText("Your library").isVisible());
  const cover = page.getByRole("link", { name: /Study Quantum Computing/ });
  await cover.waitFor();
  check("book cover shown", await cover.isVisible());
  await page.screenshot({ path: `${SHOTS}/01-library.png` });

  // Non-PDF rejection (client-side, no upload happens)
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hi") });
  const rejected = await page
    .getByText(/isn't one/)
    .waitFor({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("non-PDF rejected", rejected);

  // --- Curriculum ---
  await cover.click();
  await page.waitForURL(/\/books\//);
  await page.getByText("lessons complete").waitFor();
  const moduleCount = await page.locator("article").count();
  check("curriculum modules render", moduleCount >= 3, `${moduleCount} modules`);
  const lessonLinks = page.locator('a[href*="/lessons/"]');
  const lessonCount = await lessonLinks.count();
  check("lesson rows render", lessonCount >= 8, `${lessonCount} lessons`);
  check(
    "continue CTA",
    await page.getByRole("button", { name: /studying/ }).isVisible()
  );
  await page.screenshot({ path: `${SHOTS}/02-curriculum.png`, fullPage: true });

  // --- Lesson: slides ---
  await lessonLinks.first().click();
  await page.waitForURL(/\/lessons\//);
  await page.getByRole("navigation", { name: "Lesson sections" }).waitFor();
  const slideCounter = page.locator("text=/^1 \\/ \\d+$/");
  check("slides open on slide 1", await slideCounter.isVisible());
  const firstBullets = await page.locator("li.rise").count();
  check("slide bullets render", firstBullets >= 2, `${firstBullets} bullets`);
  await page.screenshot({ path: `${SHOTS}/03-slides.png` });
  await page.keyboard.press("ArrowRight");
  check(
    "arrow key advances slide",
    await page.locator("text=/^2 \\/ \\d+$/").isVisible()
  );

  // --- Takeaways ---
  await page.getByRole("button", { name: "Takeaways" }).click();
  await page.waitForTimeout(300);
  const takeawayCount = await page.locator("ol li").count();
  check("takeaways render", takeawayCount >= 4, `${takeawayCount} takeaways`);
  check("tab in url", page.url().includes("tab=takeaways"));
  await page.screenshot({ path: `${SHOTS}/04-takeaways.png` });

  // --- Quiz ---
  await page.getByRole("button", { name: "Quiz" }).click();
  await page.getByText(/Question 1 of/).waitFor();
  for (let q = 0; q < 5; q++) {
    await page.getByRole("radio").first().click();
    await page.waitForTimeout(250);
    const nextBtn = page.getByRole("button", { name: /Next question|See my score/ });
    if (q === 0) await page.screenshot({ path: `${SHOTS}/05-quiz-feedback.png` });
    await nextBtn.click();
    await page.waitForTimeout(350);
  }
  await page.getByText("Your score").waitFor({ timeout: 10_000 });
  check("quiz score screen", true);
  check(
    "retake offered",
    await page.getByRole("button", { name: "Retake quiz" }).isVisible()
  );
  await page.screenshot({ path: `${SHOTS}/06-quiz-score.png` });

  // --- Tutor (live LLM stream) ---
  await page.getByRole("button", { name: "Tutor" }).click();
  const box = page.getByLabel("Ask your tutor");
  await box.waitFor();
  await box.fill("In one short sentence, what is this lesson about?");
  await page.getByLabel("Send", { exact: true }).click();
  const reply = page.locator(".tutor-prose").last();
  await reply.waitFor({ timeout: 120_000 });
  // Wait for the stream to finish: text stabilizes
  let prev = "";
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    const now = (await reply.textContent()) ?? "";
    if (now.length > 20 && now === prev) break;
    prev = now;
  }
  check("tutor streamed a reply", prev.length > 20, `${prev.length} chars`);
  await page.screenshot({ path: `${SHOTS}/07-tutor.png` });

  // History survives reload
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Tutor" }).click();
  await page.waitForTimeout(800);
  const persisted = await page.locator(".tutor-prose").count();
  check("tutor history persists", persisted >= 1, `${persisted} replies`);

  // --- Mark complete & progress ---
  await page.getByRole("button", { name: "Mark complete" }).click();
  await page.getByRole("button", { name: /Completed/ }).waitFor();
  check("mark complete toggles", true);
  await page.getByRole("link", { name: /← Quantum/ }).click();
  await page.getByText(/1 of \d+ lessons complete/).waitFor();
  check("curriculum progress updates", true);
  await page.screenshot({ path: `${SHOTS}/08-progress.png` });

  check("no console errors", consoleErrors.length === 0, consoleErrors[0] ?? "");
} catch (err) {
  failures++;
  console.error("FATAL:", err.message);
  await page.screenshot({ path: `${SHOTS}/99-failure.png` }).catch(() => {});
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
