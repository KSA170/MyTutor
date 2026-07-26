#!/usr/bin/env node
/**
 * Screenshot the app (demo mode) with Playwright against the Expo web dev
 * server. Usage:
 *   node scripts/screenshot.mjs <baseUrl> <outDir> <set>
 * where <set> is "app" | "onboarding" | "signedout" (must match the server's
 * EXPO_PUBLIC_DEMO_STATE).
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const [baseUrl = "http://localhost:8081", outDir = "./shots", set = "app"] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});

async function shot(name, path, { settle = 2500, before } = {}) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" }).catch(
    () => {},
  );
  await page.waitForTimeout(settle);
  if (before) await before();
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log(`✓ ${name}`);
}

if (set === "signedout") {
  await shot("01-signin", "/", { settle: 3500 });
} else if (set === "onboarding") {
  await shot("02-onboarding-profile", "/onboarding/profile", { settle: 3500 });
  await shot("03-onboarding-course", "/onboarding/course");
  await shot("04-onboarding-materials", "/onboarding/materials");
  await shot("05-onboarding-style", "/onboarding/style");
} else {
  await shot("06-home", "/", { settle: 4000 });
  await shot("07-session-new", "/session/new");

  // Chat: start from a fresh demo session and play the canned stream.
  await page.goto(`${baseUrl}/session/demo-chat`, { waitUntil: "networkidle" })
    .catch(() => {});
  await page.waitForTimeout(2000);
  const input = page.getByPlaceholder("Ask your tutor…");
  await input.fill(
    "Why do igneous rocks have different crystal sizes? I keep mixing this up.",
  );
  await page.keyboard.press("Enter").catch(() => {});
  // Fallback: click the send button if Enter didn't submit.
  await page.waitForTimeout(300);
  const send = page.getByText("↑", { exact: true });
  if (await send.isVisible().catch(() => false)) {
    await send.click().catch(() => {});
  }
  await page.waitForTimeout(9000); // let the canned stream finish
  await page.screenshot({ path: `${outDir}/08-chat-teaching.png` });
  console.log("✓ 08-chat-teaching");

  await shot("09-summary", "/session/s-1/summary");
  await shot("10-planner", "/planner", { settle: 3000 });
  await shot("11-planner-grades", "/planner", {
    settle: 2500,
    before: async () => {
      const chip = page.getByText("Grades", { exact: true }).first();
      if (await chip.isVisible().catch(() => false)) {
        await chip.click().catch(() => {});
        await page.waitForTimeout(800);
      }
    },
  });
  await shot("12-stats", "/stats", { settle: 3000 });
  await shot("13-library", "/library");
  await shot("14-note", "/note/n-1");
  await shot("15-tree", "/tree", { settle: 3000 });
  await shot("16-friends", "/friends", { settle: 3000 });
  await shot("17-settings", "/settings");
}

await browser.close();
console.log("done");
