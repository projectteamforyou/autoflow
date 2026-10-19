// node --test scripts/play/demo-video-lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPTIONS, calibrate, center, closeCaptions, devtoolsSocket, expectedHaltCenter, findByText, findColorBlob, findServiceSwitch,
  fmt, focusedPackage, introFilter, normalizedPoint, parseEnTs, parseRawScreencap, parseUiDump, parseWmSize, partFilter,
  templateRegex, toScreen, wrapText,
} from "./demo-video-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const SERVICE_PAGE = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0">
<node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.android.settings" checkable="false" checked="false" clickable="false" enabled="true" bounds="[0,0][1080,1920]">
<node index="1" text="AutoFlow automations" resource-id="com.android.settings:id/collapsing_toolbar" class="android.widget.TextView" package="com.android.settings" checkable="false" checked="false" clickable="false" enabled="true" bounds="[42,200][900,280]" />
<node index="2" text="" resource-id="com.android.settings:id/main_switch_bar" class="android.widget.LinearLayout" package="com.android.settings" checkable="true" checked="false" clickable="true" enabled="true" bounds="[42,400][1038,560]">
<node index="0" text="Use AutoFlow automations" resource-id="com.android.settings:id/switch_text" class="android.widget.TextView" package="com.android.settings" checkable="false" checked="false" clickable="false" enabled="true" bounds="[100,440][800,520]" />
<node index="1" text="" resource-id="android:id/switch_widget" class="android.widget.Switch" package="com.android.settings" checkable="true" checked="false" clickable="false" enabled="true" bounds="[880,440][1000,520]" />
</node>
<node index="3" text="AutoFlow automations shortcut" resource-id="android:id/title" class="android.widget.TextView" package="com.android.settings" checkable="false" checked="false" clickable="false" enabled="true" bounds="[100,640][800,700]" />
<node index="4" text="" resource-id="android:id/switch_widget" class="android.widget.Switch" package="com.android.settings" checkable="true" checked="false" clickable="true" enabled="true" bounds="[880,630][1000,710]" />
<node index="5" text="Taps &amp; swipes &quot;only&quot; when you run a flow" resource-id="" class="android.widget.TextView" package="com.android.settings" checkable="false" checked="false" clickable="false" enabled="true" bounds="[42,800][1038,900]" />
</node></hierarchy>`;

test("parseUiDump reads attributes, entities and bounds", () => {
  const nodes = parseUiDump(SERVICE_PAGE);
  assert.equal(nodes.length, 8);
  assert.equal(nodes[1].text, "AutoFlow automations");
  assert.deepEqual(nodes[1].bounds, { x1: 42, y1: 200, x2: 900, y2: 280 });
  assert.equal(nodes[7].text, 'Taps & swipes "only" when you run a flow');
  assert.deepEqual(center(nodes[1].bounds), { x: 471, y: 240 });
  assert.equal(findByText(nodes, /shortcut$/).text, "AutoFlow automations shortcut");
  assert.equal(findByText(nodes, "nope"), null);
});

test("findServiceSwitch picks the Use … switch, not the shortcut switch", () => {
  const sw = findServiceSwitch(parseUiDump(SERVICE_PAGE), "AutoFlow automations");
  assert.deepEqual(sw.node.bounds, { x1: 880, y1: 440, x2: 1000, y2: 520 });
  assert.equal(sw.checked, false);
});

test("device output parsers", () => {
  assert.deepEqual(parseWmSize("Physical size: 1080x1920\n"), { w: 1080, h: 1920 });
  assert.deepEqual(parseWmSize("Physical size: 1080x2400\nOverride size: 720x1600\n"), { w: 720, h: 1600 });
  const unix = "Num RefCount Protocol Flags Type St Inode Path\n00000000: 00000002 00000000 00010000 0001 01 12345 @webview_devtools_remote_4242\n00000000: 00000002 00000000 00010000 0001 01 12346 @webview_devtools_remote_999\n";
  assert.equal(devtoolsSocket(unix, 999), "webview_devtools_remote_999");
  assert.equal(devtoolsSocket(unix, 1), null);
  assert.equal(focusedPackage("  mCurrentFocus=Window{1a2b u0 com.android.settings/com.android.settings.SubSettings}\n"), "com.android.settings");
  assert.equal(focusedPackage("  mCurrentFocus=Window{9f u0 com.projectteamforyou.autoflow/com.projectteamforyou.autoflow.MainActivity}"), "com.projectteamforyou.autoflow");
  assert.equal(focusedPackage("  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{77 u0 com.google.android.apps.nexuslauncher/.NexusLauncherActivity t2}"), "com.google.android.apps.nexuslauncher");
});

test("WebView calibration maps CSS px to screen px", () => {
  const cal = calibrate(2.625, 540, 400, 205.7, 128.4);
  const p = toScreen(cal, 205.7, 128.4);
  assert.deepEqual(p, { x: 540, y: 400 });
  const q = toScreen(cal, 0, 0);
  assert.equal(q.x, Math.round(540 - 205.7 * 2.625));
  assert.deepEqual(normalizedPoint({ w: 1080, h: 1920 }, 108, 192), { x: 0.1, y: 0.1 });
});

function fakeScreencap(w, h, paint, header = 16) {
  const buf = Buffer.alloc(header + w * h * 4);
  buf.writeUInt32LE(w, 0);
  buf.writeUInt32LE(h, 4);
  buf.writeUInt32LE(1, 8);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b] = paint(x, y);
    const i = header + (y * w + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
  }
  return buf;
}

test("raw screencap + red blob search finds the Halt button and ignores what was already red", () => {
  const W = 200, H = 300;
  const bg = [11, 11, 26];
  const red = [0xef, 0x44, 0x44];
  const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  // a red badge that is on both screenshots, and the Halt circle only on the second
  const badge = (x, y) => x >= 150 && x < 190 && y >= 60 && y < 70;
  const before = parseRawScreencap(fakeScreencap(W, H, (x, y) => (badge(x, y) ? red : bg)));
  const after = parseRawScreencap(fakeScreencap(W, H, (x, y) => (badge(x, y) || inCircle(x, y, 170, 120, 15) ? red : bg), 12));
  assert.equal(after.w, W);
  const blob = findColorBlob(after, { region: { x1: 100, y1: 0, x2: W, y2: H }, color: red, before, minCount: 100 });
  assert.ok(blob);
  assert.ok(Math.abs(blob.cx - 170) <= 1 && Math.abs(blob.cy - 120) <= 1, JSON.stringify(blob));
  assert.ok(blob.box.x2 - blob.box.x1 <= 32);
  assert.equal(findColorBlob(before, { region: { x1: 0, y1: 0, x2: W, y2: H }, color: red, before, minCount: 1 }), null);
  assert.throws(() => parseRawScreencap(Buffer.alloc(40)));
});

test("expected Halt position follows Overlays.setHaltVisible", () => {
  // 1080×1920 @ 2.625: x = 1080 - 31 - 73(.5) ; y = 672 + 73(.5)
  assert.deepEqual(expectedHaltCenter({ w: 1080, h: 1920 }, 2.625), { x: 1080 - 31 - 74, y: 672 + 74 });
});

test("every app string the script uses exists in en.ts and ko.json", () => {
  const en = parseEnTs(readFileSync(join(ROOT, "apps/web/src/i18n/en.ts"), "utf8"));
  const ko = JSON.parse(readFileSync(join(ROOT, "apps/web/src/i18n/locales/ko.json"), "utf8"));
  const script = readFileSync(join(ROOT, "scripts/play/demo-video.mjs"), "utf8");
  const keys = [...new Set([...script.matchAll(/S\["([\w.]+)"\]/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 20, `only ${keys.length} keys found`);
  for (const k of keys) {
    assert.equal(typeof en[k], "string", `en.ts is missing ${k}`);
    assert.equal(typeof ko[k], "string", `ko.json is missing ${k}`);
  }
  assert.equal(en["perm.disclosure.agree"], "I understand — continue");
  assert.equal(fmt(en["run.stopped"], { name: "Auto clicker" }), "“Auto clicker” stopped.");
  assert.equal(templateRegex(en["pulse.actions"]).exec("Running · This device · 7 actions")[1], "7");
  assert.equal(templateRegex(ko["pulse.actions"]).exec("실행 중 · 이 기기 · 12개 동작")[1], "12");
});

test("captions: wrapping, timing and ffmpeg filters", () => {
  for (const lang of Object.keys(CAPTIONS)) assert.deepEqual(Object.keys(CAPTIONS[lang]).sort(), Object.keys(CAPTIONS.en).sort(), lang);
  const lines = wrapText(CAPTIONS.en.run, 44);
  assert.ok(lines.length >= 2 && lines.every((l) => l.length <= 44), JSON.stringify(lines));
  assert.equal(lines.join(" "), CAPTIONS.en.run);
  const ko = wrapText(CAPTIONS.ko.disclosure, 24);
  assert.ok(ko.length >= 2 && ko.join(" ") === CAPTIONS.ko.disclosure, JSON.stringify(ko));
  assert.deepEqual(wrapText("x".repeat(10), 4), ["xxxx", "xxxx", "xx"]);

  const caps = closeCaptions([{ at: 5, text: "b" }, { at: 0.2, text: "a" }], 9);
  assert.deepEqual(caps, [{ text: "a", from: 0.2, to: 5 }, { text: "b", from: 5, to: 9 }]);

  const vf = partFilter({ captions: [{ from: 0, to: 2.5, files: ["/w/t1.txt", "/w/t2.txt"] }], font: "/f/DejaVuSans.ttf" });
  assert.match(vf, /^fps=30,scale=-2:1660:flags=lanczos,pad=1080:1920:/);
  assert.equal(vf.match(/drawtext=/g).length, 2);
  assert.match(vf, /textfile=\/w\/t2\.txt:expansion=none/);
  assert.match(vf, /enable='between\(t,0\.00,2\.50\)'/);
  assert.match(vf, /format=yuv420p$/);
  const intro = introFilter({ font: "/f.ttf", titleFiles: ["/a"], subFiles: ["/b", "/c"] });
  assert.equal(intro.match(/drawtext=/g).length, 3);
});
