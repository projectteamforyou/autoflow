# AutoFlow — 인수인계 (새 채팅에서 이어서 작업용)

갱신: 2026-10-19 (UTC) · 저장소 `work517/autoflow` · 작업 브랜치 `claude/charming-bell-7loc6o` · PR work517/autoflow#1

## 1. 한눈에 보기
| 항목 | 값 |
|---|---|
| 사이트 | https://autoflowmacro.com (12개 언어, 146페이지) |
| 웹 앱(PWA) | https://autoflowmacro.com/app/ |
| API | https://api.autoflowmacro.com (Railway, Hono + PostgreSQL) |
| 다운로드 | https://dl.autoflowmacro.com (Cloudflare R2 버킷 `autoflow-releases`) |
| 프런트 배포 | Cloudflare Pages 프로젝트 `autoflow` |
| 사업자 | 프로젝트팀포유 · 대표 이유상 · 495-25-02209 · 제2026-경북봉화-0037호 · projectteamforyou@gmail.com |

## 2. 구조
```
packages/core   공용 엔진(TypeScript): Flow 스키마, 안전한 식 언어, 실행 엔진, Safety Score, AI 제공자 카탈로그, 요금 정책(plans), 홍보 문구(promo)
packages/brand  로고·색
apps/web        React PWA (VITE_BASE=/app/ 로 사이트용 빌드, "./" 로 네이티브 셸용)
apps/site       정적 사이트 생성기 (content/<lang>.ts, content/legal/*.ts)
apps/api        Hono API (migrations/*.sql, test/*.test.ts)
apps/desktop    Tauri 2 (Windows) — crates/engine(Rust) 사용
apps/android    Capacitor 8 + Kotlin 엔진(AccessibilityService)
scripts/        release/publish-r2.mjs, windows/*.ps1, play/, store/
```

## 3. 배포 명령
```bash
pnpm install
pnpm --filter @autoflow/core build
VITE_BASE=/app/ pnpm --filter @autoflow/web build
SKIP_OG=1 pnpm --filter @autoflow/site build && pnpm --filter @autoflow/site verify
rm -rf apps/site/dist/app && cp -r apps/web/dist apps/site/dist/app
cd apps/site/dist && npx -y wrangler@3 pages deploy . --project-name autoflow --branch main --commit-dirty=true
```
- API(Railway): push 후 Railway MCP `connect-service-source` 재실행으로 배포 트리거.
- 릴리스: `git tag vX.Y.Z && git push origin vX.Y.Z` → windows.yml(서명 exe/msi) + android.yml(서명 APK/AAB) → GitHub Release
  → `node scripts/release/publish-r2.mjs vX.Y.Z` 로 R2(dl.autoflowmacro.com) 미러. 서명 안 된 Windows 빌드는 고정 URL에 올리지 않음.

## 4. 서명/스토어 (사용자 쪽 준비물)
- Azure Artifact Signing: 계정 `ultarineosigning`. Downloads 폴더에서
  `powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-azure-signing.ps1` → GitHub Secrets/Variables 자동 등록.
- Android: `scripts/windows/android-keystore.ps1` → `set-android-secrets.ps1` (ANDROID_KEYSTORE_BASE64 등), Play: PLAY_SERVICE_ACCOUNT_JSON.
- 결제: 관리자(projectteamforyou@gmail.com 로그인) → 앱 Admin 화면에서 PortOne(KCP)·PayPal 키 입력 → 즉시 동작. 웹훅 없음, 새 창 없음(PC iframe / 모바일 같은 탭 리디렉션).

## 5. 정책
- 개인 사용 무료. 개인 외(사업자) 사용은 2026-10-25(KST)까지 무료, 이후 Business 플랜.
- 동기화: 출시 기간 ₩0, 업로드 전 기기 암호화, 충돌 시 두 버전 보존, 계정·데이터 언제든 삭제. 유료 전환 시 사전 고지, 데이터 볼모 없음.
- 회사는 손해를 배상하지 않음(§14), 관할: 서울중앙지방법원.

## 6. 디자인/문구 규칙
- PC에서 지정 문장 1줄(`nowrap-pc`, ko/en/ja/zh만), 줄바꿈은 `\n` → `<br class="br-pc">`.
- 고아 방지: 사이트는 빌드 시 마지막 두 단어 &nbsp; 결합 + text-wrap pretty/balance, 앱은 CSS.
- 모든 페이지 하단·앱 사이드바·홈에 프로젝트팀포유 홍보 띠(https://projectteamforyou.com).

## 7. 검증 명령
```bash
pnpm --filter @autoflow/core test && pnpm --filter @autoflow/api test
pnpm --filter @autoflow/web build && node apps/web/scripts/smoke.mjs
(cd crates/engine && cargo test)
(cd apps/android/android && ./gradlew :engine:test)   # ANDROID_HOME=/root/android-sdk
```
