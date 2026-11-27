#!/usr/bin/env node
/**
 * Mirrors a GitHub release to Cloudflare R2 so every download is served from dl.autoflowmacro.com.
 *
 *   GITHUB_TOKEN=… CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/release/publish-r2.mjs v1.0.0 [--allow-unsigned]
 *   CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/release/publish-r2.mjs v1.0.0 --from-public [--published-at <ISO time>]
 *
 * --from-public needs no GitHub token or API: the repository is public, so the file list comes from the
 * release's own SHA256SUMS.txt / SHA256SUMS-android.txt, every file is downloaded from
 * github.com/<repo>/releases/download/<tag>/ and refused unless its SHA-256 matches the list.
 *
 * Layout (bucket autoflow-releases):
 *   releases/<tag>/<asset>               immutable copy of every release asset
 *   windows/AutoFlow-Setup-x64.exe       latest NSIS installer   (stable URL used by the site and the API)
 *   windows/AutoFlow-x64.msi             latest MSI (Korean UI, ko-KR)
 *   windows/AutoFlow-x64-en-US.msi       latest MSI (English UI)
 *   windows/AutoFlow-portable-x64.exe    latest portable exe
 *   android/AutoFlow.apk                 latest signed APK
 *   latest.json                          version, sizes and SHA-256 of the stable files
 * UNSIGNED Windows builds are refused unless --allow-unsigned is given (they are never promoted to the stable URLs).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The current name: the old one (work517/autoflow) answers API calls with a redirect to a numeric-id path.
const REPO = process.env.GITHUB_REPOSITORY ?? "projectteamforyou/autoflow";
const BUCKET = process.env.R2_BUCKET ?? "autoflow-releases";
const PUBLIC = process.env.R2_PUBLIC_URL ?? "https://dl.autoflowmacro.com";
const tag = process.argv[2];
const allowUnsigned = process.argv.includes("--allow-unsigned");
const fromPublic = process.argv.includes("--from-public");
/** Downloads and checks everything, prints what would be uploaded, uploads nothing. */
const dryRun = process.argv.includes("--dry-run");
const publishedArg = process.argv.includes("--published-at") ? process.argv[process.argv.indexOf("--published-at") + 1] : undefined;
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("usage: publish-r2.mjs vX.Y.Z [--allow-unsigned] [--from-public [--published-at <ISO time>]] [--dry-run]");
for (const k of [...(fromPublic ? [] : ["GITHUB_TOKEN"]), ...(dryRun ? [] : ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"])]) if (!process.env[k]) throw new Error(`${k} is required`);
if (publishedArg !== undefined && Number.isNaN(Date.parse(publishedArg ?? ""))) throw new Error("--published-at needs an ISO date-time");

const gh = (path, accept = "application/vnd.github+json") =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: accept }, redirect: "follow" });
const PUBLIC_BASE = `https://github.com/${REPO}/releases/download/${tag}`;
const fetchPublic = async (name) => {
  const r = await fetch(`${PUBLIC_BASE}/${encodeURIComponent(name)}`, { redirect: "follow" });
  if (!r.ok) throw new Error(`download ${name}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const version = tag.slice(1);
const dir = mkdtempSync(join(tmpdir(), "afr2-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

/** @type {{ name: string, load: () => Promise<Buffer>, expect?: string }[]} */
let assets;
let release;
if (fromPublic) {
  // The checksum lists are the manifest: "<sha256>  <file name>" per line.
  const expected = new Map();
  const lists = [];
  for (const list of ["SHA256SUMS.txt", "SHA256SUMS-android.txt"]) {
    let text;
    try {
      text = (await fetchPublic(list)).toString("utf8");
    } catch (e) {
      console.log(`${list}: not in this release (${e.message})`);
      continue;
    }
    lists.push(list);
    for (const line of text.split(/\r?\n/)) {
      const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
      if (m) expected.set(m[2].trim(), m[1].toLowerCase());
    }
  }
  if (!expected.size) throw new Error(`release ${tag}: no SHA256SUMS list found at ${PUBLIC_BASE}`);
  assets = [...expected].map(([name, sha]) => ({ name, expect: sha, load: () => fetchPublic(name) })).concat(lists.map((name) => ({ name, load: () => fetchPublic(name) })));
  release = { published_at: publishedArg ?? new Date().toISOString(), html_url: `https://github.com/${REPO}/releases/tag/${tag}` };
} else {
  const res = await gh(`/releases/tags/${tag}`);
  if (!res.ok) throw new Error(`release ${tag}: ${res.status} ${await res.text()}`);
  release = await res.json();
  if (publishedArg) release.published_at = publishedArg;
  assets = release.assets.map((asset) => ({
    name: asset.name,
    load: async () => {
      const dl = await gh(`/releases/assets/${asset.id}`, "application/octet-stream");
      if (!dl.ok) throw new Error(`download ${asset.name}: ${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    },
  }));
}

const put = (key, file, type, disposition) => {
  // Versioned copies never change; stable aliases and latest.json move with each release.
  const cache = key.startsWith("releases/") ? "public, max-age=31536000, immutable" : "public, max-age=300";
  const args = ["-y", "wrangler@3", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", type, "--cache-control", cache];
  if (disposition) args.push("--content-disposition", `attachment; filename="${disposition}"`);
  if (dryRun) return console.log(`  (dry run) r2 ${key}`);
  execFileSync("npx", args, { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`  r2 ${key}`);
};
const typeOf = (n) => (n.endsWith(".apk") ? "application/vnd.android.package-archive" : n.endsWith(".msi") ? "application/x-msi" : n.endsWith(".exe") ? "application/vnd.microsoft.portable-executable" : "text/plain; charset=utf-8");

/** Stable alias of a release file, or null when it only gets its versioned copy. One file per alias. */
function aliasOf(name) {
  return /setup\.exe$/i.test(name) ? "windows/AutoFlow-Setup-x64.exe"
    : /_en-US\.msi$/i.test(name) ? "windows/AutoFlow-x64-en-US.msi"
    : /\.msi$/i.test(name) ? "windows/AutoFlow-x64.msi"
    : /portable.*\.exe$/i.test(name) ? "windows/AutoFlow-portable-x64.exe"
    : /android\.apk$/i.test(name) ? "android/AutoFlow.apk"
    : null;
}

// Two files on one alias would leave latest.json with a checksum that does not match what is served.
const taken = new Map();
for (const { name } of assets) {
  const alias = /UNSIGNED/i.test(name) && !allowUnsigned ? null : aliasOf(name);
  if (!alias) continue;
  if (taken.has(alias)) throw new Error(`${name} and ${taken.get(alias)} both map to ${alias}`);
  taken.set(alias, name);
}

const stable = [];
for (const asset of assets) {
  const file = join(dir, asset.name);
  writeFileSync(file, await asset.load());
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (asset.expect && asset.expect !== sha256) throw new Error(`${asset.name}: SHA-256 ${sha256} does not match the release's checksum list (${asset.expect})`);
  console.log(`${asset.name}  ${statSync(file).size} bytes  ${sha256}`);
  put(`releases/${tag}/${asset.name}`, file, typeOf(asset.name), asset.name);

  const unsigned = /UNSIGNED/i.test(asset.name);
  if (unsigned && !allowUnsigned) continue;
  const alias = aliasOf(asset.name);
  if (!alias) continue;
  put(alias, file, typeOf(asset.name), asset.name);
  stable.push({ key: alias, url: `${PUBLIC}/${alias}`, name: asset.name, size: statSync(file).size, sha256, signed: !unsigned });
}

const latest = { version, tag, publishedAt: release.published_at, release: release.html_url, files: stable };
if (dryRun) console.log(JSON.stringify(latest, null, 2));
const latestFile = join(dir, "latest.json");
writeFileSync(latestFile, JSON.stringify(latest, null, 2) + "\n");
put("latest.json", latestFile, "application/json");
console.log(`\n${PUBLIC}/latest.json → ${stable.length} stable file(s)`);
console.log("Stable aliases are cached for 5 minutes (max-age=300); purge the zone cache to switch at once.");
