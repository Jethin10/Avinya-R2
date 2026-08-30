/**
 * Drive the built page in a real browser and report what the SETU layer actually does.
 *
 * Not a unit test: the layer's failure modes are a missing WebGL context, a fetch that 404s and a
 * scene that throws halfway through a transition, and none of those are visible to a DOM stub. This
 * launches the installed Chrome headless, speaks CDP over Node's own WebSocket, and fails on any
 * console error or uncaught exception while it walks nation -> state -> district.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL_BASE = process.env.SETU_URL || "http://localhost:4319";
const port = 9222 + (process.pid % 200);

const profile = mkdtempSync(join(tmpdir(), "setu-smoke-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
  "--no-first-run", "--no-default-browser-check", "--disable-gpu-sandbox",
  "--window-size=1440,900", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SHOTS = "tests/__screens__";
mkdirSync(SHOTS, { recursive: true });

async function target() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((row) => row.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* the browser is still coming up */ }
    await sleep(250);
  }
  throw new Error("Chrome never opened a debugging socket");
}

const socket = new WebSocket(await target());
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = () => reject(new Error("CDP socket failed"));
});

let nextId = 1;
const pending = new Map();
const problems = [];
const logs = [];

socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    return message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = (message.params.args || []).map((arg) => arg.value ?? arg.description ?? arg.type).join(" ");
    logs.push(`${message.params.type}: ${text}`);
    if (message.params.type === "error") problems.push(`console.error ${text}`);
  }
  if (message.method === "Runtime.exceptionThrown") {
    const detail = message.params.exceptionDetails;
    problems.push(`uncaught ${detail.exception?.description || detail.text}`);
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId += 1;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

/** Save what the layer actually put on screen. A scene that renders black is not a passing test. */
async function shoot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(data, "base64"));
}

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluate threw");
  return result.result.value;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Log.enable");
await send("Network.enable");

const failedRequests = [];
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === "Network.responseReceived" && message.params.response.status >= 400) {
    failedRequests.push(`${message.params.response.status} ${message.params.response.url}`);
  }
});

await send("Page.navigate", { url: `${URL_BASE}/` });
await sleep(6000);

const report = {};
report.mode = await evaluate("document.documentElement.dataset.setuMode || null");
report.railRows = await evaluate("document.querySelectorAll('.setu-nav-row').length");
report.railLabels = await evaluate("[...document.querySelectorAll('.setu-nav-row')].map(a => a.textContent.trim()).slice(0, 3)");
report.canvases = await evaluate("document.querySelectorAll('canvas').length");
report.scene = await evaluate("document.documentElement.dataset.setuScene");
report.source = await evaluate("document.querySelector('.setu-source')?.textContent || null");

await evaluate("window.setu.open('kerala').then(() => 'ok')");
await sleep(3500);
await shoot("state");
report.stateScene = await evaluate("document.documentElement.dataset.setuScene");
report.districtMeshes = await evaluate("window.setu.app.scene.districts.length");
report.liveOutlines = await evaluate("window.setu.app.scene.districts.filter(d => d.row.live).length");

await evaluate("window.setu.open('kerala', 'wayanad').then(() => 'ok')");
await sleep(9000);
await shoot("district");
report.districtSceneAttr = await evaluate("document.documentElement.dataset.setuScene");
report.counts = await evaluate("window.setu.app.scene.counts");
report.beliefRows = await evaluate("document.querySelectorAll('.setu-panel .setu-row').length");
report.dispatchRows = await evaluate("[...document.querySelectorAll('.setu-panel-title')].map(n => n.textContent)");
report.audit = await evaluate("document.querySelectorAll('.setu-panel')[4]?.querySelector('.setu-row-name span')?.textContent || null");
report.hint = await evaluate("document.querySelector('.setu-hint')?.textContent || null");

await evaluate("window.setu.app.scene.setFlood(6); 'flooded'");
await sleep(600);
await shoot("district-flooded");
await evaluate("window.setu.scrubTo(0.75).then(() => 'ok')");
await sleep(2500);
report.afterScrub = await evaluate("document.querySelector('.setu-hint')?.textContent || null");
report.replayClock = await evaluate("document.querySelector('.setu-controls output')?.textContent || null");

await evaluate("window.setu.showNation(); 'home'");
await sleep(800);
report.backToNation = await evaluate("document.documentElement.dataset.setuScene");
report.railRowsLate = await evaluate("document.querySelectorAll('.setu-nav-row').length");

console.log(JSON.stringify(report, null, 2));
if (failedRequests.length) console.log("failed requests:\n" + failedRequests.join("\n"));
if (problems.length) {
  console.log("PROBLEMS:\n" + problems.join("\n"));
  console.log("recent logs:\n" + logs.slice(-25).join("\n"));
}
socket.close();
chrome.kill();
process.exit(problems.length || failedRequests.length ? 1 : 0);
