#!/usr/bin/env node
/**
 * Mirrors a GitHub release to Cloudflare R2 so every download is served from dl.autoflowmacro.com.
 *
 *   GITHUB_TOKEN=… CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/release/publish-r2.mjs v1.0.0 [--allow-unsigned]
 *
 * Layout (bucket autoflow-releases):
 *   releases/<tag>/<asset>               immutable copy of every release asset
 *   windows/AutoFlow-Setup-x64.exe       latest NSIS installer   (stable URL used by the site and the API)
 *   windows/AutoFlow-x64.msi             latest MSI
 *   windows/AutoFlow-portable-x64.exe    latest portable exe
 *   android/AutoFlow.apk                 latest signed APK
 *   latest.json                          version, sizes and SHA-256 of the stable files
 * UNSIGNED Windows builds are refused unless --allow-unsigned is given (they are never promoted to the stable URLs).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.env.GITHUB_REPOSITORY ?? "work517/autoflow";
const BUCKET = process.env.R2_BUCKET ?? "autoflow-releases";
const PUBLIC = process.env.R2_PUBLIC_URL ?? "https://dl.autoflowmacro.com";
const tag = process.argv[2];
const allowUnsigned = process.argv.includes("--allow-unsigned");
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("usage: publish-r2.mjs vX.Y.Z [--allow-unsigned]");
for (const k of ["GITHUB_TOKEN", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"]) if (!process.env[k]) throw new Error(`${k} is required`);

const gh = (path, accept = "application/vnd.github+json") =>
  fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: accept }, redirect: "follow" });

const res = await gh(`/releases/tags/${tag}`);
if (!res.ok) throw new Error(`release ${tag}: ${res.status} ${await res.text()}`);
const release = await res.json();
const version = tag.slice(1);
const dir = mkdtempSync(join(tmpdir(), "afr2-"));

const put = (key, file, type, disposition) => {
  // Versioned copies never change; stable aliases and latest.json move with each release.
  const cache = key.startsWith("releases/") ? "public, max-age=31536000, immutable" : "public, max-age=300";
  const args = ["-y", "wrangler@3", "r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--content-type", type, "--cache-control", cache];
  if (disposition) args.push("--content-disposition", `attachment; filename="${disposition}"`);
  execFileSync("npx", args, { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`  r2 ${key}`);
};
const typeOf = (n) => (n.endsWith(".apk") ? "application/vnd.android.package-archive" : n.endsWith(".msi") ? "application/x-msi" : n.endsWith(".exe") ? "application/vnd.microsoft.portable-executable" : "text/plain; charset=utf-8");

const stable = [];
for (const asset of release.assets) {
  const dl = await gh(`/releases/assets/${asset.id}`, "application/octet-stream");
  if (!dl.ok) throw new Error(`download ${asset.name}: ${dl.status}`);
  const file = join(dir, asset.name);
  writeFileSync(file, Buffer.from(await dl.arrayBuffer()));
  const sha256 = createHash("sha256").update(readFileSync(file)).digest("hex");
  console.log(`${asset.name}  ${statSync(file).size} bytes  ${sha256}`);
  put(`releases/${tag}/${asset.name}`, file, typeOf(asset.name), asset.name);

  const unsigned = /UNSIGNED/i.test(asset.name);
  if (unsigned && !allowUnsigned) continue;
  const alias =
    /setup\.exe$/i.test(asset.name) ? "windows/AutoFlow-Setup-x64.exe"
    : /\.msi$/i.test(asset.name) ? "windows/AutoFlow-x64.msi"
    : /portable.*\.exe$/i.test(asset.name) ? "windows/AutoFlow-portable-x64.exe"
    : /android\.apk$/i.test(asset.name) ? "android/AutoFlow.apk"
    : null;
  if (!alias) continue;
  put(alias, file, typeOf(asset.name), asset.name);
  stable.push({ key: alias, url: `${PUBLIC}/${alias}`, name: asset.name, size: statSync(file).size, sha256, signed: !unsigned });
}

const latest = { version, tag, publishedAt: release.published_at, release: release.html_url, files: stable };
const latestFile = join(dir, "latest.json");
writeFileSync(latestFile, JSON.stringify(latest, null, 2) + "\n");
put("latest.json", latestFile, "application/json");
console.log(`\n${PUBLIC}/latest.json → ${stable.length} stable file(s)`);
