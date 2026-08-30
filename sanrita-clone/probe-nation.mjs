import { spawn } from "node:child_process";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const chrome = spawn(CHROME, ["--headless=new","--remote-debugging-port=9333","--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--window-size=1440,900","about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 40; i += 1) {
  try { targets = await (await fetch("http://localhost:9333/json/list")).json(); if (targets.length) break; } catch {}
  await sleep(250);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const waiting = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; waiting.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evalJs = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.error || r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result?.exceptionDetails ?? r.error));
  return r.result.result.value;
};
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: "http://localhost:5173/" });
await sleep(9000);
console.log(await evalJs(`(() => {
  const row = document.querySelector('.setu-nav-row');
  const r = row.getBoundingClientRect();
  const stack = document.elementsFromPoint(r.x + 40, r.y + 12).slice(0, 6)
    .map((e) => e.tagName + '.' + String(e.className).slice(0, 34) + ' pe=' + getComputedStyle(e).pointerEvents + ' z=' + getComputedStyle(e).zIndex);
  const hot = document.querySelector('.c-r3f-hotspots');
  return {
    scene: document.documentElement.dataset.setuScene || 'nation',
    rowRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    rowPe: getComputedStyle(row).pointerEvents,
    iconsPe: getComputedStyle(document.querySelector('.c-icons')).pointerEvents,
    asidePe: getComputedStyle(document.querySelector('aside')).pointerEvents,
    stack,
    hotspots: hot ? getComputedStyle(hot).zIndex + ' pe=' + getComputedStyle(hot).pointerEvents + ' rect=' + JSON.stringify(hot.getBoundingClientRect().toJSON()) : 'none',
  };
})()`));
ws.close(); chrome.kill();
