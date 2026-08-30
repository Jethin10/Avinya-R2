import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const problems = [];
page.on("console", message => { if (message.type() === "error") problems.push(message.text()); });
page.on("pageerror", error => problems.push(error.message));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await page.waitForFunction(() => Boolean(window.setu?.app?.atlas));
assert.equal(await page.evaluate(() => window.setu.app.source.mode), "engine");

await page.evaluate(() => window.setu.open("kerala", "wayanad"));
await page.waitForFunction(() => document.documentElement.dataset.setuScene === "district");
await page.waitForFunction(() => Boolean(window.setu.app.current?.snapshot));

await page.getByRole("button", { name: "Open SETU command console" }).click();
const command = page.locator(".setu-command-console");
await command.waitFor({ state: "visible" });
assert.match(await command.locator(".setu-console-status").innerText(), /Live Engine/i);
assert.equal(await command.getByLabel("Scenario").locator("option").count(), 4);

await command.getByLabel("Scenario").selectOption("wayanad-demo");
await page.waitForFunction(() => window.setu.app.view?.scenario === "wayanad-demo");
await page.waitForFunction(() => Boolean(window.setu.app.current?.snapshot));

await command.getByRole("button", { name: "Pause", exact: true }).click();
await page.waitForFunction(() => window.setu.app.current?.snapshot?.clock?.playing === false);

const report = command.getByLabel("Field report");
await report.fill("Demo field team reports severe slope failure beside occupied homes.");
await command.getByRole("button", { name: "Send live observation", exact: true }).click();
await page.waitForFunction(() => /Observation accepted/i.test(document.querySelector(".setu-console-feedback")?.textContent || ""));
assert.equal(await page.evaluate(() => window.setu.app.lens), "fog");

assert.equal(await command.getByRole("link", { name: "Dispatch PDF" }).getAttribute("href"), "/export/dispatch.pdf");
assert.equal(await command.getByRole("link", { name: "CAP alert XML" }).getAttribute("href"), "/export/alerts.cap");
const exportsOk = await page.evaluate(async () => {
  const [pdf, cap] = await Promise.all([fetch("/export/dispatch.pdf"), fetch("/export/alerts.cap")]);
  const pdfHead = new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 4));
  const capText = await cap.text();
  return { pdf: pdf.ok && pdfHead === "%PDF", cap: cap.ok && /<alert[ >]/i.test(capText) };
});
assert.deepEqual(exportsOk, { pdf: true, cap: true });

if (await command.getByLabel("Decision to override").locator("option").count()) {
  await command.getByLabel("Override reason").fill("Demo operator reviewed access constraints and retains human authority.");
  await command.getByRole("button", { name: "Record human override", exact: true }).click();
  await page.waitForFunction(() => /override appended/i.test(document.querySelector(".setu-console-feedback")?.textContent || ""));
  assert.equal(await page.evaluate(() => window.setu.app.lens), "proof");
  assert.match(await page.locator(".setu-dossier").innerText(), /Human authority/i);
}

await command.getByLabel("Scenario").selectOption("meppadi-2024-landslide");
await page.waitForFunction(() => window.setu.app.view?.scenario === "meppadi-2024-landslide");
await page.waitForFunction(() => Boolean(window.setu.app.current?.snapshot));
await page.evaluate(() => window.setu.setLens("response"));
await page.waitForFunction(() => window.setu.app.lens === "response");
assert.ok(await page.evaluate(() => window.setu.app.scene.routes.children.length) > 0);

await mkdir("tests/__screens__", { recursive: true });
await page.screenshot({ path: "tests/__screens__/live-command-console.png", fullPage: true });

const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
await mobile.waitForFunction(() => Boolean(window.setu?.app?.atlas));
await mobile.locator(".c-preloader").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
await mobile.getByRole("button", { name: "Open SETU command console" }).click();
const mobileConsole = mobile.locator(".setu-command-console");
await mobileConsole.waitFor({ state: "visible" });
const overflow = await mobile.evaluate(() => ({
  page: document.body.scrollWidth > innerWidth + 1,
  console: document.querySelector(".setu-command-console").getBoundingClientRect().right > innerWidth + 1,
}));
assert.deepEqual(overflow, { page: false, console: false });
await mobile.screenshot({ path: "tests/__screens__/live-command-console-mobile.png", fullPage: true });

await browser.close();
const unexpected = problems.filter(message => !/ERR_UNKNOWN_URL_SCHEME|Minified React error #418/.test(message));
if (unexpected.length) throw new Error(`Browser errors:\n${unexpected.join("\n")}`);
console.log("SETU live command console QA passed");
