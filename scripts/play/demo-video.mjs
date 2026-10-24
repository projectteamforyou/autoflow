#!/usr/bin/env node
// Records the Google Play "Accessibility API" declaration video from the REAL app on an Android emulator
// (.github/workflows/play-demo-video.yml). Nothing is simulated: the debug APK runs on the emulator, the UI is driven
// with real `adb shell input` taps (WebView elements are located over Chrome DevTools, Android Settings with
// uiautomator), and `screenrecord` captures the screen.
//
//   node scripts/play/demo-video.mjs record --apk app-debug.apk --out demo-out [--lang en]
//   node scripts/play/demo-video.mjs post   --out demo-out [--lang en]
//
// record writes demo-out/<lang>/part-*.mp4 + timeline.json + shots/*.png; post (needs ffmpeg) burns the captions in
// and writes demo-out/autoflow-accessibility-demo-<lang>.mp4.
//
// What the video shows (captions come from CAPTIONS in demo-video-lib.mjs and are only shown while that is on screen):
//   part A  AutoFlow ▸ Settings ▸ Permissions ▸ Grant (Accessibility) → the native disclosure dialog → "Agree"
//           → AutoFlow opens Android Settings ▸ Accessibility → AutoFlow automations → Use … → Allow → back to AutoFlow
//   part B  Home ▸ Auto clicker (Easy) → Slow, Until I stop it, drag the tap point → back → Run on the flow card →
//           taps land on the "Home" title (harmless) → the floating Halt button stops it → Ledger
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CAPTIONS, LAYOUT, calibrate, center, closeCaptions, devtoolsSocket, expectedHaltCenter, findByText, findColorBlob,
  findServiceSwitch, fmt, focusedPackage, introFilter, normalizedPoint, parseEnTs, parseRawScreencap, parseUiDump,
  parseWmSize, partFilter, templateRegex, toScreen, wrapText,
} from "./demo-video-lib.mjs";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PKG = "com.projectteamforyou.autoflow";
const SERVICE = `${PKG}/${PKG}.a11y.AutoFlowAccessibilityService`;
const SERVICE_LABEL = /<string name="accessibility_service_label">([^<]+)</.exec(readFileSync(join(ROOT, "apps/android/android/app/src/main/res/values/strings.xml"), "utf8"))?.[1] ?? "AutoFlow automations";
const DEVTOOLS_PORT = 9222;
/** The native Accessibility disclosure (a11y/AccessibilityDisclosure.kt) follows the device locale, which stays English. */
const NATIVE = Object.fromEntries([...readFileSync(join(ROOT, "apps/android/android/app/src/main/res/values/strings.xml"), "utf8").matchAll(/<string name="a11y_disclosure_(\w+)">([^<]*)</g)].map((m) => [m[1], m[2].replace(/\\(['"])/g, "$1")]));

const args = Object.fromEntries(process.argv.slice(3).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"] : null)).filter(Boolean));
const cmd = process.argv[2];
const LANG = args.lang ?? "en";
const OUT = resolve(args.out ?? "demo-out");
const DIR = join(OUT, LANG);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

/* ================================================================== i18n (the app's own strings) */

function loadStrings(lang) {
  const en = parseEnTs(readFileSync(join(ROOT, "apps/web/src/i18n/en.ts"), "utf8"));
  if (lang === "en") return en;
  const file = join(ROOT, `apps/web/src/i18n/locales/${lang}.json`);
  return { ...en, ...JSON.parse(readFileSync(file, "utf8")) };
}

/* ================================================================== adb */

async function adb(argv, { allowFail = false, timeout = 60_000, encoding = "utf8" } = {}) {
  try {
    const { stdout } = await run("adb", argv, { timeout, maxBuffer: 64 * 1024 * 1024, encoding });
    return stdout;
  } catch (e) {
    if (allowFail) return encoding === "buffer" ? Buffer.alloc(0) : "";
    throw new Error(`adb ${argv.join(" ")} failed: ${e.stderr || e.message}`);
  }
}
const sh = (c, o) => adb(["shell", c], o);

async function waitFor(label, fn, { timeout = 30_000, interval = 500 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}${last ? `: ${last.message}` : ""}`);
}

async function retry(label, n, fn) {
  for (let i = 1; ; i++) {
    try {
      return await fn(i);
    } catch (e) {
      if (i >= n) throw e;
      log(`${label} failed (attempt ${i}/${n}): ${e.message}`);
      await sleep(2000 * i);
    }
  }
}

let shotN = 0;
async function shot(name) {
  const buf = await adb(["exec-out", "screencap", "-p"], { encoding: "buffer", allowFail: true });
  const file = join(DIR, "shots", `${String(++shotN).padStart(2, "0")}-${name}.png`);
  if (buf.length) writeFileSync(file, buf);
  return file;
}
async function rawScreen() {
  return parseRawScreencap(await adb(["exec-out", "screencap"], { encoding: "buffer" }));
}

const tap = (x, y) => sh(`input tap ${Math.round(x)} ${Math.round(y)}`);
const key = (k) => sh(`input keyevent ${k}`);

async function uiNodes() {
  // uiautomator needs an idle screen; Settings pages are. Retry once on "could not get idle state".
  return retry("uiautomator dump", 3, async () => {
    const out = await sh("uiautomator dump /sdcard/ui.xml", { timeout: 30_000 });
    if (!/dumped to/i.test(out)) throw new Error(out.trim() || "no dump");
    const xml = await adb(["exec-out", "cat", "/sdcard/ui.xml"]);
    return parseUiDump(xml);
  });
}

async function focused() {
  return focusedPackage(await sh("dumpsys window", { allowFail: true }));
}

/** Dismisses "System UI isn't responding" / "App isn't responding" dialogs that slow emulators show. */
async function dismissAnr() {
  const nodes = await uiNodes().catch(() => []);
  if (!findByText(nodes, /isn.t responding/i)) return false;
  const wait = findByText(nodes, /^(Wait|WAIT)$/);
  if (wait) {
    log("dismissing an ANR dialog");
    const c = center(wait.bounds);
    await tap(c.x, c.y);
    await sleep(800);
    return true;
  }
  return false;
}

/* ================================================================== device setup */

async function bootDevice() {
  await retry("adb wait-for-device", 3, () => adb(["wait-for-device"], { timeout: 180_000 }));
  await waitFor("sys.boot_completed", async () => (await sh("getprop sys.boot_completed", { allowFail: true })).trim() === "1", { timeout: 300_000, interval: 2000 });
  await waitFor("package manager", async () => (await sh("pm path android", { allowFail: true })).includes("package:"), { timeout: 120_000, interval: 2000 });
  await waitFor("settings provider", async () => (await sh("settings get global device_provisioned", { allowFail: true })).trim() === "1", { timeout: 60_000, interval: 2000 }).catch(() => log("device_provisioned not 1 — continuing"));
  const size = parseWmSize(await sh("wm size"));
  const density = +(/(\d+)\s*$/.exec((await sh("wm density")).trim())?.[1] ?? 420) / 160;
  const sdk = (await sh("getprop ro.build.version.sdk")).trim();
  log(`device: ${size.w}x${size.h} density ${density} API ${sdk}`);
  for (const c of [
    "svc power stayon true",
    "settings put system screen_off_timeout 1800000",
    "settings put secure lockscreen.disabled 1",
    "input keyevent KEYCODE_WAKEUP",
    "wm dismiss-keyguard",
    "settings put global window_animation_scale 0",
    "settings put global transition_animation_scale 0",
    "settings put global animator_duration_scale 0",
    "settings put system show_touches 1",
    "settings put system pointer_location 0",
    // a clean, fixed status bar (System UI demo mode)
    "settings put global sysui_demo_allowed 1",
    "am broadcast -a com.android.systemui.demo -e command enter",
    "am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1000",
    "am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false",
    "am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4",
    "am broadcast -a com.android.systemui.demo -e command notifications -e visible false",
    "cmd statusbar collapse",
  ]) await sh(c, { allowFail: true });
  await dismissAnr();
  return { size, density, sdk };
}

async function installApp(apk) {
  log(`installing ${apk}`);
  await retry("adb install", 3, () => adb(["install", "-r", "-g", apk], { timeout: 240_000 }));
  // a clean first run: no data, accessibility off
  await sh(`pm clear ${PKG}`, { allowFail: true });
  await sh("settings delete secure enabled_accessibility_services", { allowFail: true });
  await sh("settings put secure accessibility_enabled 0", { allowFail: true });
  // Android 13+ asks for notifications on first use; granted up front so no unrelated prompt interrupts the video.
  await sh(`pm grant ${PKG} android.permission.POST_NOTIFICATIONS`, { allowFail: true });
  await adb(["logcat", "-c"], { allowFail: true });
}

/* ================================================================== Chrome DevTools (WebView) */

export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString());
      const p = msg.id && this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
    ws.addEventListener("close", () => this.pending.forEach((p) => p.reject(new Error("devtools socket closed"))));
  }
  static async connect(url) {
    if (typeof WebSocket !== "function") throw new Error("Node 22+ with a global WebSocket is required");
    const ws = new WebSocket(url);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error(`cannot open ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => this.pending.has(id) && (this.pending.delete(id), reject(new Error(`${method} timed out`))), 20_000);
    });
  }
  async eval(fn, arg) {
    const expression = `(${fn})(${JSON.stringify(arg ?? null)})`;
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  close() {
    try { this.ws.close(); } catch { /* closed */ }
  }
}

async function connectWebView() {
  const pid = await waitFor("app process", async () => (await sh(`pidof ${PKG}`, { allowFail: true })).trim().split(/\s+/)[0], { timeout: 60_000 });
  const socket = await waitFor("WebView devtools socket", async () => devtoolsSocket(await sh("cat /proc/net/unix", { allowFail: true }), pid), { timeout: 60_000 });
  await adb(["forward", "--remove-all"], { allowFail: true });
  await adb(["forward", `tcp:${DEVTOOLS_PORT}`, `localabstract:${socket}`]);
  const page = await waitFor("WebView page", async () => {
    const list = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json/list`)).json();
    return list.find((t) => t.type === "page" && /^https?:\/\/localhost/.test(t.url)) ?? list.find((t) => t.type === "page");
  }, { timeout: 60_000, interval: 1000 });
  log(`devtools: ${socket} → ${page.url}`);
  const cdp = await Cdp.connect(`ws://127.0.0.1:${DEVTOOLS_PORT}/devtools/page/${page.id}`);
  await cdp.send("Runtime.enable");
  await waitFor("app UI", () => cdp.eval(() => document.readyState === "complete" && !!document.querySelector(".onboard, .shell")), { timeout: 60_000 });
  return cdp;
}

/** Runs in the page: finds an element (CSS selector + exact/partial text or aria-label), remembers it as __afEl. */
export function pageFind(q) {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  let roots = [document];
  if (q.within) {
    roots = [...document.querySelectorAll(q.within)].filter(vis);
    if (!roots.length) return null;
    roots = [roots[roots.length - 1]];
  }
  let els = roots.flatMap((r) => [...r.querySelectorAll(q.sel || "*")]).filter(vis);
  if (q.text != null) {
    els = els.filter((e) => {
      const t = norm(e.innerText ?? e.textContent);
      const a = norm(e.getAttribute("aria-label"));
      return q.exact === false ? t.includes(q.text) || a.includes(q.text) : t === q.text || a === q.text;
    });
  }
  if (q.closest) els = els.map((e) => e.closest(q.closest)).filter(Boolean);
  if (q.then) els = els.map((e) => [...e.querySelectorAll(q.then)].filter(vis).find((x) => q.thenText == null || norm(x.innerText) === q.thenText)).filter(Boolean);
  const el = els[q.index ?? 0];
  if (!el) return null;
  window.__afEl = el;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  return { x: r.left, y: r.top, w: r.width, h: r.height, cx, cy, hit: !!hit && (el === hit || el.contains(hit)), vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio, text: norm(el.innerText).slice(0, 80) };
}

export class App {
  /** [touch] performs a real tap at a screen pixel (adb input tap on the device). */
  constructor(cdp, cal, touch = tap) {
    this.cdp = cdp;
    this.cal = cal;
    this.touch = touch;
  }
  find(q) {
    return this.cdp.eval(pageFind, q);
  }
  waitFind(label, q, timeout = 20_000) {
    return waitFor(label, () => this.find(q), { timeout, interval: 300 });
  }
  /** Scrolls the remembered element into view (smoothly, like a user scroll) until a tap on its centre would hit it. */
  async reveal(label, q) {
    let r = await this.waitFind(label, q);
    // not hittable yet: off screen (scroll it in) or under a toast (they leave after 4 s)
    for (let i = 0; i < 6 && !r.hit; i++) {
      await this.cdp.eval(() => window.__afEl?.scrollIntoView({ block: "center", behavior: "smooth" }));
      await sleep(900);
      r = await this.waitFind(label, q);
    }
    if (!r.hit) throw new Error(`${label} is covered or off screen`);
    return r;
  }
  /** A real touch (adb input tap) on the centre of a WebView element. */
  async tap(label, q) {
    const r = await this.reveal(label, q);
    const p = toScreen(this.cal, r.cx, r.cy);
    log(`tap ${label} (“${r.text}”) at ${p.x},${p.y}`);
    await this.touch(p.x, p.y);
    await sleep(400);
    return r;
  }
  text() {
    return this.cdp.eval(() => document.body.innerText);
  }
  async waitText(label, needle, timeout = 20_000) {
    return waitFor(label, async () => (await this.text()).includes(needle), { timeout, interval: 300 });
  }
}

/** Maps CSS pixels to screen pixels with one real tap on a harmless element (the onboarding logo). */
async function calibrateWebView(cdp) {
  const r = await waitFor("onboarding logo", () => cdp.eval(pageFind, { sel: ".onboard img" }), { timeout: 30_000 });
  const nodes = await uiNodes().catch(() => []);
  const wv = nodes.find((n) => n.cls === "android.webkit.WebView" && n.bounds);
  const guess = { scale: r.dpr, offX: wv?.bounds.x1 ?? 0, offY: wv?.bounds.y1 ?? 0 };
  const p = toScreen(guess, r.cx, r.cy);
  await cdp.eval(() => {
    window.__afCal = null;
    window.addEventListener("pointerdown", (e) => (window.__afCal = { x: e.clientX, y: e.clientY }), { capture: true, once: true });
  });
  await tap(p.x, p.y);
  const seen = await waitFor("calibration tap", () => cdp.eval(() => window.__afCal), { timeout: 5000, interval: 200 }).catch(() => null);
  const cal = seen ? calibrate(r.dpr, p.x, p.y, seen.x, seen.y) : guess;
  log(`calibration: webview ${wv ? JSON.stringify(wv.bounds) : "?"} dpr ${r.dpr} → ${JSON.stringify(cal)} (${seen ? "measured" : "guessed"})`);
  return cal;
}

/* ================================================================== recording */

class Recorder {
  constructor(name) {
    this.name = name;
    this.remote = `/sdcard/demo-${name}.mp4`;
    this.local = join(DIR, `part-${name}.mp4`);
    this.marks = [];
    this.mode = "screenrecord";
  }
  async start() {
    await sh(`rm -f ${this.remote}`, { allowFail: true });
    this.proc = spawn("adb", ["shell", "screenrecord", "--bit-rate", "8000000", "--time-limit", "170", this.remote], { stdio: ["ignore", "pipe", "pipe"] });
    this.proc.stderr.on("data", (d) => log(`screenrecord: ${String(d).trim()}`));
    this.exited = new Promise((r) => this.proc.on("close", r));
    const ok = await waitFor("screenrecord file", async () => (await sh(`ls ${this.remote}`, { allowFail: true })).includes(this.remote), { timeout: 8000, interval: 200 }).catch(() => false);
    if (!ok) {
      // Fallback: the emulator records its own display on the host (WebM).
      log("device screenrecord did not start — falling back to `adb emu screenrecord`");
      this.proc.kill();
      this.mode = "emu";
      this.local = join(DIR, `part-${this.name}.webm`);
      await adb(["emu", "screenrecord", "start", "--time-limit", "170", this.local]);
      await sleep(1000);
    }
    this.t0 = Date.now();
    await sleep(600); // a still first frame
  }
  /** Caption from now on (until the next mark). */
  mark(text) {
    const at = (Date.now() - this.t0) / 1000;
    this.marks.push({ at, text });
    log(`caption @${at.toFixed(1)}s: ${text}`);
  }
  async stop() {
    await sleep(700);
    this.duration = (Date.now() - this.t0) / 1000;
    if (this.mode === "emu") {
      await adb(["emu", "screenrecord", "stop"], { allowFail: true });
      await waitFor("emu recording file", () => existsSync(this.local) && statSync(this.local).size > 10_000, { timeout: 30_000 });
    } else {
      await sh("kill -2 $(pidof screenrecord)", { allowFail: true }); // SIGINT: screenrecord finalizes the MP4
      await Promise.race([this.exited, sleep(15_000)]);
      await sleep(1000);
      await adb(["pull", this.remote, this.local], { timeout: 120_000 });
    }
    const size = statSync(this.local).size;
    log(`part ${this.name}: ${this.duration.toFixed(1)}s, ${(size / 1e6).toFixed(1)} MB (${this.mode})`);
    if (size < 20_000) throw new Error(`recording ${this.local} is empty`);
    return { name: this.name, file: this.local, duration: this.duration, captions: closeCaptions(this.marks, this.duration), mode: this.mode };
  }
}

/* ================================================================== the story */

async function record() {
  const apk = args.apk;
  if (!apk || !existsSync(apk)) throw new Error("--apk <debug apk> is required");
  mkdirSync(join(DIR, "shots"), { recursive: true });
  const S = loadStrings(LANG);
  const C = CAPTIONS[LANG] ?? CAPTIONS.en;
  const timeline = { lang: LANG, parts: [], notes: [] };

  const dev = await bootDevice();
  await installApp(apk);

  // ---- warm-up (not recorded): first launch, language, WebView ↔ screen calibration
  await sh(`am start -W -n ${PKG}/.MainActivity`);
  // First launch shows the native disclosure; decline it here (the recording shows it from the Permissions page).
  const firstRun = await waitFor("first-run disclosure", async () => findByText(await uiNodes(), new RegExp(`^${NATIVE.decline}$`, "i")), { timeout: 15_000, interval: 800 }).catch(() => null);
  if (firstRun) { await shot("warmup-first-run-disclosure"); const c = center(firstRun.bounds); await tap(c.x, c.y); await sleep(800); }
  else timeline.notes.push("first-run disclosure not seen during warm-up");
  const cdp = await connectWebView();
  await cdp.eval((lang) => {
    const sel = document.querySelector(".onboard select");
    if (!sel || sel.value === lang) return;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, lang);
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, LANG);
  await waitFor(`onboarding in ${LANG}`, async () => (await cdp.eval(() => document.body.innerText)).includes(S["onboard.s1.title"]), { timeout: 15_000 });
  const cal = await calibrateWebView(cdp);
  const app = new App(cdp, cal);
  await shot("warmup-onboarding");
  await key("KEYCODE_HOME");
  await sleep(1500);
  await dismissAnr();

  /* ------------------------------------------------ part A: disclosure + Settings */
  const A = new Recorder("A");
  await A.start();
  A.mark(C.open);
  await sh(`am start -n ${PKG}/.MainActivity`);
  await waitFor("AutoFlow in front", async () => (await focused()) === PKG, { timeout: 15_000 });
  await app.waitText("onboarding", S["onboard.s1.title"]);
  await sleep(2200);
  await shot("A1-onboarding");
  await app.tap("Skip intro", { sel: "button", text: S["onboard.skip"] });
  await app.waitFind("mobile nav", { sel: ".mobile-nav a", text: S["nav.settings"] });
  await sleep(1200);
  await app.tap("Settings tab", { sel: ".mobile-nav a", text: S["nav.settings"] });
  await app.waitFind("permissions link", { sel: 'a[href$="#/fleet"]' });
  await sleep(1000);
  await shot("A2-settings");
  await app.tap("Permissions", { sel: 'a[href$="#/fleet"]' });
  await app.waitFind("accessibility row", { sel: "b", text: S["perm.native.accessibility"] });
  await sleep(1500);
  await shot("A3-fleet");
  await app.tap("Grant (Accessibility)", { sel: "b", text: S["perm.native.accessibility"], closest: ".row", then: "button", thenText: S["fleet.grant"] });
  // The native disclosure dialog (AccessibilityDisclosure.kt), shown before AutoFlow opens Android Settings.
  await waitFor("disclosure dialog", async () => findByText(await uiNodes(), NATIVE.title), { timeout: 15_000, interval: 800 });
  A.mark(C.disclosure);
  await sleep(4000);
  await shot("A4-disclosure");
  // scroll the message so the whole text (data accessed, use, no collection or sharing) is on screen at some point
  for (let i = 0; i < 3; i++) {
    await sh(`input swipe ${dev.size.w / 2} ${dev.size.h * 0.62} ${dev.size.w / 2} ${dev.size.h * 0.38} 900`);
    await sleep(3200);
  }
  await shot("A4b-disclosure-end");
  const agree = await waitFor("Agree button", async () => findByText(await uiNodes(), new RegExp(`^${NATIVE.agree}$`, "i")), { timeout: 10_000, interval: 800 });
  log("tap Agree");
  { const c = center(agree.bounds); await tap(c.x, c.y); }

  // Android Settings ▸ Accessibility, opened by the app itself (Intents.settings("accessibility")).
  await waitFor("Android Settings in front", async () => /settings/i.test((await focused()) ?? ""), { timeout: 15_000 });
  await sleep(800);
  let enabledVia = "ui";
  A.mark(C.enableUi);
  try {
    await enableServiceInSettings(dev);
  } catch (e) {
    log(`real UI toggle failed (${e.message}) — enabling over adb while the Settings page is visible`);
    timeline.notes.push(`Accessibility toggled via adb: ${e.message}`);
    enabledVia = "adb";
    A.marks.pop();
    A.mark(C.enableAdb);
    await sh(`settings put secure enabled_accessibility_services ${SERVICE}`);
    await sh("settings put secure accessibility_enabled 1");
    await sleep(2500);
  }
  await waitFor("service enabled", async () => (await sh("settings get secure enabled_accessibility_services")).includes(SERVICE), { timeout: 10_000 });
  await sleep(1800);
  await shot("A6-service-on");

  // back to AutoFlow (Back from the Settings task; the launcher icon if Back lands elsewhere)
  for (let i = 0; i < 3 && (await focused()) !== PKG; i++) {
    await key("KEYCODE_BACK");
    await sleep(900);
  }
  if ((await focused()) !== PKG) await sh(`am start -n ${PKG}/.MainActivity`);
  await waitFor("AutoFlow back in front", async () => (await focused()) === PKG, { timeout: 15_000 });
  const granted = await app.waitFind("accessibility granted", { sel: "b", text: S["perm.native.accessibility"], closest: ".row", then: ".badge.ok" }, 8000).catch(() => null);
  if (!granted) {
    await app.tap("Refresh", { sel: "button", text: S["common.refresh"] }).catch(() => undefined);
    await app.waitFind("accessibility granted", { sel: "b", text: S["perm.native.accessibility"], closest: ".row", then: ".badge.ok" }, 10_000);
  }
  A.mark(C.granted);
  await sleep(3000);
  await shot("A7-granted");
  timeline.parts.push(await A.stop());
  timeline.enabledVia = enabledVia;

  // the service must be connected before anything runs
  // (AutoFlowAccessibilityService logs "connected" from onServiceConnected)
  await waitFor("accessibility service connected", async () => /AutoFlowA11y.*connected/.test(await adb(["logcat", "-d", "-s", "AutoFlowA11y:I"], { allowFail: true })), { timeout: 20_000, interval: 1000 });

  /* ------------------------------------------------ part B: create, run, Halt */
  const B = new Recorder("B");
  await B.start();
  B.mark(C.granted);
  await sleep(1000);
  await app.tap("Home tab", { sel: ".mobile-nav a", text: S["nav.home"] });
  // The flow will tap the "Home" page title: plain text in the fixed top bar, so the taps change nothing.
  const title = await app.waitFind("Home title", { sel: ".topbar h2", text: S["nav.home"] });
  const target = toScreen(cal, title.cx, title.cy);
  const norm = normalizedPoint(dev.size, target.x, target.y);
  log(`tap target: “${S["nav.home"]}” title at ${target.x},${target.y} → normalized ${norm.x},${norm.y}`);
  await sleep(1200);
  B.mark(C.create);
  await app.tap("Auto clicker", { sel: ".quick button", text: S["home.quick.click"], exact: false });
  await app.waitText("Easy editor", S["easy.what"]);
  await sleep(1500);
  await shot("B1-editor");
  await app.tap("Slow", { sel: ".seg button", text: S["easy.slow"] });
  await sleep(700);
  await app.tap("Until I stop it", { sel: ".seg button", text: S["easy.repeat.until"] });
  await sleep(900);
  // drag point 1 on the screen map to where the "Home" title is on the real screen (a second try if it lands off)
  const dotAt = () => app.cdp.eval(() => {
    const d = document.querySelector(".point-dot");
    return d ? { x: parseFloat(d.style.left) / 100, y: parseFloat(d.style.top) / 100 } : null;
  });
  const off = (p) => !p || Math.abs(p.x - norm.x) > 0.02 || Math.abs(p.y - norm.y) > 0.02;
  let placed = null;
  for (let attempt = 1; attempt <= 2 && off(placed); attempt++) {
    const dot = await app.reveal("point 1", { sel: ".point-dot" });
    const board = await app.find({ sel: ".point-board" });
    if (!board || board.y < 0 || board.y + board.h > board.vh) throw new Error(`point board not fully on screen: ${JSON.stringify(board)}`);
    const from = toScreen(cal, dot.cx, dot.cy);
    const to = toScreen(cal, board.x + norm.x * board.w, board.y + norm.y * board.h);
    log(`drag point 1 ${from.x},${from.y} → ${to.x},${to.y}`);
    await sh(`input swipe ${from.x} ${from.y} ${to.x} ${to.y} 900`);
    await sleep(800);
    placed = await dotAt();
    log(`point 1 now at ${JSON.stringify(placed)} (wanted ${norm.x},${norm.y})`);
  }
  // never run a flow whose taps could land on a real control
  if (off(placed) || (await app.cdp.eval(() => document.querySelectorAll(".point-dot").length)) !== 1) throw new Error(`tap point not where planned: ${JSON.stringify(placed)} vs ${JSON.stringify(norm)}`);
  await sleep(1200);
  await shot("B2-configured");
  await app.waitFind("autosave", { sel: ".editor-bar span", text: S["editor.savedShort"] }, 10_000);
  await sleep(600);
  await app.tap("Back", { sel: ".editor-bar button", text: S["common.back"] });
  await app.waitFind("flow card", { sel: ".flow-card b", text: S["new.name.click"] });
  await sleep(1000);
  const runQ = { sel: ".flow-card b", text: S["new.name.click"], closest: ".flow-card", then: "button.primary" };
  await app.reveal("Run button", runQ);
  // Android's own tap traces (Developer options ▸ Pointer location) from here on, so every tap is visible
  await sh("settings put system pointer_location 1", { allowFail: true });
  await sleep(1200);
  const noHalt = await rawScreen().catch(() => null);

  const runAt = Date.now();
  await app.tap("Run", runQ);
  // an approval dialog only appears for risky flows; approve it if it shows up
  const approve = await app.waitFind("risk approval", { within: "[role=dialog]", sel: "button", text: S["run.risk.approve"] }, 2500).catch(() => null);
  if (approve) await app.tap("Approve and run", { within: "[role=dialog]", sel: "button", text: S["run.risk.approve"] });
  B.mark(C.run);
  const actionsRe = templateRegex(S["pulse.actions"]);
  const pulse = () => app.cdp.eval(() => document.querySelector(".pulse")?.innerText ?? null);
  await waitFor("run state Running", async () => (await pulse())?.includes(S["pulse.state.running"]), { timeout: 15_000, interval: 250 });
  const startedMs = Date.now() - runAt;
  await waitFor("6 taps", async () => +(actionsRe.exec((await pulse()) ?? "")?.[1] ?? 0) >= 6, { timeout: 20_000, interval: 250 });
  await shot("B3-running");
  const before = +(actionsRe.exec((await pulse()) ?? "")?.[1] ?? 0);

  // the floating Halt button (an accessibility overlay): find its red circle on screen, else its known position
  const scr = await rawScreen();
  const dp = (v) => v * dev.density;
  const blob = findColorBlob(scr, { region: { x1: scr.w * 0.6, y1: scr.h * 0.15, x2: scr.w, y2: scr.h * 0.7 }, color: [0xef, 0x44, 0x44], tol: 45, before: noHalt, minCount: Math.round(dp(20) * dp(20)) });
  const okBlob = blob && blob.box.x2 - blob.box.x1 < dp(80) && blob.box.y2 - blob.box.y1 < dp(80);
  const halt = okBlob ? { x: blob.cx, y: blob.cy } : expectedHaltCenter(dev.size, dev.density);
  log(`Halt button at ${halt.x},${halt.y} (${okBlob ? "found on screen" : "expected position"})`);
  B.mark(C.halt);
  const haltAt = Date.now();
  await tap(halt.x, halt.y);
  let haltVia = "overlay";
  let stopMs = await waitFor("run stopped", async () => (await pulse()) === null, { timeout: 3000, interval: 100 }).then(() => Date.now() - haltAt).catch(() => null);
  if (stopMs === null) {
    // the overlay tap missed: use the in-app Halt button instead, and say so in the caption
    log("floating Halt tap did not stop the run — using the in-app Halt button");
    timeline.notes.push("floating Halt button tap missed; in-app Halt used");
    haltVia = "in-app";
    B.marks.pop();
    B.mark(C.haltInApp);
    const t1 = Date.now();
    await app.tap("Halt (in-app)", { sel: ".pulse button.halt" });
    await waitFor("run stopped", async () => (await pulse()) === null, { timeout: 10_000, interval: 100 });
    stopMs = Date.now() - t1;
  }
  const toast = await app.waitFind("stopped toast", { sel: ".toast", text: fmt(S["run.stopped"], { name: S["new.name.click"] }), exact: false }, 5000).catch(() => null);
  log(`stopped ${stopMs} ms after the Halt tap (toast: ${!!toast}, via ${haltVia})`);
  await sleep(2600);
  await shot("B4-halted");
  let ledger = false;
  try {
    // Home now has "Last runs" with this run; its row opens the run in the Ledger
    const rowQ = { sel: "table tr", text: S["new.name.click"], exact: false };
    const row = await app.waitFind("last runs row", rowQ, 8000);
    if (!row.text.includes(S["run.status.stopped"])) throw new Error(`run row says “${row.text}”`);
    await app.tap("last run (Ledger)", rowQ);
    ledger = await app.waitFind("ledger entry", { sel: "#main", text: S["run.status.stopped"], exact: false }, 8000).then(() => true).catch(() => false);
    if (ledger) B.mark(C.ledger);
    await sleep(3500);
  } catch (e) {
    timeline.notes.push(`Ledger not shown: ${e.message}`);
  }
  await shot("B5-ledger");
  timeline.parts.push(await B.stop());
  await sh("settings put system pointer_location 0", { allowFail: true });

  Object.assign(timeline, {
    device: dev,
    tapTarget: { label: S["nav.home"], screen: target, normalized: norm },
    runStartedMs: startedMs,
    actionsBeforeHalt: before,
    haltButton: { ...halt, foundOnScreen: !!okBlob, used: haltVia },
    stopLatencyMs: stopMs,
    stoppedToast: !!toast,
    ledgerShown: ledger,
  });
  writeFileSync(join(DIR, "timeline.json"), JSON.stringify(timeline, null, 2));
  cdp.close();
  log(`done: ${JSON.stringify({ enabledVia, stopLatencyMs: stopMs, actionsBeforeHalt: before })}`);
}

/** Settings ▸ Accessibility ▸ <AutoFlow> ▸ "Use …" switch ▸ Allow, with real taps. */
async function enableServiceInSettings(dev) {
  // 1) the AutoFlow entry in the Accessibility list (scroll down until it shows)
  let entry = null;
  for (let i = 0; i < 8 && !entry; i++) {
    const nodes = await uiNodes();
    entry = findByText(nodes, SERVICE_LABEL);
    if (!entry) {
      await sh(`input swipe ${dev.size.w / 2} ${dev.size.h * 0.75} ${dev.size.w / 2} ${dev.size.h * 0.35} 400`);
      await sleep(900);
    }
  }
  if (!entry) throw new Error(`"${SERVICE_LABEL}" not found in Accessibility settings`);
  await shot("A5-a11y-list");
  await sleep(1200);
  let c = center(entry.bounds);
  log(`tap Settings entry "${SERVICE_LABEL}" at ${c.x},${c.y}`);
  await tap(c.x, c.y);

  // 2) the service page's main switch
  const sw = await waitFor("service switch", async () => findServiceSwitch(await uiNodes(), SERVICE_LABEL), { timeout: 10_000, interval: 800 });
  await sleep(1800); // let the viewer read the service page (summary + description)
  await shot("A5b-service-page");
  if (!sw.checked) {
    c = center(sw.node.bounds);
    log(`tap switch at ${c.x},${c.y}`);
    await tap(c.x, c.y);
    // 3) "Allow AutoFlow automations to have full control of your device?" → Allow
    const allow = await waitFor("Allow button", async () => {
      const nodes = await uiNodes();
      return findByText(nodes, /^Allow$/i) ?? nodes.find((n) => /allow/i.test(n.id) && n.bounds) ?? null;
    }, { timeout: 10_000, interval: 800 });
    await sleep(2500); // the system dialog is part of the disclosure story: keep it readable
    await shot("A5c-system-dialog");
    c = center(allow.bounds);
    log(`tap Allow at ${c.x},${c.y}`);
    await tap(c.x, c.y);
  }
  await waitFor("switch on", async () => (await sh("settings get secure enabled_accessibility_services")).includes(SERVICE), { timeout: 8000 });
}

/* ================================================================== post-processing */

async function ffmpeg(argv) {
  log(`ffmpeg ${argv.join(" ").slice(0, 300)}…`);
  await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...argv], { maxBuffer: 64 * 1024 * 1024 });
}

function fontFor(lang) {
  const cands = lang === "ko" || lang === "ja" || lang.startsWith("zh")
    ? ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc"]
    : ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"];
  const f = cands.find((p) => existsSync(p));
  if (!f) throw new Error(`no font for ${lang}: install ${lang === "en" ? "fonts-dejavu-core" : "fonts-noto-cjk"}`);
  return f;
}

async function post() {
  const tl = JSON.parse(readFileSync(join(DIR, "timeline.json"), "utf8"));
  const C = CAPTIONS[LANG] ?? CAPTIONS.en;
  const font = fontFor(LANG);
  const work = join(DIR, "work");
  mkdirSync(work, { recursive: true });
  const max = LANG === "en" ? LAYOUT.maxChars : LAYOUT.maxCharsCjk;
  let fileN = 0;
  const textFiles = (text, maxChars) => wrapText(text, maxChars).map((line) => {
    const f = join(work, `t${++fileN}.txt`);
    writeFileSync(f, line);
    return f;
  });
  const enc = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-video_track_timescale", "30000", "-an"];

  const intro = join(work, "0-intro.mp4");
  await ffmpeg(["-f", "lavfi", "-i", `color=c=0x0B0B1A:s=${LAYOUT.W}x${LAYOUT.H}:r=30:d=4`, "-vf", introFilter({ font, titleFiles: textFiles(C.introTitle, LANG === "en" ? 28 : 16), subFiles: textFiles(C.introSub, LANG === "en" ? 44 : 24) }), ...enc, intro]);
  const pieces = [intro];
  for (const [i, p] of tl.parts.entries()) {
    const captions = p.captions.map((c) => ({ ...c, files: textFiles(c.text, max) }));
    const out = join(work, `${i + 1}-${p.name}.mp4`);
    await ffmpeg(["-i", p.file, "-vf", partFilter({ captions, font }), ...enc, out]);
    pieces.push(out);
  }
  const list = join(work, "list.txt");
  writeFileSync(list, pieces.map((p) => `file '${p}'`).join("\n") + "\n");
  const final = join(OUT, `autoflow-accessibility-demo-${LANG}.mp4`);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final]);
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=width,height,codec_name", "-of", "json", final]);
  log(`wrote ${final}: ${stdout.replace(/\s+/g, " ")}`);
}

/* ================================================================== main */

const main = { record, post }[cmd];
const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli && !main) {
  console.error("usage: demo-video.mjs record --apk <apk> --out <dir> [--lang en|ko] | post --out <dir> [--lang en|ko]");
  process.exit(2);
}
if (isCli) main().then(() => process.exit(0), async (e) => {
  console.error(e.stack || e.message);
  if (cmd === "record") {
    await shot("FAILED").catch(() => undefined);
    await adb(["logcat", "-d", "-t", "3000"], { allowFail: true }).then((l) => writeFileSync(join(DIR, "logcat.txt"), l)).catch(() => undefined);
    await sh("uiautomator dump /sdcard/ui.xml", { allowFail: true });
    await adb(["exec-out", "cat", "/sdcard/ui.xml"], { allowFail: true }).then((x) => writeFileSync(join(DIR, "FAILED-ui.xml"), x)).catch(() => undefined);
    await sh("kill -2 $(pidof screenrecord)", { allowFail: true });
  }
  process.exit(1);
});
