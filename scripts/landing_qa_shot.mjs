#!/usr/bin/env node
/**
 * Headless landing screenshots via Brave CDP.
 * Usage: node scripts/landing_qa_shot.mjs [planet...]
 * Requires: python http.server on :8765 serving repo root, Brave installed.
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createConnection } from "node:net";
// WebSocket is global in Node 22+

const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const PORT = 9222;
const BASE = "http://127.0.0.1:8765/game.html";
const OUT = "sprites/mira/_debug";
const planets = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["mira", "cinder", "sorn", "vesper", "dusk"];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitPort(port, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      await new Promise((res, rej) => {
        const s = createConnection({ port, host: "127.0.0.1" }, () => { s.end(); res(); });
        s.on("error", rej);
      });
      return;
    } catch { await sleep(150); }
  }
  throw new Error("devtools port not up");
}

// Minimal CDP over WebSocket using undici/fetch is hard; use chrome-remote-interface free approach:
// spawn brave with remote debugging and use /json/new + page.captureScreenshot via raw WebSocket.
// Node 22+ has experimental WebSocket global.

async function cdpConnect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    }
  });
  function send(method, params = {}) {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((res, rej) => pending.set(mid, { res, rej }));
  }
  return { ws, send };
}

async function shotPlanet(planet) {
  // Open a dedicated target
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(`${BASE}?qa_land=${planet}`)}`, { method: "PUT" })).json();
  // /json/new may return differently across versions — fallback to /json/list
  let target = list;
  if (!target.webSocketDebuggerUrl) {
    const all = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    target = all.find(t => (t.url || "").includes(`qa_land=${planet}`)) || all[0];
  }
  if (!target || !target.webSocketDebuggerUrl) throw new Error("no target for " + planet);
  const { ws, send } = await cdpConnect(target.webSocketDebuggerUrl);
  await send("Page.enable");
  await send("Runtime.enable");
  // Navigate explicitly
  await send("Page.navigate", { url: `${BASE}?qa_land=${planet}` });
  await send("Page.loadEventFired").catch(() => {});
  // Poll for ready flag
  let ready = false, err = null, onP = false;
  for (let i = 0; i < 80; i++) {
    const r = await send("Runtime.evaluate", {
      expression: `({ready:!!window.__LANDING_QA_READY, err:window.__LANDING_QA_ERROR||null, onP:!!window.__LANDING_QA_ONPLANET, title:document.title})`,
      returnByValue: true,
    });
    const v = r.result.value;
    if (v.err) { err = v.err; break; }
    if (v.ready) { ready = true; onP = v.onP; break; }
    await sleep(200);
  }
  if (err) console.error(planet, "ERROR", err);
  if (!ready) console.warn(planet, "not ready after timeout");
  else console.log(planet, "ready onPlanet=", onP);

  // Extra settle
  await sleep(600);
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  mkdirSync(OUT, { recursive: true });
  const path = `${OUT}/landing_${planet}.png`;
  writeFileSync(path, Buffer.from(shot.data, "base64"));
  console.log("wrote", path, Buffer.from(shot.data, "base64").length);
  try { await send("Page.close"); } catch {}
  ws.close();
}

async function main() {
  // Kill old brave on 9222
  try {
    const procs = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    console.log("devtools already up", procs.Browser);
  } catch {
    const child = spawn(BRAVE, [
      `--remote-debugging-port=${PORT}`,
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--window-size=1280,720",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ], { stdio: "ignore", detached: true });
    child.unref();
    await waitPort(PORT);
    console.log("brave started");
  }
  for (const p of planets) {
    try { await shotPlanet(p); }
    catch (e) { console.error("fail", p, e.message); }
  }
  console.log("done");
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
