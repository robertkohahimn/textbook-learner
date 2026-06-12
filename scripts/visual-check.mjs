import { chromium } from "playwright";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const base = "http://localhost:3000";
const book = "cc013f38-cdcb-4ba1-b137-32d847b9d26b";

await page.goto(`${base}/books/${book}`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.screenshot({ path: "e2e-shots/v-curriculum.png", fullPage: true });

const lesson = await page.locator('a[href*="/lessons/"]').first().getAttribute("href");
await page.goto(`${base}${lesson}?tab=slides`, { waitUntil: "networkidle" });
await page.waitForTimeout(1600);
await page.screenshot({ path: "e2e-shots/v-slides.png" });

await page.goto(`${base}${lesson}?tab=quiz`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "e2e-shots/v-quiz.png" });

await page.goto(`${base}${lesson}?tab=tutor`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "e2e-shots/v-tutor.png" });
await browser.close();
