import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.PROBE_URL ?? "http://localhost:5173/";
const SETTLE_MS = Number(process.env.PROBE_SETTLE_MS ?? 12000);

if (!existsSync(CHROME)) {
  console.error("chrome not found at", CHROME);
  process.exit(1);
}

mkdirSync("probe-out", { recursive: true });

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--use-angle=default", "--enable-unsafe-webgpu", "--enable-webgl", "--js-flags=--expose-gc"]
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const consoleMessages = [];
const pageErrors = [];
const failedRequests = [];

page.on("console", (message) => {
  consoleMessages.push({
    type: message.type(),
    text: message.text().slice(0, 500)
  });
});

page.on("pageerror", (error) => {
  pageErrors.push((error.stack ?? String(error)).slice(0, 1200));
});

page.on("requestfailed", (request) => {
  failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`);
});

await page.goto(URL, { waitUntil: "load", timeout: 30000 });
await page.waitForTimeout(SETTLE_MS);

if (pageErrors.length >= 3) {
  const heapNow = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  console.log("errors already flooding; heap=", heapNow);
}

const heapBefore = await page.evaluate(() => {
  window.gc?.();

  return performance.memory?.usedJSHeapSize ?? null;
});

// Interact like a user: change fill, switch solver to preview and back, tilt
await page.mouse.move(1100, 450);
await page.waitForTimeout(500);

const fillSlider = await page.$('input[type="range"]');

if (fillSlider) {
  await fillSlider.focus();
  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(60);
  }
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(60);
  }
}

await page.waitForTimeout(2500);

// Switch to the custom vessel so sculpt handles mount, then sweep the canvas
const shapeSelect = await page.$("select");

if (shapeSelect) {
  await page.selectOption("select", "custom");
  await page.waitForTimeout(4000);

  const box = await (await page.$("canvas")).boundingBox();
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.45;

  await page.mouse.move(cx, cy);
  await page.mouse.down();

  for (let step = 0; step < 10; step += 1) {
    await page.mouse.move(cx + step * 6, cy - step * 4);
    await page.waitForTimeout(40);
  }

  await page.mouse.up();
  await page.waitForTimeout(3000);
}

await page.waitForTimeout(1500);

const cycles = Number(process.env.PROBE_CYCLES ?? 0);

for (let cycle = 0; cycle < cycles; cycle += 1) {
  const box = await (await page.$("canvas")).boundingBox();
  const cx = box.x + box.width * 0.55;
  const cy = box.y + box.height * 0.45;

  await page.mouse.move(cx, cy);
  await page.mouse.down();

  for (let step = 0; step < 10; step += 1) {
    await page.mouse.move(cx + step * 7, cy - step * 5);
    await page.waitForTimeout(30);
  }

  await page.mouse.up();
  await page.waitForTimeout(2500);

  const retained = await page.evaluate(() => {
    window.gc?.();
    window.gc?.();

    return performance.memory?.usedJSHeapSize ?? null;
  });

  console.log(`cycle ${cycle + 1}: retained=${(retained / (1024 * 1024)).toFixed(1)} MB`);
}

await page.waitForTimeout(1500);

const heapAfter = await page.evaluate(() => {
  window.gc?.();
  window.gc?.();

  return performance.memory?.usedJSHeapSize ?? null;
});

await page.screenshot({ path: "probe-out/app.png" });

const summary = {
  url: URL,
  heapBefore,
  heapAfter,
  heapDeltaMB:
    heapBefore && heapAfter ? ((heapAfter - heapBefore) / (1024 * 1024)).toFixed(1) : null,
  counts: {
    errors: pageErrors.length,
    consoleError: consoleMessages.filter((m) => m.type === "error").length,
    consoleWarning: consoleMessages.filter((m) => m.type === "warning").length,
    failedRequests: failedRequests.length
  },
  pageErrors: [...new Set(pageErrors)].slice(0, 10),
  consoleErrors: [
    ...new Map(consoleMessages.filter((m) => m.type === "error").map((m) => [m.text, m])).values()
  ]
    .map((m) => m.text)
    .slice(0, 15),
  consoleWarningsSample: [
    ...new Set(consoleMessages.filter((m) => m.type === "warning").map((m) => m.text))
  ].slice(0, 10),
  failedRequests: [...new Set(failedRequests)].slice(0, 10)
};

console.log(JSON.stringify(summary, null, 2));
writeFileSync("probe-out/probe.json", JSON.stringify({ summary, consoleMessages }, null, 2));

await browser.close();
