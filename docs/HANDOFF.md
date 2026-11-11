# AutoFlow — 인수인계 (새 채팅에서 이어서 작업용)

갱신: 2026-11-11 10:40 KST · 저장소 `projectteamforyou/autoflow`(구 `work517/autoflow`) · 기본 브랜치 `main` · 작업 브랜치 `claude/charming-bell-7loc6o` · 마지막 PR projectteamforyou/autoflow#28

## 1. 현재 배포 상태 (Windows 1.1.2 · Android 1.1.3)
| 항목 | 값 |
|---|---|
| 사이트 (12개 언어, 710페이지 — 가이드 24·대체 프로그램 21 × 12개 언어 포함) | https://autoflowmacro.com |
| 웹 앱 (PWA) | https://autoflowmacro.com/app/ |
| 관리자 | https://autoflowmacro.com/app/#/admin (projectteamforyou@gmail.com + 설정 코드) |
| API | https://api.autoflowmacro.com (Railway `autoflow`/`api`, PostgreSQL) |
| Windows 1.1.2 (Azure 서명: PROJECTTEAMFORYOU, 회사 PC 러너 `runner_label: OFFICE`; 1.1.0·1.1.1은 freezePrototype 때문에 빈 화면 → 1.1.2에서 수정) | https://dl.autoflowmacro.com/windows/AutoFlow-Setup-x64.exe · `AutoFlow-x64.msi` · `AutoFlow-portable-x64.exe` |
| Android 1.1.3 (업로드 키 SHA-256 1fe265ee…; Play에는 1.1.2가 검토 중, 1.1.3은 아직 Play 미업로드) | https://dl.autoflowmacro.com/android/AutoFlow.apk |
| 버전 정보 | https://dl.autoflowmacro.com/latest.json |
| GitHub 릴리스 (보관용) | https://github.com/projectteamforyou/autoflow/releases/tag/v1.1.2 |
| Google Play 계정 (2026-11-09 이전됨) | 구 조직 계정 4800355049082027013(projectteamforyou@gmail.com) → **개인 계정 PROJECTTEAM FOR YOU, ID 5661763859416322517, 소유자 projectteamforyoudevelop@gmail.com**. 결제 프로필: 판매자 ID 442894745571811440 / 4307-3816-1623(이유상). 패키지명·App Signing·업로드 키 동일, 코드 변경 없음(7-7 참고) |
| Google Play | `com.projectteamforyou.autoflow` — 1.1.0이 **접근성 명시적 공개 누락으로 거부**(2026-10-20) → 1.1.2(versionCode 12)에 네이티브 공개 대화상자 추가, 프로덕션 트랙에 **저장만 됨**(거부 이후엔 API 자동 제출 불가). Console에서 접근성 API 선언 영상 링크 교체 + "검토를 위해 변경사항 보내기" 필요 |
| 접근성 시연 영상 (네이티브 공개 포함) | https://dl.autoflowmacro.com/play/autoflow-accessibility-demo-en.mp4 · `-ko.mp4` |
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
- Railway: SETTINGS_ENCRYPTION_KEY, ADMIN_EMAILS, ADMIN_SETUP_CODE, DATABASE_URL 등. RESEND_API_KEY·MAIL_FROM(2026-11-11 11:10 KST 등록, 발송 확인 — 7-6)
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

## 7-2. Play 접근성 정책·다운로드 선택 (PR #21–#24, 2026-10-24)
- `a11y/AccessibilityDisclosure.kt`: 닫을 수 없는 네이티브 공개 대화상자(12개 언어). 첫 실행 + 접근성 설정을 여는 모든 경로(`permission_request`, `open_settings`) 앞에서 표시. 접근하는 데이터(화면 동작·화면 내용·하드웨어 키·녹화 중 입력)·목적·기기 내 처리·미수집/미공유 명시, 동의/동의 안 함
- 시연 영상: `play-demo-video.yml`(languages en,ko) → R2 `play/autoflow-accessibility-demo-<lang>.mp4`
- `scripts/play/publish.mjs`: 거부 이후 `:validate`를 건너뛰고 `:commit?changesNotSentForReview=true` 로 저장 → Console에서 심사 제출
- 다운로드 선택 레이어: 사이트 모든 다운로드 버튼(`/v1/stats/download/*`, client.js의 `#dl-choice`)과 웹 앱(TrialBanner `DownloadButton`) → 개인용 무료 / 업무용은 `/app/#/business`(결제 후 라이선스 키·다운로드) / 라이선스 보유 시 다운로드
- 비공개 GitHub releases 링크는 사이트에서 제거

## 7-3. A–Z 재검수·편의 패치 (PR #26, 2026-11-01)
- 검수 방식: 사이트·웹 앱·API·엔진 4영역을 병렬로 읽고 85건 도출 → 가치 순으로 패치. 기준선: typecheck 통과, core 93·API 104·Rust 82 테스트 통과
- API: 미정산 주문 매시간 자동 대조(`reconcilePendingOrders`), 대기 주문 취소 `POST /v1/billing/orders/:id/cancel`·72h 만료·5건 제한, 로그인 잠금은 실패 시에만 소모(`peek`), sync `since` 오버플로 400, 통계 캐시 실제 동작 + `windowsVersion`(stale-while-revalidate, HEAD 미집계), 마이그레이션 `005_indexes.sql`. 테스트 111
- 웹 앱: 에디터·Keyforge 자동저장 언마운트 플러시(편집 유실 방지), 백업 복원이 Keyforge 프로필 포함 + 설정의 "백업 복원", 단계/플로우 삭제 Undo, Ctrl+Enter 실행, 팔레트 New flow/Run, 라이브러리 정렬·이름 바꾸기·카드 액션, 모바일 인스펙터/36px 터치/"더보기" 시트, API URL 검증, 빈 오류 토스트 수정. 번역 키 1351 × 12
- 엔진(3개 동일): 중첩 리스트 노드 예산(depth 64), Android Stop이 제스처 취소, confirm/pick 종료 시 완료, 공개 대화상자 요청 큐잉, Windows 패닉→failed/internal, 트리거 동기화 시 스케줄 상태 유지, OCR 중단 가능·캡처 16Mpx 제한, 정규식 미지원 기능 메시지 통일
- 사이트: `/<lang>/changelog/`(content/changelog.ts, 영어 단일 소스) 신설, Android CTA "APK", Windows 설치 3단계+SmartScreen, Android 요구사항, FAQ 3개, 다운로드 카드 최신 버전(`/v1/stats.windowsVersion`), 폰 헤더 다운로드 아이콘, 404 언어 링크, 인쇄 CSS, JSON-LD offers 2개(verify 스크립트도 갱신). 검사: `pnpm --filter @autoflow/site verify` 722페이지
- 새 페이지 추가 시: `PAGES`(config.ts)·모든 locale의 `nav.<id>`·`RENDER`·OG 이미지(SKIP_OG 없이 1회 빌드) 필요

## 7-4. 오류 로그·미구현 점검 (PR #28, 2026-11-03)
- 운영 API(Railway) 7일: 5xx 0건 / 19,084 요청. 4xx는 WordPress 스캐너 봇의 404(/wp/, /blog/ …)뿐. 마이그레이션 005·주문 정산 하우스키핑 정상 동작 확인
- CI 실패 3건 수정: `ubuntu-latest`→26.04로 Playwright/Chromium 설치 불가(주간 스모크·Site·스크린샷) → 모든 Linux 잡 `ubuntu-24.04` 고정; `cargo fmt` 차이; 회사 러너 디스크 부족 → Windows 잡에 디스크 가드(12 GB 미만이면 다른 작업 폴더 `target` 정리, 6 GB 미만 실패) + `CARGO_HOME` 미설정 PC는 `C:\Rust\cargo` 자동 감지 + rustup 없으면 curl.exe로 설치(PowerShell 5에서는 네이티브 stderr를 파이프하지 말 것)
- **GitHub 저장소에 `CLOUDFLARE_API_TOKEN` 시크릿이 없어 Site 워크플로의 배포 단계는 항상 skip** → 사이트 배포는 수동(`wrangler pages deploy`). 시크릿을 넣으면 main push마다 자동 배포됨
- **Android 화면 캡처 구현**(그동안 "Android에서는 사용 불가"였던 기능): `system/ScreenCapture.kt`(MediaProjection, 앱 시작마다 1회 동의) + `CaptureService`(FGS mediaProjection) → 픽셀 검사·waitForPixel·장면 해시·scene_capture·findImage/이미지 타깃(`run/ImageMatch.kt`, Rust NCC 포팅)·OCR(`run/TextRecognition.kt`, ML Kit v2 unbundled: Latin/ko/ja/zh). 권한 `screenCapture` 추가. 기능 매트릭스(TS·Rust·Kotlin) 화면 프로브 = Android "limited". 템플릿 idle-collect·stage-ready-clicker가 Android 대상에 포함
  - 참조 이미지는 `Android/data/com.projectteamforyou.autoflow/files/AutoFlow/images/<ref>.png` (앱 내 가져오기 UI는 아직 없음)
  - 미구현으로 남긴 것: Android 위치 트리거(권한 정책상 보류), Keyforge 출력/텍스트 확장(Android), OCR 언어 옵션(기기 로케일로 선택)
- Android 1.1.3 빌드 → GitHub Release v1.1.3 + R2 `android/AutoFlow.apk`(latest.json 갱신). Play 업로드는 1.1.2 심사 결과 확인 후 `android.yml` track=production version=1.1.3

## 7-5. Play 1.1.3 업로드 (PR #32, 2026-11-03)
- Play 1.1.2 승인됨(2026-10-24 제출 2 → 출시됨). 사이트·웹 앱에 Google Play 링크/배지(PR #30)
- 1.1.3은 `FOREGROUND_SERVICE_MEDIA_PROJECTION`이 새로 들어가 Play가 **Console의 "포그라운드 서비스 권한 → 미디어 프로젝션" 선언** 없이는 출시 배정을 거부(`403 You must let us know whether your app uses any Foreground Service permissions`). 그 선언 섹션은 **해당 권한이 든 번들이 Play에 올라간 뒤에만** 나타남
- 그래서 새 워크플로 **`play-upload.yml`**(수동, 재빌드 없음, 1분): `mode=upload`는 Android build 아티팩트의 서명 AAB를 트랙 없이 Play에 올림(`publish.mjs --upload-only`), `mode=submit`은 이미 올라간 versionCode를 트랙에 배정(`--submit`). 2026-11-03 18:21 versionCode 17 업로드 완료(run 41610291128)
- 선언은 2026-11-03 19:03 사용자가 Console에서 작성·검토 전송(제출 3, "검토 중"). **이 심사가 끝나야** `play-upload.yml` → `mode=submit, version_code=17, track=production, release_name="1.1.3 (17)"`가 통과함(심사 중에는 같은 403). 출시 노트 12개 언어는 `store/whatsnew/`에 1.1.3으로 갱신됨
- 다음 Android 릴리스부터 순서: `android.yml`(track=none) → 새 권한이 생겼으면 `play-upload.yml upload` → Console 선언 → `play-upload.yml submit`; 권한 변화가 없으면 `android.yml track=production`으로 한 번에
- **2026-11-06 보완(PR #34)**: 매시간 submit 재시도가 hosted 러너에서 64회 ≈ 80분을 써서(월 환산 ~720분 = 조직 2,000분의 36%) `play-upload.yml`을 **self-hosted Windows 러너 기본**(`runner` 입력: `self-hosted`|`hosted`)으로 옮김. 모든 `run:`이 `node …` 한 줄이라 PowerShell 5/bash 공통. 러너 PC가 전부 꺼져 있으면 잡은 대기(분 소모 없음, `concurrency`가 다음 dispatch 때 이전 대기 잡을 취소). `publish.mjs`: 선언 미작성/검토 중 403은 **exit 3**(`::notice` + 잡 요약 기록, 오류 두 번 출력 제거), `--aab-dir <폴더>`로 아티팩트 안의 .aab를 스스로 찾음
- **PR #35**: 첫 self-hosted 실행이 1초 만에 "성공"으로 끝났는데 출력이 없었음 → `publish.mjs`의 메인 모듈 판별 `import.meta.url === \`file://${process.argv[1]}\``가 Windows 경로(`D:\…`)와 절대 일치하지 않아 CLI가 아무것도 안 하고 exit 0. `pathToFileURL(resolve(argv[1])).href === import.meta.url`로 고침. 이후 run 42149461318(부산집 러너)에서 스크립트가 정상 실행되어 같은 403 + notice 확인
- 2026-11-03 19:41 KST부터 매시간 자동 submit 재시도 중(Claude 예약 작업 `Play 1.1.3 production submit (hourly until approved)`): 2026-11-10 21:18 KST까지 전부 같은 403 → Google의 제출 3 심사가 아직 열려 있음. 통과 시 예약 작업이 스스로 꺼지고 이 절에 제출 시각이 추가됨
- 2026-11-09 15:19 ~ 11-10 12:14 KST 사이에는 다른 403 `The caller does not have permission`(POST /edits 자체가 거부)이 났음 = 서비스 계정이 Console 앱 권한을 잃은 상태. 11-10 13:13 KST 재시도부터 다시 선언 대기 403으로 돌아옴(Console에서 권한이 복구된 것으로 보임). 구분법: 선언 대기는 `:validate`/`commit`에서만 403, 권한 상실은 첫 `POST /edits`부터 403

## 7-7. Play 개발자 계정 이전 점검 (2026-11-11)
사용자 안내: 2026-11-09 앱이 조직 계정 → 개인 계정(ID 5661763859416322517)으로 이전됨. 7-5의 2026-11-09 15:19~11-10 12:14 KST `The caller does not have permission` 403이 바로 이 이전 구간(서비스 계정이 새 Console에 초대되기 전)이고, 11-10 13:13 KST부터 서비스 계정이 새 계정의 앱을 다시 읽음(`now: production · completed · 1.1.2 (12)`).
점검 결과(이 저장소 기준):
1. **Play Developer API 서비스 계정** — 새 Console에 이미 초대·반영됨(매시간 submit 재시도가 인증·조회 통과). 다음 403이 `:validate`에서만 나므로 권한은 정상. 할 일: 새 Console → 사용자 및 권한에서 `zumple-play-publisher@origma-509009.iam.gserviceaccount.com`에 "프로덕션으로 출시·테스트 트랙 출시·앱 버전 관리·스토어 등록정보 관리"가 다 있는지 한 번만 확인. 서버 영수증 검증은 없음(결제는 PortOne) → 해당 없음
2. **RTDN Pub/Sub** — 앱에 Google Play Billing 없음(`BillingClient` 미사용, 결제는 PortOne 웹) → 해당 없음
3. **AdMob/app-ads.txt** — 광고 SDK·광고 ID 없음(Manifest 주석 "No ads") → 해당 없음
4. **Firebase·GCP·Play Integrity** — 미사용(ML Kit는 Play services 번들, 계정 무관) → 해당 없음. 서비스 계정의 GCP 프로젝트(origma-509009)는 Play 계정과 연결 불필요(초대만으로 동작)
5. **스토어 등록정보 연락처** — `store/listing/*.json`에는 제목·설명만 있고 개발자 이름·이메일·웹사이트·개인정보처리방침 URL은 Console 계정 설정값 → 새 Console에서 확인 필요: 개발자 이름 `PROJECTTEAM FOR YOU`(기존 표기와 동일하게), 이메일 projectteamforyou@gmail.com, 웹사이트 https://autoflowmacro.com, 개인정보처리방침 https://autoflowmacro.com/ko/privacy/ (앱 콘텐츠 → 개인정보처리방침)
6. **앱 내 표기** — 웹/앱의 사업자 정보(`apps/web/src/pages/Settings.tsx` BusinessInfo)는 전자상거래법상 판매자(프로젝트팀포유, 495-25-02209) 표기로 Play 계정과 무관, 이메일도 projectteamforyou@gmail.com 유지 → 수정 없음. 사이트 저작권 "Projectteamforyou"·Windows 서명 "PROJECTTEAMFORYOU"도 그대로
7. **테스터 목록** — `android.yml`의 태그 push가 internal 트랙에 올리므로 internal 테스터 이메일 목록(이전 시 소실)을 새 Console → 테스트 → 내부 테스트에서 재등록(또는 공개 링크 재생성). alpha/beta 미사용
**주의 2건**: (a) 1.1.3의 포그라운드 서비스 선언(제출 3)은 **구 계정에서 11-03에 전송**했으므로 새 계정에는 "검토 중" 상태가 이어지지 않았을 수 있음 → 새 Console → 앱 콘텐츠 → 포그라운드 서비스 권한(미디어 프로젝션)이 비어 있으면 다시 작성 후 게시 개요에서 "검토를 위해 변경사항 전송". 이게 1.1.3 submit 403이 7일 넘게 이어지는 가장 유력한 원인. (b) 2023-11 이후 만든 **개인 계정은 프로덕션 액세스 권한(비공개 테스트 12명·14일)** 조건이 있음 — 이전된 앱은 이미 프로덕션 출시 상태라 보통 면제되지만, 새 Console 대시보드에 "프로덕션 액세스 권한 신청" 작업이 보이면 그것부터 처리해야 1.1.3 제출이 통과함

## 7-6. 운영 로그 점검 (2026-11-10)
- Railway `api`(배포 afcd6d1f, 2026-11-03 커밋 6baf27d) 120시간: 60,158 요청, **5xx 0건**, 4xx 701건. 4xx는 전부 (a) WordPress/.env/.git 스캐너 봇의 404(11-06 15시 UTC 한 시간에 194건 몰림, 전역 rate limit이 처리), (b) 크롤러의 `/robots.txt` 404(32건, 가장 잦은 단일 경로), (c) `POST /v1/stats/hit` 400 2건(4일간, 무시). 앱 로그 error 0건, warn은 `mail.disabled`·`mail.not_configured`뿐
- **메일 미설정**: Railway에 `RESEND_API_KEY`가 없어 `DisabledMailer`로 동작. 2026-11-04 07:22 KST 실제 가입 1건(auth.signup)의 인증 메일이 **버려짐**(`mail.not_configured tag=verify_email`). 비밀번호 찾기도 같은 상태로 조용히 아무것도 안 보냄. 할 일: Resend에서 `autoflowmacro.com` 도메인 인증 → Railway 변수 `RESEND_API_KEY`, `MAIL_FROM=AutoFlow <no-reply@autoflowmacro.com>` 등록 → 재배포. 그 전까지 관리자는 `ADMIN_SETUP_CODE`로 인증(web Admin 페이지), 일반 사용자는 Atlas 게시 불가(`ATLAS_REQUIRE_VERIFIED_EMAIL`)
- **2026-11-11 11:10 KST 해결**: 사용자가 Resend 도메인 인증 후 Railway에 `RESEND_API_KEY`·`MAIL_FROM` 등록 → 재배포(c9eec8bc)에서 `mail.disabled` 경고 사라짐, 비밀번호 재설정 메일 테스트 `mail.sent` 확인. 11-04 가입자는 앱 설정의 "인증 메일 다시 보내기"로 인증 가능
- 패치: API `GET /robots.txt` → `Disallow: /`(200, 하루 캐시; 크롤러 404 반복 제거). `MAIL_FROM` 기본값을 `no-reply@autoflow.app`(남의 도메인)에서 `no-reply@autoflowmacro.com`으로 교정 — 키만 넣고 MAIL_FROM을 빠뜨려도 Resend가 거부하지 않도록
- GitHub Actions: 11-03 이후 실패는 `Play upload` 시간별 재시도(선언 대기 403, 의도된 실패)와 `Android build` run 17(같은 403, 2026-11-03 production 트랙 시도)뿐. CI(주간 스모크 포함)·API·rust·Site 모두 성공. 사이트·API·`dl.autoflowmacro.com/latest.json`(1.1.2) 응답 정상

## 8. 러너 메모
- 회사 PC 러너(FELIXLEE*)는 **LocalSystem** 계정(WiX MSI ICE 검사에 필요). Rust는 `CARGO_HOME=C:\Rust\cargo`
- 집 PC 러너는 C 드라이브가 가득 참 → 정리 전까지 Windows 릴리스는 `runner_label: OFFICE`
- PowerShell 7 없음 → 워크플로는 `shell: powershell`, 출력 파일은 `[IO.File]::AppendAllText`

## 9. 남은 작업 후보 (다음 채팅)
- Android Scenes/픽셀(MediaProjection) 지원
- 실결제 1건(₩9,900) 후 PortOne 콘솔에서 취소로 끝까지 검증
- Play 선언 심사 완료 후 `play-upload.yml submit` (versionCode 17 → production)
- GitHub 시크릿 `CLOUDFLARE_API_TOKEN` 등록(사이트 자동 배포)
- 집 PC 러너 디스크 정리, Google 서비스 계정 키 교체
