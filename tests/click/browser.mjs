// A very small Chrome DevTools Protocol driver for the click checks. Test helper, not shipped.
// No dependency: it starts a headless Chromium and talks to it over Node's own WebSocket (Node 22 or newer).
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** The first Chromium found, or null. Set CHROMIUM to point at another one. */
export function findBrowser() {
  const names = [process.env.CHROMIUM, "chromium", "chromium-browser", "google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  return names.find((n) => spawnSync(n, ["--version"], { stdio: "ignore" }).status === 0) || null;
}

export async function open(bin, w = 1440, h = 900) {
  const port = await freePort();
  const profile = mkdtempSync(path.join(os.tmpdir(), "xpm-click-"));
  const chrome = spawn(bin, ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${w},${h}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let ws;
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      ws = new WebSocket(pages.find((x) => x.type === "page").webSocketDebuggerUrl);
    } catch { await sleep(250); }
  }
  if (!ws) { chrome.kill(); throw new Error("the browser did not start"); }
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map(), errors = [];
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const size = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 800 });
  await send("Runtime.enable");
  await size(w, h);
  return {
    ev, errors, size,
    go: async (url, wait = 1200) => { await send("Page.navigate", { url }); await sleep(wait); },
    click: async (sel, wait = 200) => { const r = await ev(`(() => { const el = ${sel}; if (!el) return "MISSING"; el.click(); return "ok"; })()`); await sleep(wait); return r; },
    text: (sel) => ev(`(document.querySelector(${JSON.stringify(sel)}) || {}).innerText || ""`),
    shot: async (file) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.result.data, "base64")); },
    close: async () => { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); },
  };
}
