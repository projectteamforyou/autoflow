#!/usr/bin/env node
/**
 * Google Play publishing through the Developer API for AutoFlow (adapted from the proven Play kit — docs/PLAY_RELEASE.md):
 * the signed bundle, the 12 store listings, the release notes, the icon, the feature graphic, the phone and tablet
 * screenshots and (optionally) the promo video link, in one edit.
 *
 * Everything sent is read from this repository, so the store can never drift from what `check-listing.mjs` measured:
 *   store/listing/<play-locale>.json      title · shortDescription · fullDescription · video (optional YouTube URL;
 *                                         absent = keep whatever video Play already has for that locale)
 *   store/whatsnew/whatsnew-<play-locale> release notes (≤ 500)
 *   store/icon-512.png                    listing icon 512×512 (scripts/store/icons.mjs)
 *   store/screens/<play-locale>/feature.png        feature graphic 1024×500 (falls back to en-US)
 *   store/screens/<play-locale>/0N-*.png          phone screenshots, 2–8 (a locale without its own keeps Play's
 *                                                  fallback to the default listing's images)
 *   store/screens/<play-locale>/tablet7/0N-*.png   7-inch tablet screenshots (1200×1920), up to 8
 *   store/screens/<play-locale>/tablet10/0N-*.png  10-inch tablet screenshots (1600×2560), up to 8
 *   (all images rendered by scripts/store/screens.mjs)
 *
 * Not here, because Google offers no API for them: the content rating questionnaire, data safety, target audience,
 * the ads declaration, app access, the Accessibility API and foreground-service declarations. Those are Console
 * clicks (docs/PLAY_RELEASE.md).
 *
 * No SDK: the JWT is signed with node:crypto and the calls are plain fetch. Auth: PLAY_ACCESS_TOKEN (workload identity
 * federation, no key) wins; otherwise a PLAY_SERVICE_ACCOUNT_JSON key is signed here.
 *
 *   node scripts/play/publish.mjs --package com.projectteamforyou.autoflow --aab app-release.aab --track internal
 *        [--status completed|draft|inProgress|halted] [--no-images] [--dry-run]
 *   node scripts/play/publish.mjs --package com.projectteamforyou.autoflow --listing-only [--no-images] [--dry-run]
 *        (store page only — listings, promo video links, icon/feature/screenshots; no bundle, no track change)
 *   node scripts/play/publish.mjs --package com.projectteamforyou.autoflow --check [--version-code 42]
 *        (pre-build: credentials, permissions, every locale accepted, version code still unused — nothing changes)
 */
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const STORE = join(ROOT, 'store');
const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const UPLOAD = 'https://androidpublisher.googleapis.com/upload/androidpublisher/v3';

/** The 12 Play locale codes AutoFlow ships (same list as check-listing.mjs). en-US is the default listing. */
export const LOCALES = ['en-US', 'ko-KR', 'ja-JP', 'zh-CN', 'zh-TW', 'es-ES', 'fr-FR', 'de-DE', 'pt-BR', 'ru-RU', 'vi', 'id'];
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000, releaseNotes: 500 };

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const PACKAGE = arg('package');
const AAB = arg('aab');
const TRACK = arg('track', 'internal');
const STATUS = arg('status', 'completed');
const CHECK = has('check');
const DRY = has('dry-run');
const IMAGES = !has('no-images');
const VERSION_CODE = arg('version-code');

/** Same count as check-listing.mjs: the stricter of code points and UTF-16 units, so emoji never overflow on Play. */
const len = (s) => Math.max([...s].length, s.length);

/** One locale's listing and notes, measured before anything is sent (Play refuses an over-long field, it never trims). */
export async function copyFor(locale) {
  // tolerate a UTF-8 BOM and CRLF (files edited on Windows)
  const j = JSON.parse((await readFile(join(STORE, 'listing', `${locale}.json`), 'utf8')).replace(/^\uFEFF/, ''));
  const notesFile = join(STORE, 'whatsnew', `whatsnew-${locale}`);
  const c = {
    title: String(j.title ?? '').trim(),
    shortDescription: String(j.shortDescription ?? '').trim(),
    fullDescription: String(j.fullDescription ?? '').trim(),
    releaseNotes: existsSync(notesFile) ? (await readFile(notesFile, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim() : '',
  };
  for (const [field, max] of Object.entries(LIMITS)) {
    if (field !== 'releaseNotes' && !c[field]) throw new Error(`${locale}: ${field} is empty`);
    if (len(c[field]) > max) throw new Error(`${locale}: ${field} is ${len(c[field])} characters, over ${max}`);
  }
  // Promo video: Play takes only a YouTube link (public or unlisted, ads off, not age-restricted, no playlist/channel).
  if (j.video !== undefined && j.video !== null) {
    c.video = String(j.video).trim();
    if (c.video && !isYouTubeVideo(c.video)) throw new Error(`${locale}: video must be a YouTube video URL (https://www.youtube.com/watch?v=… or https://youtu.be/…), got "${c.video}"`);
  }
  return c;
}

/** A single YouTube video link (watch, youtu.be or shorts) — Play rejects playlists, channels and other hosts. */
export function isYouTubeVideo(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.replace(/^(www|m)\./, '');
  if (host === 'youtu.be') return /^\/[\w-]{11}$/.test(u.pathname);
  if (host !== 'youtube.com') return false;
  if (u.pathname === '/watch') return /^[\w-]{11}$/.test(u.searchParams.get('v') ?? '') && !u.searchParams.has('list');
  return /^\/(shorts|embed)\/[\w-]{11}$/.test(u.pathname);
}

/** A PNG's size from its header — enough to refuse a wrong file before it costs an upload. */
function pngSize(bytes) {
  if (!bytes || bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

const ICON = join(STORE, 'icon-512.png');
const featureFor = (locale) => [join(STORE, 'screens', locale, 'feature.png'), join(STORE, 'screens', 'en-US', 'feature.png')].find((f) => existsSync(f));
/** Screenshot sets per Play image type: the phone set lives in the locale folder, tablets in subfolders. */
const SHOT_TYPES = { phoneScreenshots: '', sevenInchScreenshots: 'tablet7', tenInchScreenshots: 'tablet10' };
async function shotsFor(locale, kind = 'phoneScreenshots') {
  const dir = join(STORE, 'screens', locale, SHOT_TYPES[kind]);
  const files = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((f) => f.isFile() && /^\d+.*\.png$/.test(f.name)).map((f) => f.name).sort();
  return files.slice(0, 8).map((f) => join(dir, f)); // Play: at most 8 screenshots per type
}
/** Play wants at least 2 phone screenshots; a tablet set is optional, so one is enough to replace it. */
const MIN_SHOTS = { phoneScreenshots: 2, sevenInchScreenshots: 1, tenInchScreenshots: 1 };

/** Sizes Play accepts (the API never resizes; it answers 400 after the bundle upload). */
async function checkGraphics() {
  const icon = pngSize(await readFile(ICON).catch(() => null));
  if (!icon || icon.w !== 512 || icon.h !== 512) throw new Error(`icon must be a 512×512 PNG: ${ICON}`);
  for (const locale of LOCALES) {
    const f = featureFor(locale);
    const s = f && pngSize(await readFile(f));
    if (!s || s.w !== 1024 || s.h !== 500) throw new Error(`feature graphic for ${locale} must be a 1024×500 PNG (${f ?? 'missing'})`);
    for (const kind of Object.keys(SHOT_TYPES)) {
      for (const shot of await shotsFor(locale, kind)) {
        const z = pngSize(await readFile(shot));
        // phone and tablet screenshots: 320–3840 px per side, long side ≤ 2× short side
        if (!z || Math.min(z.w, z.h) < 320 || Math.max(z.w, z.h) > 3840 || Math.max(z.w, z.h) > 2 * Math.min(z.w, z.h)) {
          throw new Error(`screenshot ${shot} has an unsupported size ${z ? `${z.w}×${z.h}` : '(not a PNG)'}`);
        }
      }
    }
  }
  const counts = await Promise.all(
    LOCALES.map(async (l) => `${l}:${(await Promise.all(Object.keys(SHOT_TYPES).map(async (k) => (await shotsFor(l, k)).length))).join('/')}`),
  );
  console.log(`graphics ok · icon 512 · feature 1024×500 · screenshots phone/7"/10" ${counts.join(' ')}`);
}

async function token() {
  const federated = (process.env.PLAY_ACCESS_TOKEN ?? '').trim();
  if (federated) {
    console.log('auth: workload identity federation (no key)');
    return federated;
  }
  const raw = (process.env.PLAY_SERVICE_ACCOUNT_JSON ?? '').trim();
  if (!raw) throw new Error('No credentials: set PLAY_ACCESS_TOKEN (workload identity) or PLAY_SERVICE_ACCOUNT_JSON (key).');
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw new Error('PLAY_SERVICE_ACCOUNT_JSON is not valid JSON — paste the whole key file, braces included.');
  }
  console.log(`auth: service account ${key.client_email}`);
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(body).sign(key.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${sig}` }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`no access token: ${JSON.stringify(json)}`);
  return json.access_token;
}

let ACCESS = '';
async function call(path, { method = 'GET', json, body, type } = {}) {
  const url = path.startsWith('http') ? path : `${API}/applications/${PACKAGE}${path}`;
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${ACCESS}`, ...(json ? { 'content-type': 'application/json' } : {}), ...(type ? { 'content-type': type } : {}) },
    body: json ? JSON.stringify(json) : body,
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 404 && /edits$/.test(path)) {
      throw new Error(`Play does not know ${PACKAGE} for this account (404). Create the app in Play Console and invite the service account to it (docs/PLAY_RELEASE.md §2, §5).\n${text}`);
    }
    // the package name contains the key alias, which GitHub masks in logs — print it as <package> so errors stay readable
    const safe = (t) => String(t).split(PACKAGE).join('<package>');
    throw new Error(`${method} ${safe(path.replace(/^https:\/\/[^/]+/, ''))} -> ${res.status}\n${safe(text)}`);
  }
  return text ? JSON.parse(text) : {};
}

/** Validate/commit an edit; a 403 here means a missing release permission (Play checks it last, not first). */
let notSentForReview = false;
async function finish(editId, verb) {
  try {
    if (verb === ':validate' && notSentForReview) return; // see below: :validate does not take the flag
    const r = await call(`/edits/${editId}${verb}${notSentForReview ? '?changesNotSentForReview=true' : ''}`, { method: 'POST' });
    console.log(`${verb.slice(1)}d ${r.id ?? editId}`);
  } catch (err) {
    // A new app (or one with Console changes pending) refuses an automatic review submission:
    // "Changes cannot be sent for review automatically … set changesNotSentForReview to true". Save the edit without
    // submitting; the owner then presses "Send for review" in the Console (publishing overview) once.
    // After a rejection Play already says so at :validate, which does not take the flag: skip validation there (the
    // commit validates the edit too) and commit with changesNotSentForReview=true.
    if (/-> 400/.test(String(err.message)) && /changesNotSentForReview=true|cannot be sent for review/i.test(String(err.message))) {
      notSentForReview = true;
      if (verb === ':validate') {
        console.log('Play will not submit this for review automatically — the commit will save it without sending it for review.');
        return;
      }
      console.log('Play will not submit this for review automatically — committing it without sending for review.');
      const r = await call(`/edits/${editId}:commit?changesNotSentForReview=true`, { method: 'POST' });
      console.log(`committed ${r.id ?? editId} (not sent for review)`);
      return;
    }
    console.error(String(err.message));
    if (!/-> 403/.test(String(err.message))) throw err;
    throw new Error(
      `${err.message}\n\nEvery earlier call was accepted; Play checks the release permission only here.\n` +
        `Play Console → 사용자 및 권한 → the service account → 앱 권한 → AutoFlow → tick ` +
        `"${TRACK === 'production' ? '프로덕션으로 출시' : '테스트 트랙으로 출시'}" and "스토어 등록정보 관리", and make sure the invite is accepted.`,
    );
  }
}

async function putListings(editId, copy) {
  let videos = 0;
  for (const locale of LOCALES) {
    const c = copy[locale];
    // PUT replaces the whole listing, video included: without a `video` in the JSON keep the one Play already has
    // (e.g. set by hand in the Console); an empty string clears it on purpose.
    const video = c.video ?? (await call(`/edits/${editId}/listings/${locale}`).catch(() => ({}))).video ?? '';
    if (video) videos++;
    await call(`/edits/${editId}/listings/${locale}`, {
      method: 'PUT',
      json: { language: locale, title: c.title, shortDescription: c.shortDescription, fullDescription: c.fullDescription, ...(video ? { video } : {}) },
    }).catch((err) => {
      throw new Error(`Play refused the ${locale} listing (store/listing/${locale}.json):\n${err.message}`);
    });
  }
  console.log(`listings: ${LOCALES.length} locales · promo video on ${videos}`);
}

async function putImages(editId) {
  const up = async (locale, kind, file) => {
    await call(`${UPLOAD}/applications/${PACKAGE}/edits/${editId}/listings/${locale}/${kind}?uploadType=media`, { method: 'POST', body: await readFile(file), type: 'image/png' });
  };
  for (const locale of LOCALES) {
    const sets = Object.fromEntries(await Promise.all(Object.keys(SHOT_TYPES).map(async (k) => [k, await shotsFor(locale, k)])));
    const send = Object.keys(sets).filter((k) => sets[k].length >= MIN_SHOTS[k]);
    // replaced, not appended, so a re-run never stacks duplicates; a type with no shots of its own here keeps what Play
    // has (or its fallback to the default listing)
    for (const kind of ['icon', 'featureGraphic', ...send]) {
      await call(`/edits/${editId}/listings/${locale}/${kind}`, { method: 'DELETE' }).catch(() => {});
    }
    await up(locale, 'icon', ICON);
    await up(locale, 'featureGraphic', featureFor(locale));
    for (const kind of send) for (const s of sets[kind]) await up(locale, kind, s);
    const n = (k) => (send.includes(k) ? sets[k].length : 0);
    console.log(`images ${locale}: icon · feature · phone ${n('phoneScreenshots')} · 7" ${n('sevenInchScreenshots')} · 10" ${n('tenInchScreenshots')}`);
  }
}

async function check() {
  const copy = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l, await copyFor(l)])));
  console.log(`copy ok: ${LOCALES.length} locales`);
  if (IMAGES) await checkGraphics();
  ACCESS = await token();
  const edit = await call('/edits', { method: 'POST', json: {} });
  try {
    await putListings(edit.id, copy); // proves every locale code and text is accepted, then the edit is thrown away
    if (VERSION_CODE) {
      const { bundles = [] } = await call(`/edits/${edit.id}/bundles`);
      const used = bundles.map((b) => Number(b.versionCode));
      const highest = used.length ? Math.max(...used) : 0;
      console.log(`version codes on Play: ${used.length ? used.join(', ') : 'none'}`);
      if (Number(VERSION_CODE) <= highest) {
        throw new Error(`This build would be versionCode ${VERSION_CODE} but ${highest} is already on Play. A version code is spent forever once uploaded — raise VERSION_CODE_OFFSET (repo variable) above ${highest}.`);
      }
      console.log(`versionCode ${VERSION_CODE}: clear of ${highest}`);
    }
  } finally {
    await call(`/edits/${edit.id}`, { method: 'DELETE' }).catch(() => {});
  }
  console.log(`ok: credentials work and the account can edit ${PACKAGE}`);
}

async function publish() {
  const copy = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l, await copyFor(l)])));
  console.log(`copy ok: ${LOCALES.map((l) => `${l} "${copy[l].title}"`).join(' · ')}`);
  if (IMAGES) await checkGraphics();
  if (DRY) return console.log('--dry-run: nothing sent.');

  ACCESS = await token();
  const edit = await call('/edits', { method: 'POST', json: {} });
  console.log(`edit ${edit.id}`);
  const aab = await readFile(resolve(AAB));
  const up = await call(`${UPLOAD}/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`, { method: 'POST', body: aab, type: 'application/octet-stream' });
  console.log(`uploaded versionCode ${up.versionCode} (${(aab.length / 1048576).toFixed(1)} MB)`);

  await putListings(edit.id, copy);
  if (IMAGES) await putImages(edit.id);

  const setTrack = async (status) => {
    await call(`/edits/${edit.id}/tracks/${TRACK}`, {
      method: 'PUT',
      json: {
        track: TRACK,
        releases: [
          {
            name: `${process.env.RELEASE_NAME ?? up.versionCode}`,
            versionCodes: [String(up.versionCode)],
            status,
            ...(status === 'inProgress' ? { userFraction: Number(process.env.PLAY_USER_FRACTION ?? 0.2) } : {}),
            releaseNotes: LOCALES.filter((l) => copy[l].releaseNotes).map((l) => ({ language: l, text: copy[l].releaseNotes })),
          },
        ],
      },
    });
    console.log(`track ${TRACK}: ${status}`);
  };

  let status = STATUS;
  await setTrack(status);
  // A never-published ("draft") app only takes draft releases. Keep the bundle, listings and images, downgrade the
  // release to a draft, and say what single Console click finishes the first release.
  try {
    await finish(edit.id, ':validate');
  } catch (err) {
    if (status === 'draft' || !/draft app/i.test(String(err.message))) throw err;
    console.log('\nPlay accepts only a draft release on an app that has never been published — sending this one as a draft.');
    status = 'draft';
    await setTrack(status);
    await finish(edit.id, ':validate');
  }
  await finish(edit.id, ':commit');

  if (status !== STATUS) {
    console.log(`\n이번 출시는 "${STATUS}"가 아니라 초안(draft)으로 올라갔습니다. 아직 제출되지 않았습니다.`);
    console.log(`Play Console → 테스트 및 출시 → ${TRACK === 'production' ? '프로덕션' : TRACK} → 초안 출시 → 수정 → 검토 및 출시`);
    console.log('첫 출시만 이 클릭이 필요하고, 이후로는 이 스크립트가 바로 제출합니다.');
  }
  if (notSentForReview) {
    console.log('\n변경사항은 저장됐지만 아직 심사에 제출되지 않았습니다.');
    console.log('Play Console → 게시 개요 → "검토를 위해 변경사항 보내기"를 누르면 제출됩니다.');
  }
  console.log('\nConsole에서만 하는 선언(내용이 바뀔 때만): 콘텐츠 등급 · 데이터 보안 · 타깃층 · 광고 · 앱 액세스 · 접근성 API · 포그라운드 서비스 (docs/PLAY_RELEASE.md)');
}

/**
 * --submit: release a bundle that is already on Play (by version code) to a track, without rebuilding. Prints every
 * track's current releases first, so the run doubles as a status report.
 */
const SUBMIT = has('submit');
async function submit() {
  const copy = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l, await copyFor(l)])));
  ACCESS = await token();
  const edit = await call('/edits', { method: 'POST', json: {} });
  const { tracks = [] } = await call(`/edits/${edit.id}/tracks`);
  for (const t of tracks) for (const r of t.releases ?? []) console.log(`now: ${t.track} · ${r.status} · ${r.name ?? ''} · versionCodes ${(r.versionCodes ?? []).join(',')}`);
  const { bundles = [] } = await call(`/edits/${edit.id}/bundles`);
  const codes = bundles.map((b) => Number(b.versionCode));
  const code = Number(VERSION_CODE ?? Math.max(0, ...codes));
  if (!codes.includes(code)) throw new Error(`versionCode ${code} is not on Play (have: ${codes.join(', ') || 'none'})`);
  await call(`/edits/${edit.id}/tracks/${TRACK}`, {
    method: 'PUT',
    json: {
      track: TRACK,
      releases: [{
        name: process.env.RELEASE_NAME || String(code),
        versionCodes: [String(code)],
        status: STATUS,
        ...(STATUS === 'inProgress' ? { userFraction: Number(process.env.PLAY_USER_FRACTION ?? 0.2) } : {}),
        releaseNotes: LOCALES.filter((l) => copy[l].releaseNotes).map((l) => ({ language: l, text: copy[l].releaseNotes })),
      }],
    },
  });
  console.log(`track ${TRACK}: versionCode ${code} → ${STATUS}`);
  try {
    await finish(edit.id, ':validate');
  } catch (err) {
    await call(`/edits/${edit.id}`, { method: 'DELETE' }).catch(() => {});
    if (/draft app/i.test(String(err.message))) {
      throw new Error(`Play still treats ${PACKAGE} as a never-published (draft) app, so only a person can start the first review:\n` +
        `Play Console → 게시 개요(Publishing overview) → "검토를 위해 변경사항 보내기" (또는 프로덕션 → 초안 출시 → 검토 및 출시).`);
    }
    throw err;
  }
  await finish(edit.id, ':commit');
  console.log(notSentForReview ? '\n저장됨 — Console 게시 개요에서 "검토를 위해 변경사항 보내기"를 눌러야 심사가 시작됩니다.' : `\n제출 완료: ${TRACK} ${STATUS} (versionCode ${code}) — Google 심사 대기`);
}

/**
 * --listing-only: the 12 listings (+ promo video links) and, unless --no-images, every image — no bundle, no track
 * change. For store-page (ASO) updates between releases; Play reviews the listing change on its own.
 */
const LISTING_ONLY = has('listing-only');
async function listingOnly() {
  const copy = Object.fromEntries(await Promise.all(LOCALES.map(async (l) => [l, await copyFor(l)])));
  console.log(`copy ok: ${LOCALES.map((l) => `${l} "${copy[l].title}"`).join(' · ')}`);
  if (IMAGES) await checkGraphics();
  if (DRY) return console.log('--dry-run: nothing sent.');
  ACCESS = await token();
  const edit = await call('/edits', { method: 'POST', json: {} });
  console.log(`edit ${edit.id} (listing only)`);
  await putListings(edit.id, copy);
  if (IMAGES) await putImages(edit.id);
  await finish(edit.id, ':validate');
  await finish(edit.id, ':commit');
  console.log(notSentForReview ? '\n저장됨 — Console 게시 개요에서 "검토를 위해 변경사항 보내기"를 눌러야 심사가 시작됩니다.' : '\n등록정보 변경 제출 완료 — Google 심사 후 스토어에 반영됩니다.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (LISTING_ONLY) {
    if (!PACKAGE) { console.error('usage: --package <id> --listing-only [--no-images] [--dry-run]'); process.exit(2); }
    listingOnly().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
  } else if (SUBMIT) {
    if (!PACKAGE) { console.error('usage: --package <id> --submit [--version-code N] [--track production] [--status completed]'); process.exit(2); }
    submit().catch((err) => { console.error(String(err?.message ?? err)); process.exit(1); });
  } else if (!PACKAGE || (!AAB && !CHECK && !DRY)) {
    console.error('usage: --package <id> (--aab <file> [--track internal] [--status completed] | --check [--version-code N]) [--no-images] [--dry-run]');
    process.exit(2);
  } else {
    (CHECK ? check() : publish()).catch((err) => {
      console.error(String(err?.message ?? err));
      process.exit(1);
    });
  }
}
