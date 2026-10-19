# @autoflow/api

AutoFlow 백엔드 API — 계정, 종단 간 암호화(E2E) 동기화, Atlas 커뮤니티 템플릿, 공유 링크, 선택형 Copilot 릴레이.
AutoFlow backend API — accounts, end-to-end encrypted sync, Atlas community templates, share links and an optional Copilot relay.

Hono + `@hono/node-server` on Node 22, PostgreSQL via `postgres` (porsager), zod validation, structured JSON logs.
Deployed on Railway (Dockerfile) with the web app on Cloudflare Pages.

## 한국어 요약

- **인증**: 이메일 + 비밀번호(scrypt N=2^15, r=8, p=1, 사용자별 salt, 상수 시간 비교). 세션은 불투명 토큰(32바이트 난수)이며 서버에는 SHA-256 해시만 저장, 30일 슬라이딩 만료. `Authorization: Bearer` 헤더만 사용(쿠키 없음 → CSRF 표면 없음).
- **동기화**: 클라이언트가 암호화한 `ciphertext + iv + contentHash`만 저장. `If-Match` 리비전으로 낙관적 동시성 제어, 충돌 시 409와 서버 사본 반환, 삭제는 툼스톤. 사용자당 5,000개 / 50 MB, 항목당 2 MB.
- **Atlas**: 게시 시 서버가 `parseFlow → sanitizeForSharing → lintFlow(오류 금지) → analyzeRisk`를 다시 실행하고 위험도·권한 라벨을 저장. 고위험은 검토 대기(`pending_review`), 신고 N건 이상이면 자동 숨김 후 관리자 검토.
- **릴레이**: 허용 목록 호스트(api.openai.com, api.anthropic.com, generativelanguage.googleapis.com, openrouter.ai)로만 전달. 사용자 키는 `X-Provider-Key`로 요청마다 전달되며 저장·로그하지 않음. 임의 base URL 불가(SSRF 차단).
- **GDPR**: `GET /v1/me/export`로 전체 데이터 JSON 내보내기, `DELETE /v1/me`로 계정과 모든 데이터 영구 삭제(FK cascade).
- **배포**: Railway 서비스의 Config-as-code 경로를 `apps/api/railway.json`으로 지정하고 PostgreSQL 플러그인의 `DATABASE_URL`을 연결. 시작 시 마이그레이션 자동 적용(advisory lock).

## Quick start

```bash
pnpm install
pnpm --filter @autoflow/core build
cp apps/api/.env.example apps/api/.env   # set DATABASE_URL
pnpm --filter @autoflow/api dev           # tsx watch, http://localhost:8080
```

Scripts: `dev`, `build` (tsc → `dist/`), `start` (`node dist/index.js`), `migrate`, `test`, `typecheck`.

Migrations in `migrations/*.sql` are applied automatically at startup inside one transaction guarded by
`pg_advisory_xact_lock`, recorded with checksums in `schema_migrations` (editing an applied file is an error).
`pnpm --filter @autoflow/api migrate` applies them without starting the server.

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `PORT` | `8080` | Railway injects it |
| `NODE_ENV` | `development` | `production` hides error details and disables console email |
| `APP_ORIGINS` | `https://autoflow-651.pages.dev,http://localhost:5173,tauri://localhost,http://tauri.localhost,https://localhost` | Strict CORS allowlist (comma list, `*` rejected) |
| `PUBLIC_APP_URL` | `https://autoflow-651.pages.dev` | Base for email and share links |
| `RESEND_API_KEY` | — | Enables email via Resend; otherwise console (dev) / disabled (prod) |
| `MAIL_FROM` | `AutoFlow <no-reply@autoflow.app>` | Sender (must be a verified Resend domain) |
| `TRUST_PROXY_HOPS` | `1` | Trusted proxies for `X-Forwarded-For` (Railway edge = 1) |
| `LOG_LEVEL` | `info` (prod) / `debug` | `silent` in tests |
| `ATLAS_REQUIRE_VERIFIED_EMAIL` | `true` | Publishing requires a verified email |

## Endpoints

All responses are JSON; errors are `{ "error": { "code", "message", "details"? } }`. Full contract: [`openapi.yaml`](./openapi.yaml), also served at `GET /v1/openapi.yaml`.
🔒 = `Authorization: Bearer <token>` required, (🔒) = optional.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | | Liveness + DB ping (503 if DB is down) |
| GET | `/v1/meta` | | Version, schema version, locales, limits |
| GET | `/v1/openapi.yaml` | | OpenAPI 3.1 document |
| POST | `/v1/auth/signup` | | Create account → `{ user, session: { token, expiresAt } }`, sends verification email |
| POST | `/v1/auth/login` | | Sign in |
| POST | `/v1/auth/logout` | 🔒 | Revoke current session |
| POST | `/v1/auth/logout-all` | 🔒 | Revoke all sessions |
| GET | `/v1/auth/sessions` | 🔒 | Active sessions |
| POST | `/v1/auth/verify-email` | | Confirm email with token |
| POST | `/v1/auth/verify-email/resend` | 🔒 | New verification email |
| POST | `/v1/auth/password/forgot` | | Email reset link (always 202) |
| POST | `/v1/auth/password/reset` | | New password with token (revokes all sessions) |
| POST | `/v1/auth/password/change` | 🔒 | Change password (revokes other sessions) |
| GET / PATCH / DELETE | `/v1/me` | 🔒 | Profile / update / delete account (password required) |
| GET | `/v1/me/export` | 🔒 | GDPR export of all data |
| GET | `/v1/sync?since=&limit=` | 🔒 | Change feed after cursor (paged, includes tombstones) |
| GET | `/v1/sync/usage` | 🔒 | Quota usage |
| GET | `/v1/sync/items/:kind/:id` | 🔒 | One item (`kind` = `flow`/`profile`/`settings`) |
| PUT | `/v1/sync/items/:kind/:id` | 🔒 | Create/update; `If-Match: <rev>` (`0` = create); 409 + server copy on conflict |
| DELETE | `/v1/sync/items/:kind/:id` | 🔒 | Tombstone; `If-Match` required |
| GET / POST | `/v1/devices` | 🔒 | List / register (binds current session) |
| PATCH / DELETE | `/v1/devices/:id` | 🔒 | Rename / revoke (signs device out) |
| GET | `/v1/atlas/categories` | | Template categories |
| GET | `/v1/atlas/official` · `/v1/atlas/official/:id` | | Official templates from `@autoflow/core` |
| GET | `/v1/atlas/templates?q&category&platform&sort&page&pageSize` | | Search published templates (`sort` = popular/new/rating) |
| POST | `/v1/atlas/templates` | 🔒 | Publish (verified email; validated, linted, risk-labelled) |
| GET | `/v1/atlas/templates/mine` | 🔒 | My templates, any status |
| GET / DELETE | `/v1/atlas/templates/:id` | (🔒) / 🔒 | Detail / unpublish (author) |
| POST | `/v1/atlas/templates/:id/install` | (🔒) | Count install (once per user) and return flow |
| GET / PUT | `/v1/atlas/templates/:id/rating` | 🔒 | My rating / rate 1–5 |
| POST | `/v1/atlas/templates/:id/reports` | 🔒 | Report (auto-hide after N reports) |
| GET | `/v1/admin/atlas/queue` | 🔒 admin | Moderation queue |
| POST | `/v1/admin/atlas/templates/:id/moderate` | 🔒 admin | `approve` / `remove` |
| POST | `/v1/shares` | (🔒) | Create share link (10-char base62 id, optional expiry) |
| GET | `/v1/shares/mine` | 🔒 | My share links |
| GET / DELETE | `/v1/shares/:id` | — / 🔒 | Open / delete (owner) |
| GET | `/v1/ai/providers` | | Relay allow-list |
| POST | `/v1/ai/relay` | 🔒 | Relay JSON to an allow-listed provider with `X-Provider-Key` |

## Security notes

- Secure headers (`hono/secure-headers`: CSP `default-src 'none'`, HSTS, `X-Frame-Options: DENY`, `no-referrer`), `Cache-Control: no-store` by default.
- Strict CORS allowlist, no credentials mode. Request ids (`X-Request-Id`) on every response.
- Body limits per route (64 KB default, ~2.8 MB sync items, 528 KB flows, 256 KB relay).
- Rate limits: in-memory token buckets (global per IP, auth per IP and per account, publish, shares, relay, installs) behind a `RateLimiter` interface — swap for a shared store before running more than one replica.
- All SQL is parameterized (tagged templates). Logs are JSON with recursive redaction of tokens, passwords, keys and ciphertext.
- Email links carry tokens in the URL fragment (`#token=`), so they are not sent to servers or leaked through `Referer`.
- Production 5xx responses never include error messages or stack traces.

## Tests

Tests run against a **real PostgreSQL**. With `TEST_DATABASE_URL` set (CI uses a `postgres:16` service) that server is used;
otherwise `test/global-setup.ts` creates a throw-away cluster with `initdb` (PostgreSQL 16 binaries, `PG_BIN` to override) on a free port —
as `nobody` via `runuser` when running as root. Each test file clones a migrated template database, so files run in parallel.

```bash
pnpm --filter @autoflow/api test
```

## Docker / Railway

```bash
docker build -f apps/api/Dockerfile -t autoflow-api .   # context = repo root
docker run -e DATABASE_URL=... -p 8080:8080 autoflow-api
```

Railway: create a service from this repo, set **Config-as-code path** to `apps/api/railway.json` (builder `DOCKERFILE`,
healthcheck `/health`, restart on failure), add the PostgreSQL plugin and reference its `DATABASE_URL`, then set
`NODE_ENV=production`, `RESEND_API_KEY` and `MAIL_FROM`.
