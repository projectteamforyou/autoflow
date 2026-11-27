# AutoFlow — 인수인계 (새 채팅에서 이어서 작업용)

갱신: 2026-11-27 13:25 KST · 저장소 `projectteamforyou/autoflow`(구 `work517/autoflow`) · 기본 브랜치 `main` · 작업 브랜치 `claude/charming-bell-7loc6o` · 마지막 PR projectteamforyou/autoflow#48 (7-11, 감사 수정 + 1.2.1 릴리스)

## 1. 현재 배포 상태 (Windows 1.2.1 · Android 1.2.1 · 웹 1.2.1)
| 항목 | 값 |
|---|---|
| 사이트 (12개 언어, 710페이지 — 가이드 24·대체 프로그램 21 × 12개 언어 포함) | https://autoflowmacro.com |
| 웹 앱 (PWA) | https://autoflowmacro.com/app/ |
| 관리자 | https://autoflowmacro.com/app/#/admin (projectteamforyou@gmail.com + 설정 코드) |
| API | https://api.autoflowmacro.com (Railway `autoflow`/`api`, PostgreSQL) |
| Windows 1.2.1 (Azure 서명: PROJECTTEAMFORYOU, 회사 PC 러너 `runner_label: OFFICE`, 2026-11-27) | https://dl.autoflowmacro.com/windows/AutoFlow-Setup-x64.exe · `AutoFlow-x64.msi`(ko-KR) · `AutoFlow-x64-en-US.msi` · `AutoFlow-portable-x64.exe` |
| Android 1.2.1 (업로드 키 SHA-256 1fe265ee…; Play 프로덕션에 2026-11-27 13:12 KST 제출 → Google 심사 대기. 1.2.0은 versionCode 20) | https://dl.autoflowmacro.com/android/AutoFlow.apk |
| 버전 정보 | https://dl.autoflowmacro.com/latest.json |
| GitHub 릴리스 (보관용) | https://github.com/projectteamforyou/autoflow/releases/tag/v1.2.1 |
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
apps/api        Hono API — billing(PortOne 팝업(PC)/redirect(모바일), PayPal redirect, 웹훅 없음), admin, stats
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
- ~~GitHub 저장소에 `CLOUDFLARE_API_TOKEN` 시크릿이 없어 Site 워크플로의 배포 단계는 항상 skip~~ → **2026-11-19 19:30 KST 사용자가 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 시크릿 등록** → 이후 main push(apps/site·apps/web·packages 변경)마다 자동 배포. 수동은 Actions → Site → Run workflow(MCP 연동 계정은 dispatch·rerun 403이라 사람이 눌러야 함). 이 세션 컨테이너에서 `wrangler pages deploy`는 불가: 환경 프록시가 api.cloudflare.com의 Authorization을 저장된 전체 토큰으로 바꿔 넣어 Pages 업로드용 JWT가 거부됨(8000013)
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
- **2026-11-24 16:28 KST 제출 완료**(run 45348187162, hosted 러너 — self-hosted 러너 PC가 꺼져 있어 1분 과금). `validated`→`committed`, production versionCode 17 (1.1.3) → Google 심사 대기. 원인은 7-7 (a)대로 **개인 계정으로 이전되면서 포그라운드 서비스 선언이 비어 있었음**: 사용자가 11-24 Console 앱 콘텍츠에서 SPECIAL_USE(RunService)·MEDIA_PROJECTION(CaptureService) 두 항목을 작성해 검토 전송한 직후 403이 사라짐. 6시간 예약 작업은 비활성화. 다음 Android 릴리스는 7-5 순서대로(권한 변화 없으면 `android.yml track=production` 한 번에)
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
- **2026-11-15 13:40 KST 재점검(PR #40)**: Railway `api`(c9eec8bc) 48시간 17,533 요청, **5xx 0건**, 4xx 4건(`/.git/HEAD`·`/.git/config` 스캐너 404 등, 모두 0ms), 300ms 넘는 요청 0건, 앱 로그 warn/error 0건. 접근 로그의 96 %가 앱의 1분 하트비트(`POST /v1/stats/hit` 204, 열린 앱 7대 ≈ 시간당 420건)와 가동 감시 `GET /`(5분)여서 **빠르고 성공한 하트비트(`/v1/stats/hit`·`/v1/stats/leave`·`/`·`/health`, OPTIONS)는 debug 레벨로** 내림(`isRoutineHeartbeat`). 실패(≥300)·1초 이상은 그대로 info. 프로덕션 `LOG_LEVEL`은 info이므로 Railway 로그는 실제 트래픽·오류만 남음. Actions는 `Play upload` 시간별 403(의도된 실패) 외 전부 성공(CI 주간 스모크 11-09 성공)

## 7-8. KCP 실결제 시도 — 인증 오류·3017 팝업 차단 수정 (2026-11-19)
- 2026-11-19 사용자가 `/app/#/business`에서 ₩9,900 실결제 시도: KCP 창(iframe) → BC카드 선택 → 카드 인증 창 `spay.kcp.co.kr/cardPopupRedirect.do`가 **"신용카드 인증 오류 발생"**, 이어 KCP 본창이 **"[3017] 팝업 차단기능 혹은 팝업차단 프로그램이 동작중"**. 결제 미완료(PortOne 결제 생성 안 됨, 환불할 것 없음)
- 원인: 사이트 `_headers`의 `Cross-Origin-Opener-Policy: same-origin`이 `/app/*`에도 적용됨. KCP PC 결제창(iframe)은 카드사 인증(ISP/앱카드)을 **별도 창**으로 열고 `window.opener`로 결과를 돌려받는데, COOP `same-origin`이 그 opener를 끊어 인증 창이 "인증 오류"를 내고 KCP가 이를 팝업 차단(3017)으로 보고함. `windowType.pc`는 `IFRAME`이 맞음 — PortOne은 KCP PC에 `POPUP`/`REDIRECTION`을 지정하면 "PC환경에서 지원하지 않는 PG사 창 유형"으로 거절(사용자가 공유한 WindowLayout 실적용 가이드 `portone-kcp-iframe-guide-20261119`, display 저장소 PR #49 검증)
- 수정(`apps/site/src/assets.ts`, `/app/*`만): `! Cross-Origin-Opener-Policy` 후 `same-origin-allow-popups`(사이트 나머지는 `same-origin` 유지, COEP 없음이라 crossOriginIsolated 영향 없음); `! Permissions-Policy` 후 `payment=(self)`; `img-src`에 PG 도메인 추가. 웹: `Billing.tsx`에서 결제 섹션 마운트 시 PortOne SDK 선로딩(클릭 직후 창이 뜨도록). `windowType { pc: IFRAME, mobile: REDIRECTION }`·frame-src·form-action·connect-src·`style-src 'unsafe-inline'`·모바일 복귀(`/billing/return`)·대기 주문 '다시 확인'은 이미 가이드와 일치
- **사이트 배포가 필요**(헤더는 Cloudflare Pages `_headers`): Site 워크플로의 배포 단계는 `CLOUDFLARE_API_TOKEN` 시크릿이 없어 skip → 2장 수동 배포 명령으로 올린 뒤 Chrome 개발자도구 Network에서 `/app/` 응답 헤더 `cross-origin-opener-policy: same-origin-allow-popups` 확인 → `/app/#/business` 결제 → 카드 인증 창까지 진행되는지. 성공 시 PortOne 콘솔에서 취소(9. 남은 작업)

## 7-9. A–Z 전수 점검 — 엔진·아키텍처 업그레이드 (2026-11-24)
- 방식: 기준선 전부 통과 확인(core 94·API 113·Rust 37 테스트, 웹 i18n 1354키×11, 사이트 722페이지) → 네 영역(코어 TS+Kotlin / Rust+데스크톱 / API / 웹+사이트)을 병렬 정밀 감사해 52건 도출 → 실제 코드 경로를 확인한 뒤 가치 순으로 패치. 결과 기준선: core 147·API 114·Rust 84 테스트, 웹 3 테스트(신규), i18n 1374키×11
- **의존성 보안**: hono 4.13.13→4.13.21, @hono/node-server→1.19.19(취약점 8건 중 6건 해소; 남은 zod 메모리 고갈은 요청 본문 크기 제한으로 완화·v4 이행은 보류, node-server serveStatic은 미사용). Rust cookie·rustls-webpki·url·webpki-roots 패치 범프(`cargo audit` 취약점 0). `pnpm -r outdated`의 메이저(React 19, vite 8, vitest 5, zod 4, TypeScript 7)는 별도 작업으로 남김
- **API(결제)**: 앱에서 주문을 취소(또는 72h 만료)한 뒤 이미 열려 있던 PG 창에서 결제가 완료되면 `confirm`·매시간 정산이 그 주문도 공급자에 확인 → 금액 일치면 정산(라이선스 발급), 불일치면 환불. 환불 호출이 실패한 불일치 주문(`amount_mismatch`)은 정산 스위프가 성공할 때까지 재시도(`…_refunded`). PayPal `INSTRUMENT_DECLINED` 등은 402 `payment_declined`로 주문을 열어 둠(다른 결제 수단 재시도). 정산 스위프 단일 실행 보장(1시간 넘게 걸릴 수 있음). `issueKey` 재시도를 세이브포인트 안에서(기존엔 트랜잭션이 이미 중단돼 재시도 불가). 관리자 결제 설정 저장은 advisory lock으로 직렬화
- **API(기타)**: 마이그레이션 `006_device_fk_indexes.sql`(sessions/items.device_id 부분 인덱스 — 기기 삭제·계정 삭제 시 전체 스캔 제거), Atlas 신고는 이메일 인증 계정만(미인증 3계정으로 아무 템플릿이나 숨길 수 있었음), 익명 공유 기본 30일 만료(삭제 주체가 없음), `/health` DB ping 5초 캐시(rate limit 면제 경로), OpenAPI에 `/v1/me/admin-claim`·`/v1/stats/*`·`/robots.txt` 추가
- **엔진 3종 동일 규칙**(TS·Rust 반영, Kotlin은 같은 PR): `/`·`%` 결과 guard(NaN/Infinity 변수 유입 차단), 리스트 총 문자 16M 한도(`MAX_LIST_CHARS`; 값을 복사하는 Rust/Kotlin의 OOM 방지), 리스트→문자열 변환을 1MB 예산 안에서 생성, `==`/`contains`가 단계 예산(20,000) 소모, onError goto는 gotoStepId 필수, openUrl은 http(s)/mailto·http는 http(s)만, 숫자 변수 초기값이 숫자가 아니면 실행 시작 시 명확한 오류, 화면 좌표 확인에 pixelCheck/waitForPixel/pixel 조건/ocr 포함. **새 fixture `fixtures/engine/expressions.json`(52건, TS가 생성)**을 Rust `tests/expr.rs`·Kotlin `ExpressionFixtureTest`가 재생 → 식 언어 패리티가 CI로 고정됨
- **Rust 정규식 번역기**를 ECMAScript 방언에 맞춤: 클래스 안 `\w`·`\d`는 범위로(`[\w-.]`·`[a-\d]`의 `-`는 리터럴, Annex B), `.`이 `\r`·U+2028/2029 제외, `\s`는 ECMAScript 집합, `\0`=NUL, 수량자가 아닌 `{`는 리터럴, `[]`는 무매치·`[^]`는 전체, `\A` 등 식별 이스케이프는 글자 자체, `(?i)`·`a*+`·`\p`는 TS와 같은 메시지로 거절
- **Safety Score**: 클립보드 set·notify·confirm·http body에 `{{secret:}}`가 들어가면 확인 필요 항목 `risk.secretExposed`(12개 언어). **Lint**: 수식키 없는 전역 단축키(`a`, Space, Enter)는 오류 `lint.hotkeyNoModifier`(F1~F24 단독은 허용) — 데스크톱 `triggers_sync`도 같은 규칙으로 등록 거부(공유 플로우가 모든 앱의 `a`를 가로채는 문제). 긴급 정지를 바꾼 뒤 각 플로우의 기본 stop(Ctrl+Alt+Esc)이 첫 플로우에만 묶이고 나머지가 실패로 표시되던 문제 → 기본 stop은 추가 Halt로 유지
- **Windows 백엔드**: `key:"A"`가 Shift+a(소문자로 입력되던 문제), Halt가 예/아니오 질문 창을 실제로 닫음(MB_YESNO는 WM_CLOSE 무시 → WM_COMMAND IDNO), CapsLock 추적이 자동 반복·주입 입력에도 정확, http 단계가 link-local(169.254/16, fe80::/10, fd00:ec2::)을 호스트명 해석 후에도 거절(루프백·사설망은 Safety Score로 표시만). 이 세션에선 `rustup target add x86_64-pc-windows-msvc` 후 `cargo clippy --no-default-features --target x86_64-pc-windows-msvc`로 Windows 전용 코드까지 `-D warnings` 통과(ring은 교차 컴파일 불가라 `net` 기능 제외)
- **웹 앱**: 동기화가 데이터를 잃지 않음(Keyforge 프로필도 충돌 사본, 원격 삭제 vs 로컬 수정은 로컬 유지 후 재업로드, 끌어온 삭제가 원격 DELETE를 쏘지 않음; `sync.test.ts` 3건), 로그아웃·계정 삭제 시 `sync:state` 초기화(다른 계정이 리비전을 상속하던 문제), 401은 토큰을 실제로 보냈을 때만 세션 삭제, 결제 상태 새로고침이 결제 완료를 덮어쓰는 경쟁 제거, 복귀 URL `message` 비표시(코드→i18n), 건너뛰기 링크·모달 포커스·표 머리글·listbox 접근성, 하드코딩 영어 제거, 사이트의 `af-lang` 언어 선택 승계, 사이트 `md()` 링크 href 이스케이프·스킴 제한
- **보류/주의**: 단계별 `stepTimeoutMs`가 Windows의 블로킹 액션(window 대기·findImage·http·confirm)을 중단시키지 못함(TS는 AbortSignal) — 백엔드에 deadline 전달 설계 필요. 데스크톱 크레이트는 이 컨테이너에서 Windows 타깃 `cargo check`가 ring 때문에 끝까지 가지 않으므로 PR의 rust.yml Windows 잡으로 확인. 웹 PWA 메인 번들 755 kB(페이지 lazy 분할 후보)

## 7-10. 1.2.0 — 기능·인터페이스 보강 릴리스 (PR #45, 2026-11-25)
- 방식: 웹·네이티브 두 갈래 공백 분석("프로그램 본질인데 없던 것") → 영역별 구현 → 통합 → 독립 재검토 2회(네이티브 5건, 웹 차단 1건+8건 모두 수정) → 실제 브라우저 E2E 22구간(`node apps/web/scripts/smoke.mjs`, `SMOKE_SHOTS=<dir>`로 스크린샷). 기준선: core 147·API 114·Rust 90·웹 123 테스트(20파일), i18n 1553키×11, PWA precache 54
- **편집기**: 세션 전체 실행 취소/다시 실행(`lib/history.ts`), 아무 단계에서나 실행·한 단계만 실행(`lib/partialRun.ts`; 네이티브엔 `run_start {transient:true}` → 트리거용 라이브러리 사본·승인 기록을 건드리지 않음), 단계 복사/붙여넣기, group/loop/try로 감싸기, 접기, 단축키 표(`?`), 단계별 시간 제한·재시도 정책 UI, "단계로 이동"은 목록 선택, 실패 단계로 가는 딥링크(`#/flows/<id>?step=`)
- **라이브러리**: 폴더, 다중 선택 일괄 이동/태그/내보내기/삭제, 마지막 실행순 정렬, 단계 내용 검색, .json 끌어다 놓기 가져오기(검토 화면 `ImportReview`, 같은 id는 "교체/둘 다 유지")
- **트리거**: 설정을 지우지 않고 끄기(`settings.pausedTriggers`), 두 플로우가 같은 단축키를 쓰면 표시, 등록 실패 사유 표시(`TriggerBadge`)
- **실행 기록**: 단계별로 접힌 트레이스·소요 시간·가장 느린 단계(`lib/runTrace.ts`), 검색, 다시 실행, 내보내기
- **비밀값 관리자**(설정): `{{secret:name}}` 값 저장(Windows/Android는 시스템 키 저장소), 어느 플로우가 쓰는지·이 기기에 없는 값 표시
- **백업**: `autoflow.backup` 한 형식(플로우·Keyforge·설정), 복원 시 폴더·즐겨찾기·중단점·꺼 둔 트리거 유지. 저장 검증(`saveFlow`가 `parseFlow` 통과분만 저장), 읽을 수 없는 저장분은 지우지 않고 `unreadable`로 보관 + "내보내기" 토스트
- **네이티브 브리지 추가**(`packages/core/src/bridge.ts`): `image_import/list/delete`, `windows_list`, `apps_list`, `open_settings: exactAlarm`, `run_start.transient`
- **Windows**: 단계 시간 제한이 블로킹 대기(창·이미지·OCR·HTTP·질문)를 실제로 끊음(`RunControl::arm_deadline`; `uia::find_element`만 미포함), 위험 단계 승인을 기억(`approvals.rs` — 단계+변수 해시)해 예약·단축키 실행 허용, 트리거 실행 실패 알림(10분 제한, 사용자가 거절한 경우 제외), 참조 이미지 가져오기(4096px 한도, Windows 장치명 거부), 창 목록
- **Android**: 참조 이미지 가져오기(2048px 한도·OOM 방어), 앱 목록, 트리거 실행 실패 알림, 예약 실행을 expedited work로(재시도 시 중복 실행 방지), 실행 알림에 현재 단계. **새 `<uses-permission>` 없음**(Play 선언 추가 불필요)
- **웹 기타**: 화면별 lazy 로딩(시작 번들 755→535 kB) + 화면 단위 ErrorBoundary, 새 버전 안내(PWA), 상단 바가 1280–1536px에서 겹치고 휴대폰에서 Run이 화면 밖으로 나가던 문제 수정
- **검증 한계(정직하게)**: Windows 트레이·알림·이미지 가져오기와 Android 런타임 동작은 컴파일·단위 테스트까지만(실기기 미실행). Android WebView에서 백업 파일 내려받기(blob)는 기존 방식 그대로라 미확인
- **릴리스(2026-11-25 완료)**: PR #45 병합(main 26567c6, 13:59 KST) → Site·API·CI·rust 워크플로 통과, 사이트 changelog·`/app/`(lazy 청크 43개, Settings 청크에 1.2.0) 반영 확인, API `/health` 200
  - **Android**: `android.yml` run 45550497317(version 1.2.0, track production) 성공 — versionCode 20 업로드, 12개 언어 문구·이미지, `track production: completed` → `committed`(14:15 KST). 새 권한 없음. 심사 결과는 Console에서 확인
  - **Windows**: 첫 두 번(run 45550493450)은 러너 `FELIXLEE`에서 `light.exe LGHT0217 … The Windows Installer Service could not be accessed`로 실패 — 회사 러너가 LocalSystem이 아니라 `ghrunner` 계정으로 돌고 있었음. **PR #46**: LocalSystem이 아닐 때만 Tauri의 WiX 폴더(`%LOCALAPPDATA%\tauri\WixTools314`)의 `light.exe`를 `-sval`을 붙여 넘기는 작은 전달 프로그램(csc로 빌드, 원본은 `light-real.exe`)으로 바꿔 ICE 검증을 건너뜀(LocalSystem이면 기존대로 전체 ICE). `setup-node`의 `cache: pnpm` 제거(self-hosted에서 post 단계가 완성된 빌드를 실패 처리). 시험 빌드 run 45553133695(FELIXLEE-2)에서 MSI 2종 서명·검증 확인 → main 1892a22에서 run 45554470570 성공(14:40 KST), GitHub Release v1.2.0에 setup.exe·MSI(en-US, ko-KR)·portable.exe 첨부
  - **R2 미러**: 이 컨테이너에서 `publish-r2.mjs`는 GitHub API 단계에서 막힘(저장소 이름 변경 리다이렉트가 숫자 ID 경로라 프록시가 거부). 저장소가 public이라 `https://github.com/projectteamforyou/autoflow/releases/download/v1.2.0/<파일>`을 curl로 받아(8개, `SHA256SUMS*.txt`와 일치 확인) 같은 규칙으로 `wrangler@3 r2 object put` → `releases/v1.2.0/*`, 고정 주소 4개, `latest.json`(1.2.0). 실제 주소에서 내려받은 4개 파일의 SHA-256이 릴리스와 일치(setup 976feaea…, msi d250ea7e…, portable b93287c7…, apk db0efd43…)

## 7-11. 1.2.0 출시 후 A–Z 감사 (PR #48, 2026-11-27)
- 방식: 운영 확인(API 60시간 63,089건 중 5xx 0건, 4xx는 스캐너 404·클라이언트 종료 499) → 세 갈래 읽기 전용 감사(웹+코어 / Rust+데스크톱+Android / API+사이트+릴리스 자동화)에서 **재현된 것만** 수정 → 영역별 회귀 테스트. 기준선: core 153 · web 139(22파일) · API 124 · Rust 93 · Kotlin 엔진 60, 브라우저 E2E 22구간
- **차단급 — "다른 플로우 실행"으로 부른 플로우가 위험 승인 없이 실행됨**(세 엔진 공통): A(runFlow→B)를 예약·단축키로 돌리면 B의 `http POST {{secret:}}`·파일 쓰기가 승인 없이 실행됐음. 세 엔진 모두 호출 가능한 플로우의 단계를 합쳐 위험을 판정(`analyzeRiskWithCalls` / `analyze_risk_with_calls`, 방문 집합·깊이 8·모르는 id 건너뜀). 데스크톱 승인 해시(`approvals::steps_hash(flow, library)`)는 호출되는 플로우까지 포함 → B를 고치면 다시 물음(호출이 없는 플로우의 기존 승인은 그대로)
- **네이티브가 호출 대상 플로우를 모르던 문제**: 웹은 트리거가 걸린 플로우만 `triggers_sync`로 보냈기 때문에, 예약 A → 수동 B는 B를 네이티브에서 한 번도 실행한 적이 없으면 `flow "B" not found`. 브리지에 `library?: Flow[]`(run_start·triggers_sync) 추가, 웹이 `calledFlows()`로 호출 대상을 함께 보냄. Android는 triggers.json에 `library`를 같이 저장(프로세스 재시작 후에도 해석)
- **runFlow 변수**: 호출된 플로우가 선언한 변수 중 아직 없는 것만 실행 시작 때와 같은 규칙으로 초기화(호출자 값 우선, 입력값은 호출자에만 적용) — 세 엔진 동일
- **동기화 데이터 손실 3건**(웹): 일괄 삭제→되돌리기→동기화 시 다시 삭제(DELETE 경쟁 → 큐로 직렬화), 잠금 상태에서 한 삭제가 서버에 안 감(다음 동기화가 전송; 읽지 못한 저장 플로우는 삭제로 보지 않음), 내려받기가 이 기기의 폴더·즐겨찾기를 덮어씀. 서버 쪽은 이미 삭제된 항목의 DELETE가 If-Match와 무관하게 200
- **웹 편집기**: 대화상자 뒤에서 Ctrl+Enter/Ctrl+S 동작(데스크톱에선 실제 매크로 시작), 단축키 캡처가 글자·숫자의 Shift를 버림(Ctrl+Shift+K→Ctrl+K), 입력이 안 되던 필드(HTTP 헤더·태그·실행 인자·숫자 변수·음수; `components/DraftInput.tsx`), 숫자 필드 스키마 범위 보정, 감싸기 후 "단계로 이동" 대상 보정, 꺼 둔 트리거 플로우의 복제·충돌 사본이 켜진 채 생김, Easy 모드가 Pro 데이터(라벨·시간 제한·오류 정책·중단점·비활성 단계)를 말없이 버림 → 그런 플로우는 Pro로만 열림, 드롭 영역 밖에 파일을 놓으면 앱이 그 파일로 바뀜(창 단위 가드), 라이브러리 로드 전 빈 `triggers_sync`
- **API**: `PUBLIC_APP_URL` 기본값이 `/app` 없는 도메인이라 인증·재설정·공유 링크가 404(실서버에서 확인) → 기본값 `https://autoflowmacro.com/app` + 사이트 `_redirects`에 `/verify-email`·`/reset-password`·`/s/*` 302(이미 보낸 링크도 열림; **Railway에 `PUBLIC_APP_URL`을 따로 넣어 두었다면 `/app` 포함인지 확인**). NUL·짝 없는 서러게이트 입력이 500 → 400, 계정별 로그인 제한이 동시 요청으로 우회됨, 관리자가 내린 템플릿을 작성자가 지우고 같은 내용 재게시, 비밀번호 변경 후에도 예전 재설정 링크 유효, ADMIN_EMAILS 운영자가 검수 대상 템플릿을 못 엶, Atlas 검색 끝 페이지 total 0
- **공유**: 장면 썸네일(작성자 화면 조각)을 공유·내보내기에서 제거(32개면 공유/Atlas 크기 한도 초과이기도 했음)
- **데스크톱**: 모니터 식별이 동기 명령에서 창 생성(Windows 교착 가능) → async, 종료 시 실행 스레드를 최대 1초 기다려 눌린 키·버튼 해제, 중지 직후 질문 창이 남는 경쟁
- **Android**: 단계 시간 제한이 진행 중 제스처를 취소, 실행 알림이 첫 단계·일시정지를 놓치던 스로틀, 재시작된 예약 워커가 다음 회차를 보장, triggers.json 원자적 쓰기, 참조 이미지 Windows 장치명 거부·잘린 PNG 거부, 긴 연산자 사슬 StackOverflow(Kotlin 평가기 반복화). 새 권한·의존성 없음
- **릴리스 자동화**: `publish-r2.mjs --from-public`(GitHub 토큰·API 없이 릴리스의 SHA256SUMS로 목록·체크섬 검증; 이 컨테이너에선 `NODE_USE_ENV_PROXY=1` 필요), `--dry-run`, 별칭당 파일 1개(en-US MSI는 `windows/AutoFlow-x64-en-US.msi`, 겹치면 오류), 기본 저장소명 projectteamforyou/autoflow. `windows.yml` light.exe 전달 프로그램: 모든 WiX 폴더 처리·자기 식별(제품명)·재귀 방지·원본 누락 시 폴더 제거(다음 Windows 빌드에서 실검증 필요). PowerShell `throw \"…\"` 오타, Play 버전 코드는 환경 변수(`PLAY_VERSION_CODE`)
- **1.2.1 릴리스(2026-11-27 완료)**: PR #48 병합(main d92d953, 12:55 KST) → CI·rust·API·Site 통과. 실서버 확인: `/verify-email`·`/reset-password`·`/s/*` 302 → `/app/…`, changelog·`/app/` 1.2.1, API `/health` 200, `?q=%00` 400
  - Windows: `windows.yml` run 45936978866(version 1.2.1, OFFICE) 성공 — 강화한 light.exe 전달 단계가 실제 러너에서 통과
  - Android: `android.yml` run 45936982272(version 1.2.1, production) 성공 — `track production: completed` → `committed`(13:12 KST). 심사 결과는 Console에서 확인
  - R2: `NODE_USE_ENV_PROXY=1 node scripts/release/publish-r2.mjs v1.2.1 --from-public --published-at 2026-11-27T04:13:06Z`(먼저 `--dry-run`) → `latest.json` 1.2.1, 고정 주소 5개(en-US MSI 별칭 추가)를 실제로 내려받아 SHA-256 일치 확인(setup c1e7164f…, msi-ko 84d1a869…, msi-en a42b583a…, portable 1fafcbab…, apk 3ea43ab4…)
- **검증 한계**: Windows 전용 코드(질문 창 경쟁·종료 대기·async 명령)와 Android 앱 모듈은 컴파일·정적 검사까지만. 워크플로 변경은 다음 실행에서 확인
- **남긴 것(결정 필요/후속)**: ① Android는 트리거 실행에 항상 `approvedRisk = true`(`RunManager.startFromTrigger`; "트리거를 켠 것이 승인"이라는 기존 설계) — 데스크톱처럼 플로우별 저장 승인을 둘지 결정 필요 ② 일시정지 시간이 단계 시간 제한·최대 실행 시간에 포함됨(세 엔진 동일 동작) ③ 데스크톱 라이브러리는 삭제된 플로우를 재시작 전까지 기억 ④ Atlas: 검수 대기·숨김 상태 템플릿도 작성자 삭제 후 재게시 가능 ⑤ 가입 409 `email_taken`(주소 존재 노출) ⑥ Rust 정규식·서러게이트 등 표현식 방언 차이 몇 건 ⑦ Cloudflare 이메일 난독화가 약관·방침의 mailto를 가림(대시보드에서 끄기) ⑧ Site PR의 OG 렌더 비용(verify-seo가 이미지를 요구해 그대로 둠)

## 8. 러너 메모
- 회사 PC 러너(FELIXLEE*)는 2026-11-25 현재 **`ghrunner` 계정**으로 동작(예전엔 LocalSystem). WiX ICE 검사는 LocalSystem에서만 되므로 `windows.yml`이 그 외 계정에서는 `-sval`로 MSI를 만듦(7-10). 전체 ICE 검사를 되살리려면 러너 서비스를 LocalSystem으로 바꾸면 됨. Rust는 `CARGO_HOME=C:\Rust\cargo`
- 집 PC 러너는 C 드라이브가 가득 참 → 정리 전까지 Windows 릴리스는 `runner_label: OFFICE`
- PowerShell 7 없음 → 워크플로는 `shell: powershell`, 출력 파일은 `[IO.File]::AppendAllText`

## 9. 남은 작업 후보 (다음 채팅)
- Android Scenes/픽셀(MediaProjection) 지원
- 실결제 1건(₩9,900) 후 PortOne 콘솔에서 취소로 끝까지 검증
- ~~Play 선언 심사 완료 후 `play-upload.yml submit`~~ → 2026-11-24 16:28 KST 제출 완료(7-5). Play 심사 결과(출시됨/거부)만 Console에서 확인
- 집 PC 러너 디스크 정리, Google 서비스 계정 키 교체, Cloudflare API 토큰 교체(2026-11-19 채팅에 노출 → 새 토큰으로 GitHub 시크릿 `CLOUDFLARE_API_TOKEN` 갱신)
- 7-9 보류 항목 중 남은 것: 메이저 의존성(React 19·vite 8·vitest 5·zod 4) 이행 (단계 타임아웃 선점·lazy 분할은 1.2.0에서 완료)
- 1.2.0 실기기 확인: Windows 트레이/알림/이미지 가져오기, Android 예약·알림·이미지 가져오기·백업 내려받기; `uia::find_element`에 단계 시간 제한 적용
