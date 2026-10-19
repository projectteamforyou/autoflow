# AutoFlow — Google Play 출시 가이드 (오너용 체크리스트)

작성 2026-10-19 KST · 대상 버전 1.0.0 (`apps/android/package.json`의 `version`)
패키지 이름 `com.projectteamforyou.autoflow` (`apps/android/capacitor.config.json`의 `appId`, **한 번 올리면 영원히 못 바꿈**)
웹사이트 https://autoflow-651.pages.dev · 개인정보처리방침 `https://autoflow-651.pages.dev/<언어>/privacy/` · 문의 projectteamforyou@gmail.com

> 이 문서에는 비밀값이 하나도 없습니다. 키·비밀번호·JSON은 GitHub 화면에 직접 넣고, 채팅·이슈·문서에 붙여 넣지 마세요.
> 파이프라인은 실제로 Play 프로덕션 제출까지 끝낸 출시 키트를 AutoFlow에 맞게 옮긴 것입니다(키트의 시행착오 수정 사항 포함).

---

## 0. 한눈에 보기

| 구분 | 내용 | 횟수 |
|---|---|---|
| **오너(사람)** | 개발자 계정, 앱 만들기, 업로드 키 생성(PowerShell), GitHub secret 5개, 서비스 계정, **앱 콘텐츠 선언(접근성 API·데이터 보안·포그라운드 서비스·등급·대상 연령)**, 접근성 데모 영상 촬영, **첫 출시 때 콘솔에서 "검토를 위해 보내기" 1번** | 최초 1회 (기능이 바뀔 때만 다시) |
| **자동화(GitHub Actions)** | 사전 점검 → core·web 빌드 → Capacitor 동기화 → 단위 테스트·lint → 병합 매니페스트 검증 → 서명 AAB/APK → 12개 언어 스토어 이미지 → Play 업로드·트랙 지정·제출 | 매 출시 |
| **Google만 가능(API 없음)** | 접근성 API 선언, 포그라운드 서비스 선언, 데이터 보안, 콘텐츠 등급(IARC), 대상 연령, 광고 선언, 앱 액세스, 한 번도 게시 안 된 앱의 첫 제출 | 콘솔 클릭 |

```
[최초 1회]
 ① 개발자 계정 ─ ② 앱 만들기 ─ ③ 업로드 키(.jks) ─ ④ GitHub secret 4개
 ⑤ 서비스 계정 + Play Console 초대 ─ ⑥ secret PLAY_SERVICE_ACCOUNT_JSON
 ⑦ 앱 콘텐츠 선언(접근성 데모 영상 포함) ─ ⑧ 기본 브랜치에 머지

[매 출시] GitHub → Actions → Android build → Run workflow (track / status / smoke)
   --check 사전 점검(몇 초) → 빌드·테스트 → 서명 AAB → 스크린샷 렌더링 → publish.mjs (하나의 edit)
   * 한 번도 게시 안 된 앱이면 자동으로 draft 로 낮춰 올림 → 콘솔에서 1번 클릭
```

---

## 1. 최초 설정 — 순서대로

### ① Play Console 개발자 계정
- https://play.google.com/console/signup · 등록비 US$25(1회) · 신원 확인에 며칠 걸릴 수 있음
- **2023-11 이후 만든 개인 계정**은 프로덕션 신청 전에 **비공개 테스트(테스터 12명 이상, 14일 연속)** 가 필수입니다. **조직(사업자) 계정**은 이 조건이 없습니다. 개인 계정이면 `track=alpha`(비공개 테스트)로 먼저 올리세요.

### ② 앱 만들기 (콘솔)
- 앱 이름 `AutoFlow`, 기본 언어 **영어(미국) en-US**, **앱**, **무료** → 정책·수출법 동의
- **Play 앱 서명**은 기본으로 켜짐 → 그대로 둡니다. 우리가 만드는 키는 "업로드 키"가 되고, 잃어버려도 콘솔(설정 → 앱 무결성)에서 재설정을 요청할 수 있습니다.

### ③ 업로드 키 만들기 (Windows PowerShell)
1. JDK: `winget install EclipseAdoptium.Temurin.21.JDK`
2. 저장소의 `scripts/windows/android-keystore.ps1`을 **다운로드 폴더**에 두고 실행:
   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\android-keystore.ps1"
   ```
   - 기본값: KeyDir `C:\keys\autoflow`, Alias `autoflow`, Repo `work517/autoflow`, DName `CN=AutoFlow, OU=ProjectTeamForYou, O=ProjectTeamForYou, L=Seoul, C=KR`
   - 키 폴더는 **git 저장소 밖**이어야 합니다(안이면 스크립트가 멈춤).
   - **DName에 `+` 금지** (keytool이 구분자로 읽어 `empty AVA in RDN` 오류).
   - 이미 키가 있으면 **절대 덮어쓰지 않고** 비밀번호만 확인해 secret 값을 다시 준비합니다.
   - 다운로드 폴더 위치는 셸 → 레지스트리(User Shell Folders) → OneDrive → `%USERPROFILE%\Downloads` 순서로 찾습니다(집/사무실 PC마다 달라도 됨).
3. **집/사무실 PC를 번갈아 쓸 때**: 업로드 키는 **하나**여야 합니다. 다른 PC에서 만든 `autoflow-release.jks`를 USB로 이 PC의 다운로드 폴더에 복사한 뒤 실행하면, 스크립트가 새 키를 만들지 않고 그 키를 `C:\keys\autoflow`로 옮겨 씁니다.
4. `.jks`와 비밀번호를 **두 곳 이상**(USB + 비밀번호 관리자)에 백업. git·메일·메신저·채팅 금지.

### ④ GitHub secret — 서명용 4개
위치: https://github.com/work517/autoflow/settings/secrets/actions → New repository secret

| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `autoflow-release.jks.base64.txt` 내용 전체 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `autoflow` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 (PKCS12라서 키스토어 비밀번호와 같음) |

- **gh CLI로 넣을 때는 반드시 `set-android-secrets.ps1`을 쓰세요.** Windows PowerShell 5.1은 파이프로 넘길 때 값 끝에 CRLF를 붙여 `keystore password was incorrect`, `base64: invalid input` 오류가 납니다. 스크립트는 ① PC에서 keytool로 비밀번호를 먼저 확인하고 ② 줄바꿈·BOM 없는 임시 파일을 `cmd` 리다이렉트로 넘깁니다. (워크플로도 `tr -d '\r\n'`·BOM 제거로 한 번 더 방어합니다.)
  ```powershell
  winget install GitHub.cli ; gh auth login
  powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\set-android-secrets.ps1"
  ```

### ⑤ 서비스 계정 (Play API 인증)
1. https://console.cloud.google.com → 프로젝트 생성(예: `autoflow-play`)
2. API 및 서비스 → 라이브러리 → **Google Play Android Developer API** 사용 설정
3. IAM 및 관리자 → 서비스 계정 → 만들기 (Cloud 역할 불필요)
4. 서비스 계정 → 키 → 키 추가 → **JSON** → 다운로드 (비밀로 취급). 조직 정책 `iam.disableServiceAccountKeyCreation`에 막히면 조직 관리자에게 예외 요청.
5. Play Console → **사용자 및 권한 → 새 사용자 초대**: 서비스 계정 이메일, 앱 권한에 AutoFlow 추가, 권한 **앱 정보 보기 · 테스트 트랙에 출시 · 프로덕션에 출시 · 앱 버전 관리 · 스토어 등록정보 관리**. 반영까지 최대 24시간.

### ⑥ GitHub secret `PLAY_SERVICE_ACCOUNT_JSON`
- JSON 파일 내용 **전체**(중괄호 포함)를 GitHub 화면에 직접 붙여 넣습니다.
- 노출됐다고 느끼면: 새 키 발급 → secret 교체 → 옛 키 삭제.

### ⑦ 저장소 변수(선택)
| 변수 | 용도 |
|---|---|
| `VERSION_CODE_OFFSET` | versionCode = `run_number + OFFSET`. 사전 점검이 "already used"를 알려 주면 올림 |
| `ANDROID_TARGET_SDK` | 기본 36(2026-08-31부터 Play 요구 수준). 요건이 올라가면 변경 |
| `SITE_URL` | 기본 `https://autoflow-651.pages.dev` |

### ⑧ 기본 브랜치에 머지
`workflow_dispatch` 버튼은 **기본 브랜치에 있는 워크플로만** 보입니다.
> 머지 후 한 번은 `pnpm install`로 `pnpm-lock.yaml`을 갱신해 커밋하세요(새 패키지 `@autoflow/android`). 워크플로는 잠금 파일이 어긋나면 자동으로 다시 풀지만, 갱신해 두는 편이 빠르고 재현성이 좋습니다.

---

## 2. 앱 콘텐츠 선언 (정책 및 프로그램 → 앱 콘텐츠)

모두 "완료"로 만든 뒤 **게시 개요 → 검토를 위해 변경사항 보내기**.

### 2.1 접근성 API 선언 (AccessibilityService) — 가장 중요
AutoFlow는 `isAccessibilityTool="false"`(장애인 보조 전용 앱이 아님)이므로 **접근성 API 사용 선언서**를 제출해야 하고, 심사가 가장 까다로운 항목입니다.

**콘솔 위치**: 앱 콘텐츠 → 민감한 앱 권한 → **접근성 API** → 시작
- 앱이 접근성 API를 사용하나요? **예**
- 핵심 기능: "사용자가 직접 만들고 시작한 자동화 플로우(자동 클릭·매크로·루틴)의 탭, 스와이프, 길게 누르기, 스크롤, 텍스트 입력, 뒤로/홈 같은 시스템 동작을 실행하고, 실행 중에는 떠 있는 정지 버튼을 표시합니다. 화면 내용은 입력할 텍스트 칸이나 플로우가 지정한 요소를 찾을 때만 확인하며 수집·저장·전송하지 않습니다. 잠금 화면·권한 창·시스템 설정에서는 동작하지 않습니다."
- 영문(콘솔이 영어를 요구할 때): "AutoFlow uses the AccessibilityService API only to perform the taps, swipes, long presses, scrolls, text input and global actions (Back, Home, Recents…) contained in automation flows that the user creates and starts, and to show a floating Stop button while a flow runs. It reads window content only to find the focused text field or an element the user's flow targets; nothing is collected, stored or transmitted. It never acts on the lock screen, permission dialogs or system Settings, and the user can stop every run at any time."
- 서비스 설명 문자열(설정 › 접근성에 보이는 문구)은 12개 언어로 `res/values-*/strings.xml`의 `accessibility_service_description`에 들어 있습니다.

**눈에 띄는 공개(Prominent disclosure)와 동의** — Play 요구 사항(웹 앱의 공개 화면이 맡음, 확인만 하세요):
- 접근성 설정으로 보내기 **전에**, 앱 안에서 전체 화면 또는 대화상자로 **무엇을 하는지·어떤 데이터에 접근하는지·어떻게 쓰는지**를 쉬운 말로 보여 줄 것
- 일반 개인정보처리방침이나 이용약관 안에만 있으면 안 되고, 사용자가 **"동의"를 직접 눌러야** 함(뒤로/홈으로 닫으면 동의 아님)
- 동의 후 "설정 열기" → `permission_request("accessibility")`가 설정 화면을 엽니다. 서비스는 자동으로 켜지지 않습니다.

**필수 데모 영상** (YouTube 비공개/일부 공개 링크, 30초~2분 권장):
1. 앱 실행 → 접근성이 필요한 기능(예: 자동 클릭) 선택
2. **공개 화면 전체가 보이도록** 잠시 멈춘 뒤 "동의" 탭
3. 설정 › 접근성 › AutoFlow에서 사용자가 직접 켜는 장면
4. 자동 클릭 플로우를 시작 → 실제로 탭이 실행되는 장면 → **떠 있는 정지 버튼**으로 멈추는 장면
5. (권장) 잠금 화면/설정 화면이 앞에 오면 실행이 멈추는 장면
- 영상은 실제 기기 화면 녹화로, 콘솔의 언어 설정과 같은 언어 UI로 찍으면 심사가 빠릅니다.

### 2.2 포그라운드 서비스 선언
**콘솔 위치**: 앱 콘텐츠 → 포그라운드 서비스 권한
- 사용하는 유형: **특수 용도(specialUse)** — `FOREGROUND_SERVICE_SPECIAL_USE`
- 설명: "사용자가 시작한 자동화 플로우가 다른 앱 위에서 실행되는 동안에만 서비스가 켜지고, 알림에 정지/일시정지 버튼을 보여 주며, 플로우가 끝나면 즉시 종료됩니다. 실행 시간이 기본 10분, 최대 사용자 설정값이라 3분 제한의 shortService로는 처리할 수 없습니다."
- 영문: "Runs only while a user-started automation flow is executing in other apps; the notification always offers Stop and Pause, and the service stops as soon as the flow ends. Flows run up to 10 minutes by default, so shortService's 3-minute budget does not fit."
- 매니페스트 속성 `PROPERTY_SPECIAL_USE_FGS_SUBTYPE`에 같은 설명이 들어 있습니다. 데모 영상을 요구하면 2.1 영상의 4번 장면(알림의 정지 버튼 포함)을 재사용하세요.

### 2.3 기타 민감 권한
| 권한 | 콘솔 선언 | 메모 |
|---|---|---|
| `SCHEDULE_EXACT_ALARM` | 별도 양식 없음(Android 14+ 기본 거부, 사용자 허용) | 15분 미만 간격·cron 예약 트리거에서만, 사용자가 "알람 및 리마인더"를 허용했을 때만 사용. **`USE_EXACT_ALARM`은 쓰지 않음** |
| 알림 접근(NotificationListenerService) | 별도 양식 없음 | 알림 트리거에만, 사용자가 켤 때만. 알림 내용은 기기 안에서 비교만 하고 저장·전송하지 않음 |
| `RECEIVE_BOOT_COMPLETED`, `ACCESS_NETWORK_STATE`, `POST_NOTIFICATIONS`, `INTERNET` | 없음 | 일반 권한 |
| **없음**: 위치, 연락처, 저장소, `QUERY_ALL_PACKAGES`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, 광고 ID | — | 워크플로가 병합 매니페스트로 매번 검증 |

### 2.4 데이터 보안 (Data safety)
AutoFlow 기준 답안(기능이 바뀌면 다시 확인):

| 질문 | 답 |
|---|---|
| 필수 사용자 데이터 유형을 수집하거나 공유하나요? | **예** (선택형 계정을 만든 사용자에 한해 이메일 수집) — 계정 없이 쓰는 사용자의 데이터는 기기 밖으로 나가지 않음 |
| 전송 중 암호화 | **예** (모든 통신 HTTPS, 평문 HTTP 차단) |
| 사용자가 삭제를 요청할 수 있나요? | **예** — 앱 설정의 계정 삭제, 또는 projectteamforyou@gmail.com |
| 제3자와 공유 | **아니요** (호스팅 업체는 "서비스 제공업체"라 공유 아님) |

수집 항목:

| Play 데이터 유형 | 실제 내용 | 필수/선택 | 목적 | 처리 |
|---|---|---|---|---|
| 개인 정보 → **이메일 주소** | 선택형 계정 로그인 | **선택** | 계정 관리, 앱 기능(동기화) | 수집, 공유 안 함 |
| 앱 활동 → **기타 사용자 생성 콘텐츠** | 동기화를 켠 경우의 플로우 — **기기에서 종단간 암호화된 암호문**만 서버에 저장(사업자도 내용 열람 불가) | **선택** | 앱 기능(기기 간 동기화) | 수집, 공유 안 함 |
| 앱 활동 → 기타 사용자 생성 콘텐츠 | Atlas에 **사용자가 직접 공개 게시**한 템플릿(선택 기능을 쓰는 경우만) | 선택 | 앱 기능 | 수집, 공유 안 함 |

- **비정상 종료 로그·진단: 수집하지 않음** (현재 크래시 수집 SDK 없음. Firebase Crashlytics 등을 추가하면 "앱 정보 및 성능 → 비정상 종료 로그"를 추가로 신고)
- 수집하지 않음: 위치, 연락처, 사진·파일, 화면 내용, 입력한 텍스트, 비밀번호, 알림 내용, 광고 ID, 기기 ID, 결제 정보, 웹 기록
- 접근성 서비스가 보는 화면 정보와 `{{secret:…}}` 비밀값(Android Keystore AES-GCM 암호화)은 **기기 밖으로 나가지 않으므로 수집이 아님**
- "데이터가 일시적으로만 처리되나요?" → 이메일·동기화 데이터는 저장되므로 **아니요**
- 보안 관행: 전송 중 암호화 예 · 삭제 요청 가능 예 · (독립 보안 검토 아니요)

### 2.5 광고
- **광고 포함: 아니요.** 광고 ID 선언: **사용 안 함**. (AutoFlow에는 광고 SDK가 없고 워크플로가 병합 매니페스트에 `AD_ID`·광고 SDK가 없음을 검증합니다.)

### 2.6 앱 액세스
- **특별한 액세스 권한 없이 모든 기능 사용 가능** (로그인은 선택). 접근성 서비스는 사용자가 켜는 시스템 설정이라 테스트 계정 불필요. 심사자 안내 문구(선택): "To try automation, open a template, accept the disclosure, enable AutoFlow in Settings › Accessibility and press Start. The red floating button stops every run."

### 2.7 대상 연령층 및 콘텐츠
- 대상 연령: **13~15, 16~17, 18세 이상** (13세 미만 미포함 → 가족 정책 비적용)
- "아동에게 의도치 않게 매력적일 수 있나요?" → **아니요** (생산성·자동화 도구, 캐릭터·게임 요소 없음)

### 2.8 콘텐츠 등급 (IARC 설문)
- 카테고리: **유틸리티, 생산성, 커뮤니케이션 또는 기타** (게임 아님)
- 폭력·성적 콘텐츠·비속어·약물·도박·공포: 모두 **아니요**
- 사용자 간 상호작용/콘텐츠 공유: **예** — Atlas 커뮤니티 템플릿 공유(신고·숨김 기능 있음). 채팅 없음
- 사용자 위치 공유: **아니요** · 디지털 상품 구매: **아니요** · 인터넷에 무제한 접근(웹 브라우저 기능): **아니요** (URL은 기본 브라우저로 넘김)
- 예상 등급: 전체 이용가 / 3+ (공유 기능 때문에 "사용자 상호작용" 표시가 붙을 수 있음)

### 2.9 기타
- 뉴스 앱·코로나19·정부 앱·금융 기능·건강 앱: 모두 아니요
- 스토어 설정: 카테고리 **도구(Tools)** 또는 **생산성**, 연락처 이메일 projectteamforyou@gmail.com, 웹사이트 https://autoflow-651.pages.dev
- 개인정보처리방침 URL: **https://autoflow-651.pages.dev/en/privacy/** (언어별 `https://autoflow-651.pages.dev/<언어>/privacy/` — 각 언어 등록정보 본문에도 링크됨)

---

## 3. 매 출시 방법

```
GitHub → Actions → Android build → Run workflow
  branch: <기본 브랜치>
  track:  internal → (검증 후) production   (개인 계정: alpha 로 12명·14일)
  status: completed  (단계적 출시는 inProgress)
  smoke:  true       (에뮬레이터에서 실행 확인, 업로드를 막지 않음)
```
- **첫 출시(한 번도 게시 안 된 앱)**: Play가 draft만 받으므로 스크립트가 자동으로 draft로 낮춰 올리고 로그에 클릭 위치를 알려 줍니다 →
  **Play Console → 테스트 및 출시 → (해당 트랙: 프로덕션/내부 테스트) → 초안 출시 → 수정 → 다음 → 저장 → 게시 개요 → 검토를 위해 변경사항 보내기**. 이후 출시는 완전 자동.
- 로그 마지막에 `commitd <edit id>`가 나오면 심사 제출 끝.
- 스토어 페이지만 바꿀 때: **Actions → Play store listing (no build)** (`images=on/off`)
- 이미 올린 번들을 다른 트랙에 낼 때: **Actions → Play submit (no rebuild)**
- 태그 푸시 `v1.0.0` → 자동으로 `internal` 트랙
- 로컬 점검:
  ```
  node scripts/tools/check-listing.mjs
  node scripts/play/publish.mjs --package com.projectteamforyou.autoflow --dry-run
  node scripts/store/screens.mjs --locales=en,ko     # 스토어 이미지 미리보기 (store/screens)
  ```

**버전 규칙**
- versionName = `apps/android/package.json`의 `version` (태그와 다르면 경고만)
- versionCode = `github.run_number + VERSION_CODE_OFFSET` — 실행할 때마다 증가. 같은 번호 재시도는 **Re-run이 아니라 새로 Run workflow**.

**업데이트마다 할 일**
- [ ] `apps/android/package.json` version 올리기
- [ ] `store/whatsnew/whatsnew-<언어>` 12개 갱신 (500자 이하) → `node scripts/tools/check-listing.mjs` 통과
- [ ] 새 권한·데이터 수집이 생겼으면 2장 선언 갱신 (특히 데이터 보안, 접근성 사용 범위)
- [ ] 내부 테스트 기기: 공개 화면 → 접근성 켜기 → 자동 클릭 실행 → 정지 버튼 → 설정 화면에서 멈추는지 확인

걸리는 시간(참고): 빌드·테스트·서명 ~12분 → 스크린샷 ~4분 → 업로드·commit ~5–20분.

---

## 4. 문제 해결 (키트에서 실제로 겪은 것 + AutoFlow)

| 증상 | 원인 → 해결 |
|---|---|
| `Package not found` / 404 | 앱이 콘솔에 없거나 패키지 이름 불일치. `--check`가 빌드 전에 알려 줌 |
| `The caller does not have permission` | 서비스 계정 초대 전·반영 전, 앱 권한 누락. commit 단계 403이면 "프로덕션/테스트 트랙 출시" 권한 |
| `Only releases with status draft may be created on draft app` | 자동으로 draft로 낮춰 올림 → 3장 클릭 경로 |
| commit 400 `changesNotSentForReview` | 스크립트가 자동으로 "검토 미제출"로 저장 → 게시 개요에서 "검토를 위해 보내기" |
| `version code ... already been used` | `VERSION_CODE_OFFSET` 올리고 **새로 실행** |
| `keystore password was incorrect` / `base64: invalid input` | PowerShell이 붙인 CRLF·BOM → `set-android-secrets.ps1`로 다시 등록 |
| keytool `empty AVA in RDN` | DName에 `+` → 제거 |
| 키 생성 스크립트 "git 저장소 안" 오류 | KeyDir를 `C:\keys\autoflow`처럼 저장소 밖으로 |
| `Upload key does not match` | 다른 PC에서 **새 키를 만든 것**. 원래 `.jks`를 쓰거나 콘솔 → 앱 무결성에서 업로드 키 재설정 |
| 로그에 `***`가 많아 원인 불명 | 키 별칭 `autoflow`가 secret이라 `autoflow`가 들어간 모든 문자열(패키지 이름 포함)이 가려짐. publish.mjs는 패키지명을 `<package>`로 출력 |
| smoke job이 아티팩트를 못 찾음 | job output에 secret과 같은 문자열이 들어가면 output이 통째로 버려짐 → 워크플로는 태그만 넘기고 이름은 `format()`으로 조립(이미 반영) |
| Run workflow 버튼이 안 보임 | 워크플로가 기본 브랜치에 없음 |
| 스크린샷이 너무 큼 | 커밋하지 않고 CI에서 렌더링(en-US/ko-KR 폰 컷만 git에 있음) |
| 병합 매니페스트 검사 실패 | 새 라이브러리가 `AD_ID`·위치·`QUERY_ALL_PACKAGES`를 끌어옴 → 매니페스트에 `tools:node="remove"` 추가 또는 라이브러리 제거 |
| 접근성 선언 거절 "prominent disclosure" | 공개 화면이 설정 이동 **전**에, 사용자 **동의 버튼**과 함께 보이는지, 영상에 그 화면이 충분히 길게 나오는지 확인 |
| 접근성 선언 거절 "core functionality" | 설명·영상에서 "사용자가 만든 플로우 실행"이 앱의 핵심 기능임을 분명히. 접근성 없이 쓸 수 있는 기능과 구분해 보여 줌 |
| 실행 중 "보호된 화면" 오류 | 설계상 정상: 잠금 화면·권한 창·설정 앱이 앞에 오면 플로우가 `permission` 오류로 멈춤 |
| 기기에서 예약 트리거가 늦음 | 배터리 최적화·제조사 절전(삼성·샤오미 등). 앱의 권한 화면에서 배터리 최적화 해제 안내, 15분 미만은 "알람 및 리마인더" 허용 필요 |

---

## 5. 파일 지도

| 파일 | 역할 |
|---|---|
| `.github/workflows/android.yml` | 빌드·테스트·검증·서명·이미지·업로드 (+ 에뮬레이터 smoke) |
| `.github/workflows/play-submit.yml` | 재빌드 없이 기존 versionCode를 트랙에 제출 |
| `.github/workflows/play-listing.yml` | 빌드 없이 스토어 페이지만 갱신 |
| `scripts/play/publish.mjs` | Play Developer API v3 (SDK 없이 JWT 서명): `--check`, `--dry-run`, `--listing-only`, `--submit` |
| `scripts/tools/check-listing.mjs` | 12개 언어 길이·개인정보 링크·문의 메일·접근성 설명 검사 |
| `scripts/store/screens.mjs` + `templates/` + `captions.json` | 폰/7"/10" 스크린샷·그래픽 이미지(1024×500) 렌더링 |
| `scripts/store/icons.mjs` | Play 아이콘 `store/icon-512.png` (512×512 RGBA) |
| `store/listing/<locale>.json`, `store/whatsnew/whatsnew-<locale>` | 스토어 문구, 업데이트 노트 |
| `scripts/windows/android-keystore.ps1`, `set-android-secrets.ps1` | 업로드 키 생성, secret 등록 (UTF-8 BOM + CRLF) |
| `apps/android/` | Capacitor 앱, Kotlin 엔진(`android/engine`), 접근성 서비스·플러그인(`android/app`) |

Play 언어 12개: `en-US ko-KR ja-JP zh-CN zh-TW es-ES fr-FR de-DE pt-BR ru-RU vi id`

문의: projectteamforyou@gmail.com
