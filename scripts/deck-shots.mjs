// Screenshot the new slides UI states. Dev-only: node scripts/deck-shots.mjs
import { chromium } from "playwright";

const url =
  "http://localhost:3000/books/demo-deck-book-0000-0000-000000000000/lessons/demo-deck-les-0000-0000-000000000000?tab=slides";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

await page.screenshot({ path: "e2e-shots/deck-1-title.png" });

// Walk a few layouts
const shots = [
  [2, "deck-2-bigfact"], // after 2 rights: bullets -> big-fact
  [2, "deck-3-process"], // section -> process
  [1, "deck-4-twocol"],
  [1, "deck-5-quote"],
  [1, "deck-6-recap"],
];
for (const [presses, name] of shots) {
  for (let i = 0; i < presses; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  await page.screenshot({ path: `e2e-shots/${name}.png` });
}

// Speaker notes
await page.keyboard.press("n");
await page.waitForTimeout(400);
await page.screenshot({ path: "e2e-shots/deck-7-notes.png" });
await page.keyboard.press("n");

// Overview grid
await page.keyboard.press("g");
await page.waitForTimeout(700);
await page.screenshot({ path: "e2e-shots/deck-8-grid.png", fullPage: true });
await page.keyboard.press("g");

// Customize panel
await page.getByRole("button", { name: "Customize" }).click();
await page.waitForTimeout(400);
await page.screenshot({ path: "e2e-shots/deck-9-customize.png" });
await page.getByRole("button", { name: "Customize" }).click();

// Revise affordance
await page.getByRole("button", { name: /Revise this slide/ }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: "e2e-shots/deck-10-revise.png" });

// Export menu
await page.getByRole("button", { name: "Export" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: "e2e-shots/deck-11-export.png" });

await browser.close();
console.log("done");
