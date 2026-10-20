# AutoFlow — 인수인계 (새 채팅에서 이어서 작업용)

갱신: 2026-10-20 20:00 KST · 저장소 `projectteamforyou/autoflow`(구 `work517/autoflow`) · 기본 브랜치 `main` · 작업 브랜치 `claude/charming-bell-7loc6o` · 마지막 PR projectteamforyou/autoflow#19

## 1. 현재 배포 상태 (Windows 1.1.2 · Android 1.1.1)
| 항목 | 값 |
|---|---|
| 사이트 (12개 언어, 710페이지 — 가이드 24·대체 프로그램 21 × 12개 언어 포함) | https://autoflowmacro.com |
| 웹 앱 (PWA) | https://autoflowmacro.com/app/ |
| 관리자 | https://autoflowmacro.com/app/#/admin (projectteamforyou@gmail.com + 설정 코드) |
| API | https://api.autoflowmacro.com (Railway `autoflow`/`api`, PostgreSQL) |
| Windows 1.1.2 (Azure 서명: PROJECTTEAMFORYOU, 회사 PC 러너 `runner_label: OFFICE`; 1.1.0·1.1.1은 freezePrototype 때문에 빈 화면 → 1.1.2에서 수정) | https://dl.autoflowmacro.com/windows/AutoFlow-Setup-x64.exe · `AutoFlow-x64.msi` · `AutoFlow-portable-x64.exe` |
| Android 1.1.1 (업로드 키 SHA-256 1fe265ee…) | https://dl.autoflowmacro.com/android/AutoFlow.apk |
| 버전 정보 | https://dl.autoflowmacro.com/latest.json |
| GitHub 릴리스 (보관용) | https://github.com/projectteamforyou/autoflow/releases/tag/v1.1.2 |
| Google Play | `com.projectteamforyou.autoflow` — 1.1.0(versionCode 6) 프로덕션 177개국 **검토 중**(관리형 게시 꺼짐 → 승인 즉시 공개). 승인 후 `android.yml` track=production 으로 1.1.1 올리기 |
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

## 6. SEO·검색엔진
- 등록: Google Search Console, 네이버 서치어드바이저(메타 태그), Bing(`/BingSiteAuth.xml`), 다음. 사이트맵 `https://autoflowmacro.com/sitemap.xml`
- IndexNow: 키 파일 `apps/site/public/<key>.txt`, 배포 후 `NODE_USE_ENV_PROXY=1 node scripts/seo/indexnow.mjs`(전체) 또는 경로 지정
- 프로그래매틱 SEO: `apps/site/content/seo/<lang>.ts`(가이드 24·대체 21), 렌더러 `src/seo-pages.ts`. `pnpm --filter @autoflow/site verify` 로 제목·설명 길이/중복 검사

## 7. 2026-10-20 A–Z 점검에서 고친 것 (PR #8)
- 결제: PortOne 채널 키 불일치(테스트 채널) 거부·환불, PayPal 금액 불일치 환불, 대기 주문 '다시 확인', 결제 복귀 시 로그인 카드
- 엔진(TS·Rust·Kotlin 동기화): 대기 없는 루프에서도 정지, 표현식 비용 제한, range() 2^53 초과 거부, Safety Score(동적 URL·헤더 변수·내부망·파일 append/copy 확인)
- Windows: 눌린 키 해제·Halt 수식키 무시, 글라이드/이미지 검색 중단, Keyforge 반복 정지, UNC 경로·HTTP 리디렉션 차단, 클립보드 경계, 비상정지 키 검증
- 웹: Canvas 실시간 로그, 업데이트 알림 유지(12개 언어), 세션 토큰은 발급한 API 주소로만

## 7-1. 랜딩·다운로드 (PR #19)
- `/`(영어 x-default)는 저장된 언어(`af-lang`) → 브라우저 언어 순으로 `/<lang>/`에 바로 이동(인라인 스크립트, CSP 해시는 `build.ts`). 언어 선택기에 언어 이름 표시
- 히어로: 슬로건(`home.slogan`)과 마우스+키보드 칩(`home.inputs`) 12개 언어
- 줄바꿈: 짧은 블록은 `text-wrap: balance`(법률 문서 `.prose`만 pretty). 검사 `node apps/site/scripts/check-short-lines.cjs http://localhost:PORT` → 0건 유지
- 다운로드 리다이렉트 `/v1/stats/download/windows` → `…Setup-x64.exe?v=<latest.json 버전>`(브라우저 캐시의 옛 설치 파일 방지). 릴리스 후 `latest.json`만 갱신하면 됨

## 8. 러너 메모
- 회사 PC 러너(FELIXLEE*)는 **LocalSystem** 계정(WiX MSI ICE 검사에 필요). Rust는 `CARGO_HOME=C:\Rust\cargo`
- 집 PC 러너는 C 드라이브가 가득 참 → 정리 전까지 Windows 릴리스는 `runner_label: OFFICE`
- PowerShell 7 없음 → 워크플로는 `shell: powershell`, 출력 파일은 `[IO.File]::AppendAllText`

## 9. 남은 작업 후보 (다음 채팅)
- Android Scenes/픽셀(MediaProjection) 지원
- 실결제 1건(₩9,900) 후 PortOne 콘솔에서 취소로 끝까지 검증
- Play 1.1.0 승인 후 1.1.1 프로덕션 업로드
- 집 PC 러너 디스크 정리, Google 서비스 계정 키 교체
