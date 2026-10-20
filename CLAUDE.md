# AutoFlow — 작업 규칙

저장소: `projectteamforyou/autoflow` (예전 주소 `work517/autoflow`는 GitHub이 자동으로 넘겨줌) · 인수인계: `docs/HANDOFF.md`

## GitHub Actions 비용 규칙

조직(projectteamforyou)은 무료 플랜이라 **private 저장소 Actions 월 2,000분을 조직 전체가 함께** 씁니다. 워크플로를 고칠 때 아래를 지킵니다.

- **트리거**: `push`는 기본 브랜치(`main`)만. 작업 브랜치는 `pull_request`에서만 CI가 돕니다.
  - PR은 `types: [opened, synchronize, reopened, ready_for_review]`, 잡에 `if: github.event_name != 'pull_request' || !github.event.pull_request.draft` → **드래프트 PR은 CI 건너뜀**.
  - 문서만 바뀐 PR은 건너뜀(`paths-ignore: ["**/*.md", "docs/**", "store/**"]` 또는 `paths:` 필터).
- **모든 잡에 `timeout-minutes`**, **워크플로마다 `concurrency` + `cancel-in-progress: true`**.
- **무거운 작업은 주 1회 `schedule`·`workflow_dispatch`·태그로만**: E2E/브라우저 테스트, 스크린샷, 에뮬레이터, lint 보고서, 30분 넘는 작업. 선택형 무거운 단계는 입력 기본값 **off**.
  - 예: `ci.yml`의 Chromium 스모크 테스트(주 1회 월 03:17 UTC + 수동 `smoke`), `android.yml`의 에뮬레이터 `smoke`(기본 off), `play-listing.yml`의 `images`(기본 off), `play-demo-video.yml`(수동만).
- **cron은 6시간 이상 간격**. dependabot을 추가한다면 `monthly` + `groups` + `open-pull-requests-limit: 3` 이하.
- **Linux 전용 잡**(bash·apt-get·Docker·에뮬레이터)은 `ubuntu-latest` 유지. **macOS 잡은 수동 입력이 켜졌을 때만**.

## 조직 러너 (self-hosted, Windows) 사용법

- 러너: 집 PC `부산집업무용`, `부산집업무용-2` / 회사 PC `FELIXLEE`, `FELIXLEE-2`. 라벨 `[self-hosted, Windows]`. **러너 사용 시간은 무료**(2,000분에 포함되지 않음).
- Windows 서비스로 동작 → **화면(데스크톱 세션) 없음**. 설치됨: Git, Node LTS, VS Build Tools(C++). (PowerShell 7은 일부 PC에만 있음)
- Windows 잡은 `runs-on: [self-hosted, Windows]`.
  - **Rust**: rustup이 없으면 설치하는 단계를 둡니다(`rust.yml`/`windows.yml`의 "Rust toolchain (rustup if missing)" 참고). `dtolnay/rust-toolchain`·`rust-cache`는 쓰지 않음(러너에 그대로 남음).
  - **기본 셸은 PowerShell 5** → `run:`에 `&&` 금지. 줄을 나누고 `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`로 확인. **`shell: pwsh` 금지**(회사 PC 러너는 PowerShell 7이 PATH에 없음) → `shell: powershell`.
  - PowerShell 5의 `>>`·`Out-File`은 UTF-16/BOM으로 써서 `GITHUB_OUTPUT`·`GITHUB_ENV`·`GITHUB_PATH`가 깨짐 → `[IO.File]::AppendAllText($env:GITHUB_OUTPUT, "key=value`n")`.
  - **화면이 필요한 테스트**(클립보드, 화면 캡처, 전역 단축키, SendInput)는 `runner.environment == 'self-hosted'`일 때 건너뜀. 예: `crates/engine/tests/windows_smoke.rs`, `windows_e2e.rs`(`--ignored`).
- **Android 빌드**는 러너에 JDK 21·17과 Android SDK(`C:\Android\sdk`, `ANDROID_HOME`)가 설치된 뒤에만 self-hosted로 옮깁니다. 그때 bash 단계는 `shell: bash`, `apt-get`·에뮬레이터 단계는 `ubuntu-latest`에 남깁니다. **현재는 아직 `ubuntu-latest`**.
- 러너가 모두 꺼져 있으면 Windows 잡은 대기 상태로 남습니다(분은 소모되지 않음). PC를 켜면 이어서 실행됩니다.

## 데스크톱(Tauri) 주의

- `tauri.conf.json`의 `app.security.freezePrototype`는 **false 유지**. true면 `Object.prototype`이 얼어 zod가 로드 중 `TypeError`를 내고 창이 빈 화면이 됨(1.1.0·1.1.1 실제 증상).

## 릴리스 (태그 push는 자동화 프록시가 막으므로 수동 실행)

- Windows: Actions → **windows** → Run workflow, `version: X.Y.Z` → Azure 서명·검증 후 GitHub Release, 이후 R2(`dl.autoflowmacro.com`) 업로드.
- Android: Actions → **Android build** → `version`, `track`(none/internal/production). 에뮬레이터 `smoke`는 꼭 필요할 때만.
