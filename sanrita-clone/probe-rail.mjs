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
await evalJs("window.setu.open('kerala').then(() => 'ok')");
await sleep(3500);
console.log(await evalJs(`(() => {
  const aside = document.querySelector('aside');
  const icons = document.querySelector('.c-icons');
  const row = document.querySelector('.setu-nav-row');
  const cs = getComputedStyle(aside);
  const rs = row && getComputedStyle(row);
  return {
    asideVar: cs.getPropertyValue('--scroll-aside'),
    asideInline: aside.style.getPropertyValue('--scroll-aside'),
    asideRect: aside.getBoundingClientRect().toJSON(),
    asideVis: cs.visibility + ' ' + cs.opacity + ' ' + cs.transform,
    iconsLeft: icons && getComputedStyle(icons).left,
    iconsRect: icons && icons.getBoundingClientRect().toJSON(),
    rowRect: row && row.getBoundingClientRect().toJSON(),
    rowVis: rs && (rs.visibility + ' ' + rs.opacity + ' ' + rs.display),
    rowInAside: !!(row && aside.contains(row)),
    topAtRow: row ? document.elementsFromPoint(row.getBoundingClientRect().x + 5, row.getBoundingClientRect().y + 5).slice(0,4).map(e => e.tagName + '.' + String(e.className).slice(0,40)).join(' | ') : null,
    chain: (() => {
      const out = [];
      for (let n = row; n && n !== document.documentElement; n = n.parentElement) {
        const c = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        out.push([n.tagName + '.' + String(n.className).slice(0,26), 'op=' + c.opacity, 'vis=' + c.visibility,
          'ov=' + c.overflow, 'tr=' + c.transform.slice(0,26), 'z=' + c.zIndex, 'clip=' + c.clipPath,
          'rect=' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)].join(' '));
      }
      return out;
    })(),
  };
})()`));
ws.close(); chrome.kill();
