import { chromium } from "playwright";
import assert from "node:assert/strict";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});

const page = await browser.newPage({ viewport: { width: 1920, height: 975 } });
const consoleErrors = [];
page.on("console", message => {
  if (message.type() === "error") consoleErrors.push(message.text());
});
page.on("pageerror", error => consoleErrors.push(error.message));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.setu?.app?.atlas));

// Use the app's public demo entry point for the WebGL-only district pick, then exercise the real UI.
await page.evaluate(() => window.setu.open("kerala", "wayanad"));
await page.waitForFunction(() => document.documentElement.dataset.setuScene === "district");
await page.waitForFunction(() => window.setu.app.current?.snapshot);

const initial = await page.evaluate(() => ({
  lens: window.setu.app.lens,
  fogMode: window.setu.app.fogMode,
  context: document.querySelector(".setu-context")?.innerText,
  dossier: document.querySelector(".setu-dossier")?.innerText,
  activeRail: document.querySelector(".setu-nav-row[data-active=true]")?.innerText,
  source: document.querySelector(".setu-source")?.innerText,
}));
assert.equal(initial.lens, "fog");
assert.match(initial.context, /INFORMATION FOG/i);
assert.match(initial.dossier, /WHAT THE EOC HEARS/i);
assert.match(initial.activeRail, /Information fog/i);
assert.match(initial.source, /HISTORICAL REPLAY/i);

await page.getByRole("button", { name: "SETU", exact: true }).click();
await page.waitForFunction(() => window.setu.app.fogMode === "setu");
assert.match(await page.locator(".setu-dossier").innerText(), /WHAT SETU BELIEVES/i);

await page.locator(".setu-lens-group").getByRole("button", { name: "Belief", exact: true }).click();
await page.waitForFunction(() => window.setu.app.lens === "belief");
assert.match(await page.locator(".setu-context").innerText(), /RISK BELIEF/i);
assert.match(await page.locator(".setu-dossier").innerText(), /RISK BELIEF/i);
const blockMetric = page.locator(".setu-context .setu-metric[role=button]").first();
if (await blockMetric.count()) await blockMetric.click();

await page.locator(".setu-lens-group").getByRole("button", { name: "Response", exact: true }).click();
await page.waitForFunction(() => window.setu.app.lens === "response");
assert.match(await page.locator(".setu-context").innerText(), /RESPONSE PLAN/i);
assert.equal(await page.evaluate(() => window.setu.app.scene.routes.visible), true);
const dispatchRows = page.locator(".setu-dossier button.setu-row");
if (await dispatchRows.count()) {
  await dispatchRows.first().click();
  await page.waitForTimeout(100);
  const activeRoute = await page.evaluate(() => window.setu.app.activeRouteId);
  if (activeRoute) {
    assert.equal(await page.locator(".setu-dossier .setu-row-active").count(), 1);
  }
}

await page.locator(".setu-lens-group").getByRole("button", { name: "Verify", exact: true }).click();
await page.waitForFunction(() => window.setu.app.lens === "verify");
assert.match(await page.locator(".setu-context").innerText(), /VERIFY NEXT/i);
const verifyActions = page.locator(".setu-featured-question .setu-button");
if (await verifyActions.count()) {
  for (let i = 0; i < await verifyActions.count(); i += 1) {
    assert.equal(await verifyActions.nth(i).isDisabled(), true);
  }
}

await page.locator(".setu-lens-group").getByRole("button", { name: "Proof", exact: true }).click();
await page.waitForFunction(() => window.setu.app.lens === "proof");
assert.match(await page.locator(".setu-context").innerText(), /PROOF/i);
assert.match(await page.locator(".setu-dossier").innerText(), /DECISION LEDGER/i);

await page.locator(".setu-lens-group").getByRole("button", { name: "Belief", exact: true }).click();
const villageRows = page.locator(".setu-dossier button.setu-row");
assert.ok(await villageRows.count() > 0);
await villageRows.first().click();
await page.waitForFunction(() => Boolean(window.setu.app.detail?.receipt));
const receiptText = await page.locator(".setu-dossier").innerText();
assert.match(receiptText, /EVIDENCE RECEIPT/i);
assert.match(receiptText, /not included in this replay bundle|Recorded posterior only/i);
await page.getByRole("button", { name: "← Back", exact: true }).click();
await page.waitForFunction(() => !window.setu.app.detail);
assert.equal(await page.evaluate(() => window.setu.app.lens), "belief");

await page.screenshot({ path: "tests/__screens__/district-lenses.png", fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await mobile.waitForFunction(() => Boolean(window.setu?.app?.atlas));
await mobile.evaluate(() => window.setu.open("kerala", "wayanad"));
await mobile.waitForFunction(() => document.documentElement.dataset.setuScene === "district");
const overflow = await mobile.evaluate(() => ({
  body: document.body.scrollWidth > innerWidth + 1,
  controls: document.querySelector(".setu-controls")?.getBoundingClientRect().right > innerWidth + 1,
  dossier: document.querySelector(".setu-dossier")?.getBoundingClientRect().right > innerWidth + 1,
}));
assert.deepEqual(overflow, { body: false, controls: false, dossier: false });
await mobile.screenshot({ path: "tests/__screens__/district-mobile.png", fullPage: true });

await browser.close();

if (consoleErrors.length) {
  throw new Error(`Browser console errors:\n${consoleErrors.join("\n")}`);
}

console.log("SETU five-lens browser QA passed");
