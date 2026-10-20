# AutoFlow — 인수인계 (새 채팅에서 이어서 작업용)

갱신: 2026-10-19 20:20 KST · 저장소 `work517/autoflow` · 작업 브랜치 `claude/charming-bell-7loc6o` · PR work517/autoflow#1

## 1. 현재 배포 상태 (1.1.0)
| 항목 | 값 |
|---|---|
| 사이트 (12개 언어, 146페이지) | https://autoflowmacro.com |
| 웹 앱 (PWA) | https://autoflowmacro.com/app/ |
| 관리자 | https://autoflowmacro.com/app/#/admin (projectteamforyou@gmail.com + 설정 코드) |
| API | https://api.autoflowmacro.com (Railway `autoflow`/`api`, PostgreSQL) |
| Windows 1.1.0 (Azure 서명: PROJECTTEAMFORYOU) | https://dl.autoflowmacro.com/windows/AutoFlow-Setup-x64.exe · `AutoFlow-x64.msi` · `AutoFlow-portable-x64.exe` |
| Android 1.1.0 (versionCode 6, 업로드 키 SHA-256 1fe265ee…) | https://dl.autoflowmacro.com/android/AutoFlow.apk |
| 버전 정보 | https://dl.autoflowmacro.com/latest.json |
| GitHub 릴리스 (보관용) | https://github.com/work517/autoflow/releases/tag/v1.1.0 |
| Google Play | `com.projectteamforyou.autoflow` — 프로덕션 초안(versionCode 6) + 12개 언어 등록정보 업로드됨, 제출 대기 |
| 접근성 시연 영상 (실제 에뮬레이터 녹화) | https://github.com/work517/autoflow/releases/tag/play-demo-video |

## 2. 구조
```
packages/core   공용 엔진(TS): 스키마(34개 단계), 식 언어, 실행 엔진 v2(타임아웃·백오프·휴머나이즈·트레이스),
                Safety Score, 멀티 모니터(displays.ts)·Scenes(dHash), 요금 정책(plans), 홍보 문구(promo)
apps/web        React PWA — Stage(멀티 모니터), Admin(결제 키), Billing, 권한 카드(설정 맨 위)
apps/site       정적 사이트 생성기 (content/<lang>.ts, legal/*.ts), 고아 방지 조판(util.ts noOrphans)
apps/api        Hono API — billing(PortOne iframe/redirect, PayPal redirect, 웹훅 없음), admin, stats
apps/desktop    Tauri 2 (Windows) + crates/engine (Rust)
apps/android    Capacitor 8 + Kotlin 엔진 (AccessibilityService)
scripts/        release/publish-r2.mjs, play/publish.mjs, play/demo-video.mjs, windows/*.ps1
```

## 3. 배포·릴리스 방법
- 사이트+앱: `VITE_BASE=/app/ pnpm --filter @autoflow/web build` → `SKIP_OG=1 pnpm --filter @autoflow/site build` →
  `cp -r apps/web/dist apps/site/dist/app` → `cd apps/site/dist && npx -y wrangler@3 pages deploy . --project-name autoflow --branch main --commit-dirty=true`
- API: push 후 Railway MCP `connect-service-source`(repo work517/autoflow, branch 위) 재실행.
- 태그 push 는 프록시가 막음 → **workflow_dispatch** 사용:
  - `windows.yml` inputs `version: X.Y.Z` → 서명·검증 후 GitHub Release vX.Y.Z
  - `android.yml` inputs `version`, `track` (none/internal/production), `status` → 서명 AAB/APK + Play 업로드 + Release
  - `play-demo-video.yml` inputs `languages`, `release_tag`
- R2 업로드: 릴리스 자산을 curl 로 받아 `npx -y wrangler@3 r2 object put autoflow-releases/<key> --file ...` (wrangler 3 은 `--remote` 없음),
  고정 주소(windows/…, android/AutoFlow.apk, latest.json) 갱신 후 zone 캐시 purge.

## 4. 비밀값 위치 (값은 문서에 쓰지 않음)
- GitHub Secrets: AZURE_CLIENT_ID/TENANT_ID/CLIENT_SECRET, ANDROID_KEYSTORE_BASE64/PASSWORD, ANDROID_KEY_ALIAS/PASSWORD, PLAY_SERVICE_ACCOUNT_JSON
- GitHub Variables: AZURE_SIGN_ENDPOINT/ACCOUNT(ultarineosigning)/PROFILE(ultarineo-public)
- Railway: SETTINGS_ENCRYPTION_KEY, ADMIN_EMAILS, ADMIN_SETUP_CODE, DATABASE_URL 등
- Android 업로드 키: 사용자 PC `C:\keys\autoflow\autoflow-release.jks` (백업 필수)

## 5. 정책
- 라이선스 방식: 개인(개인의 비영리) 사용 무료. 그 밖의 모든 사용(업무·상업·단체·영리)은 2026-10-20 00:00(KST)부터 Business 라이선스 필요(₩9,900/월, ₩99,000/년, US$7.99/79.99, 1회 결제·자동 갱신 없음). 상수: `packages/core/src/plans.ts` `BUSINESS_FREE_UNTIL`
- 로컬 기능은 기술적 제한 없음(신의 기반). 유일한 기술적 게이트는 업무용 계정의 동기화 업로드 402 — 결제 수단(PortOne/PayPal)이 설정된 뒤에만 작동
- 결제 수단은 앱 언어로 고정: 한국어 → PortOne(원화), 그 밖의 언어 → PayPal(달러). 설정 화면에 전환 스위치 없음
- 라이선스 키 `AFB-XXXXX-XXXXX-XXXXX-XXXXX`(Crockford base32 + Luhn mod 32 검사 문자, `packages/core/src/license.ts`). DB에는 SHA-256 해시와 끝 4자리만 저장(`migrations/004_license_keys.sql`)
  - 결제 확정 시: 구매자 계정의 Business 기간 연장(기존) + 그 주문의 라이선스 키를 '구매자가 이미 등록함' 상태로 발급해 확정 응답에 한 번만 반환(라이선스 증빙 번호). 결제 1건 = 라이선스 1개
  - 다른 계정용(회사 → 직원 등): 관리자 페이지에서 키 발급(1~50개, 한 번만 표시, 복사/.txt 저장) → 사용자가 설정 › 요금제 및 결제에서 등록(`POST /v1/billing/redeem`, 1회만)
- 동기화: 업로드 전 암호화, 충돌 시 두 버전 보존, 데이터 볼모 없음
- 손해 배상 없음(§14), 관할 서울중앙지방법원

## 6. 남은 작업 후보 (다음 채팅)
- Android Scenes/픽셀(MediaProjection) 지원
- 결제 실키 입력 후 샌드박스 결제 검증
