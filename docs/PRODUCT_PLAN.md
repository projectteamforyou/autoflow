# AutoFlow 제품·기술 기획서 v2

> 작성 2026-10-19 KST · 원본 「FlowKey 제품·기술 기획서」를 발전시킨 개정판
> 제품명: **AutoFlow** (작업명 FlowKey → 저장소 이름과 통일) · 문의 projectteamforyou@gmail.com

---

## 0. v2에서 무엇이 달라졌나 (요약)

| 원본 | v2에서 더한 것 | 이유 |
|---|---|---|
| 쉬운/프로 모드가 같은 파일을 편집 | **쉬운 모드 = 프로 단계의 "인식 가능한 모양"**으로 정의하고 왕복을 테스트로 보증 (`packages/core/src/easy.ts`) | "무손실 왕복"을 말이 아니라 코드·테스트로 고정 |
| 조건·변수 | **안전한 표현식 언어** (eval 없음, 허용 함수 목록, 비용·깊이·크기 상한, ReDoS 차단) | 템플릿 공유 시 임의 코드 실행 경로를 원천 차단 |
| 미리보기·테스트 실행 | **Practice Canvas** — 어떤 플로우든 브라우저의 가상 화면에서 실제 엔진으로 실행 | 설치 전 체험, 템플릿 미리보기, 실수 없는 첫 실행 |
| 위험 액션 확인 | **Safety Score**(0–100, 낮음/보통/높음) + 권한 라벨 + 실행 전 승인 | 템플릿 카드·공유 링크·실행 직전 모두 같은 기준 |
| 오류 처리 | 단계별 정책(중지/계속/재시도/점프) + try/catch + 오류 분류 10종 | 실패 원인을 "어느 단계, 왜"로 설명 |
| 실행 기록 | **Ledger** — 단계별 이벤트 스트림(시작·끝·재시도·변수·중단점) | 디버깅, 복구, 신뢰 |
| 동기화 | **종단간 암호화 동기화** — 서버는 암호문만 저장 (AES-GCM, 기기 키) | 녹화 데이터·좌표·텍스트는 사업자도 못 본다 |
| 공유 | 공유 코드(압축+base64url) + 내보내기 파일의 **내용 해시** + 가져올 때 재검증·위험도·린트 | 링크로 위험한 내용이 몰래 들어올 수 없음 |
| AI | 이용자 키/로컬 AI 선택 + **AI 출력은 스키마 검증 후 초안**으로만 | AI가 만든 것도 결정론적 엔진·안전 검사를 통과해야 실행 |
| 문서 | 12개 언어 UI·SEO 페이지·개인정보처리방침·이용약관 | 첫 출시부터 글로벌 |

---

## 1. 세계관 — "AutoFlow Universe"

기능 이름을 하나의 세계관으로 묶어, 처음 보는 사람도 메뉴만 보고 무엇을 하는지 알게 한다.

| 이름 | 무엇 | 비유 |
|---|---|---|
| **Flow** | 자동화 하나 | 물길 — 한 번 내면 계속 흐른다 |
| **Pulse** | 실행 엔진·실행 상태 표시줄 | 심장 박동 — 지금 뛰고 있는지 항상 보인다 |
| **Halt** | 긴급 중지 (Ctrl+Alt+Esc / 떠 있는 정지 버튼) | 비상 브레이크 — 언제나 손이 닿는다 |
| **Keyforge** | 입력 장치 허브: 키/버튼 재매핑, 레이어, 문자열 확장, 마우스 설정, 앱별 자동 전환 | 대장간 — 키를 다시 벼린다 |
| **Atlas** | 템플릿 라이브러리(공식·커뮤니티·조직) | 지도책 — 이미 누가 길을 그려 두었다 |
| **Ledger** | 실행 기록·단계별 로그 | 항해일지 |
| **Practice Canvas** | 가상 화면에서 안전하게 미리 실행 | 연습장 |
| **Copilot** | 이용자 키·로컬 AI로 자동화 초안 생성/설명 | 항해사 — 길을 제안하지만 키는 내가 잡는다 |
| **Studio** | 사이트·앱 제작 보조 + 이미지 생성 | 작업실 |
| **Fleet** | 연결된 PC·Android 기기, 엔진·권한 상태 | 선단 |
| **Guardrails** | 실행 한도·위험 확인·권한 설명 | 난간 |

브랜드 톤: 짙은 남색 우주 배경 + 보라(#7C5CFF)→청록(#22C3A6) 흐름 그라디언트. "흐름(flow)"을 선과 점으로 시각화한다.

---

## 2. 아키텍처

```
                ┌─────────────── packages/core (TypeScript) ───────────────┐
                │ schema · expr · engine · capabilities · risk · lint ·     │
                │ easy · explain · input-profile · record · share · templates│
                └──────┬───────────────────┬───────────────────┬────────────┘
                       │ JSON fixtures     │ same JSON         │ npm import
         ┌─────────────▼───┐   ┌───────────▼──────────┐  ┌─────▼──────────────────────┐
         │ crates/engine   │   │ apps/android (Kotlin)│  │ apps/web (React + Vite PWA)│
         │ Rust 실행기      │   │ AccessibilityService │  │ 마케팅 12개 언어 SEO 페이지  │
         │ SendInput·핫키   │   │ 제스처 실행기·오버레이 │  │ /app 웹앱 (Practice Canvas) │
         └───────┬─────────┘   └──────────┬───────────┘  └─────┬──────────────────────┘
                 │ Tauri 2                │ Capacitor           │ Cloudflare Pages
         ┌───────▼─────────┐   ┌──────────▼───────────┐        │
         │ apps/desktop    │   │ Google Play (AAB)     │        │ HTTPS (JSON)
         │ Windows 설치기   │   │ publish.mjs 자동 출시   │  ┌─────▼──────────────────────┐
         │ Azure 서명       │   └──────────────────────┘  │ apps/api (Hono, Node 22)    │
         └─────────────────┘                             │ Railway + PostgreSQL         │
                                                         │ 계정·E2E 동기화·Atlas·신고     │
                                                         └─────────────────────────────┘
```

- **단일 진실 공급원**: 스키마·표현식 문법·템플릿은 `packages/core`. Rust·Kotlin 실행기는 `packages/core/fixtures/*.json`으로 같은 문서를 읽는지 테스트한다.
- **배포**: 프런트 Cloudflare Pages, 백엔드 Railway(PostgreSQL), Windows는 GitHub Actions에서 Tauri 빌드 → **Azure Artifact Signing**으로 본체 exe부터 서명 → 서명 검증 관문 → 릴리스. Android는 Play 자동 출시 키트.

---

## 3. 핵심 기능 정의 (원본 §4 + 개선)

### 3.1 쉬운 모드
"무엇을 반복할까요?" → 클릭 / 여러 위치 / 키 / 텍스트 → 위치 지정(정규화 좌표 0–1이라 해상도가 바뀌어도 유지) → 간격(빠르게 50ms·보통 250ms·느리게 1s·직접) → 반복(횟수·시간·멈출 때까지) → 시작/중지 핫키 → **Practice Canvas에서 1회 시험** → 저장.

### 3.2 프로 모드
- 단계 31종: 입력(클릭·이동·드래그·스크롤·키·텍스트), 대기(시간·조건), 변수, 로그, 알림, 확인, 클립보드, 앱 실행, URL, 창 조작, Android 전역 동작, HTTP, 파일, OCR, 이미지 찾기, 다른 플로우 실행, 입력 프로필 전환, 중지/break/continue, if/loop/forEach/try/group.
- 단계별 오류 정책, 중단점·단계 실행, 변수 관찰, 린트(문법 오류·미정의 변수·대기 없는 무한 루프·도달 불가 단계·루프 밖 break·자기 호출 등), JSON 직접 편집.

### 3.3 Keyforge
키→키/텍스트/앱/플로우/미디어/레이어, 마우스 버튼(단일·더블·길게), 휠 방향 매핑, 반복(누르는 동안/토글), 레이어(hold/toggle), 문자열 확장, 마우스 설정, 앱·시간·장치 규칙으로 자동 전환(우선순위), **충돌 진단**(중복·OS 예약 키·플로우 핫키 충돌·자기 루프).

### 3.4 Guardrails (모든 플로우에 강제)
최대 실행 시간·최대 입력 수·최대 반복 수·시작 카운트다운·중복 실행 방지·쿨다운, 정지 500ms 이내(엔진은 100ms 단위로 쪼개 대기), 미지원 단계는 실행 전에 차단(조용히 건너뛰지 않음), 화면 해상도/배율 변경 감지 시 확인, 위험 단계 실행 전 승인.

### 3.5 Copilot / Studio (이용자 키·로컬 AI)
- 제공자: OpenAI 호환(OpenAI·로컬 Ollama/LM Studio·기타), Anthropic. 키는 기기에만 저장(WebCrypto 비추출 키로 암호화한 IndexedDB / Windows Credential Manager / Android Keystore).
- 자연어 → 플로우 초안(구조화 출력 → `parseFlow` 검증 → 린트·위험도 표시 → 사용자가 저장해야 반영).
- 전송 전 "무엇이 어디로 가는지" 미리 보여 주고, 로컬 전용 모드에서는 외부 호출 차단.

### 3.6 동기화·계정 (선택)
오프라인 우선. 로그인 시 각 플로우를 **기기에서 암호화**해 올리고, 서버는 `ciphertext + revision + content hash`만 보관. 충돌은 revision 비교 → 양쪽 보존(사본 생성).

### 3.7 Atlas
공식 템플릿 16종(클릭·키보드·사무·접근성·테스트·모바일·개발·웰빙). 커뮤니티 게시 시 서버가 다시 `parseFlow + lint + risk`를 돌려 오류·고위험을 거르고 권한 라벨을 붙인다. 신고·숨김·평가.

---

## 4. 하지 않는 일 (원본 유지 + 구체화)
CAPTCHA·보안 인증·결제 확인 우회, 부정행위 방지 우회, 시스템 보안 화면 조작, 은밀한 백그라운드 조작, 자동 계정 생성·스팸, AI의 무승인 중대 작업. 무작위 지연은 "테스트·접근성"용으로만, 화면에 그대로 보이게 표시한다.

---

## 5. 품질 기준 (자동 검증되는 것)
- `packages/core` 테스트: 표현식 샌드박스, 한도(시간·입력·반복), 정지 500ms, 일시정지, 재시도/계속/점프/try, 미지원 차단, 위험 승인, 화면 변경 확인, 중단점, 중첩 플로우, **모든 템플릿 실행**, 쉬운↔프로 왕복, 녹화 변환·마스킹, 공유 해시 위변조 감지, Keyforge 충돌·프로필 선택.
- Rust 실행기 테스트: 같은 fixture 파싱·실행(모의 입력 백엔드).
- API 테스트: 실제 PostgreSQL에 대해 인증·동기화·Atlas·보안 헤더·속도 제한.
- 웹: 빌드 + SEO 검증 스크립트(12개 언어 × 모든 페이지의 title/description/canonical/hreflang/OG/JSON-LD, robots, sitemap).

---

## 6. 출시 체크리스트 (사람이 해야 하는 것)
1. Azure Artifact Signing: 종량제 구독 → 신원확인 Completed → 인증서 프로필 → GitHub Secrets `AZURE_CLIENT_ID/AZURE_TENANT_ID/AZURE_CLIENT_SECRET` + Variables `AZURE_SIGN_ENDPOINT/AZURE_SIGN_ACCOUNT/AZURE_SIGN_PROFILE` (`docs/WINDOWS_SIGNING.md`)
2. Google Play: 개발자 계정·앱 생성(`com.projectteamforyou.autoflow`)·업로드 키·서비스 계정·콘솔 선언, **접근성 API 선언(Accessibility 사용 목적 동영상 포함)** (`docs/PLAY_RELEASE.md`)
3. 도메인 연결(선택): Cloudflare Pages 커스텀 도메인
4. Railway 환경변수(`DATABASE_URL`, `APP_ORIGIN`, `SESSION_SECRET`) 확인
