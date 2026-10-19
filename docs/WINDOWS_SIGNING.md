# Windows 코드 서명 (Azure Artifact Signing)

AutoFlow Windows 설치 파일은 **Azure Artifact Signing**(이전 이름 Trusted Signing)으로 서명합니다.
서명이 없으면 Windows SmartScreen이 "알 수 없는 게시자" 경고를 띄우고, 일부 회사 PC에서는 설치가 막힙니다.

- 서명 도구: `signtool` + `Azure.CodeSigning.Dlib.dll`(NuGet `Microsoft.Trusted.Signing.Client`) + `metadata.json`
- 타임스탬프: `http://timestamp.acs.microsoft.com` (필수 — 인증서 유효기간이 약 3일이라 타임스탬프가 없으면 사흘 뒤 서명이 무효가 됩니다)
- 서명 순서: Tauri가 **본체 exe를 먼저 서명한 뒤** 설치 파일에 넣고, 마지막에 NSIS(`.exe`)·MSI(`.msi`) 설치 파일도 서명합니다.

---

## 1. 소유자가 한 번만 할 일

### 준비물
- Azure 구독(종량제). Artifact Signing Basic SKU는 월 요금이 있습니다.
- 공개 신뢰(Public Trust) 신원 확인 자격: Microsoft 정책상 **조직(미국·캐나다·EU·영국, 3년 이상 납세 이력)** 또는 **개인(미국·캐나다)** 만 가능합니다. 자격이 안 되면 OV 코드 서명 인증서를 따로 사야 합니다.
- PowerShell에서 설치:
  ```powershell
  winget install -e --id Microsoft.AzureCLI
  winget install -e --id GitHub.cli
  ```
  설치 후 **새 PowerShell 창**을 여세요.

### 설정 스크립트 실행 (집 PC·회사 PC 어디서나 같은 방법)
스크립트는 저장소의 `scripts/windows/setup-azure-signing.ps1` 에 있습니다.

1. 이 파일을 **다운로드 폴더**에 복사합니다 (GitHub에서 *Raw* → 다른 이름으로 저장 → 다운로드).
2. PowerShell(관리자 아님)에서 다운로드 폴더로 이동해 실행합니다.
   다운로드 폴더 위치가 PC마다 달라도(예: `D:\Downloads`) 아래 명령은 항상 올바른 폴더를 찾습니다.
   ```powershell
   cd (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path
   powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-azure-signing.ps1
   ```
   위 방법이 안 되면 `cd $env:USERPROFILE\Downloads` 를 쓰세요.
3. 기본값: 리소스 그룹 `rg-signing`, 계정 `autoflow-signing`, 프로필 `autoflow-public`, 위치 `koreacentral`.
   바꾸려면 예: `.\setup-azure-signing.ps1 -Account myco-sign -Profile myco-public -Repo owner/autoflow`

스크립트가 하는 일:

| 단계 | 내용 |
|---|---|
| 1 | `az login` / `gh auth login` 확인, 구독 확인 |
| 2 | `Microsoft.CodeSigning` 공급자 등록, `az extension add --name trustedsigning` |
| 3 | 리소스 그룹·Artifact Signing 계정 생성 (Basic) |
| 4 | 로그인한 사용자(object id)에게 **Artifact Signing Identity Verifier** 역할 부여 (GUID `4339b7cf-9826-4e41-b4ed-c7f4505dac08`) |
| 5 | **일시 정지** — Azure Portal에서 신원 확인을 진행하고 *Completed* 된 Identity validation Id를 붙여 넣기 |
| 6 | 인증서 프로필(PublicTrust) 생성 |
| 7 | 서비스 주체 `sp-autoflow-signing-ci` 생성, 프로필 범위에 **Artifact Signing Certificate Profile Signer** 역할 부여 (역할 GUID는 이름으로 조회) |
| 8 | GitHub Secrets `AZURE_CLIENT_ID`·`AZURE_TENANT_ID`·`AZURE_CLIENT_SECRET`, Variables `AZURE_SIGN_ENDPOINT`·`AZURE_SIGN_ACCOUNT`·`AZURE_SIGN_PROFILE` 설정 |

- 비밀 값은 화면에 출력하지 않고, 끝 줄바꿈 없는 임시 파일 → `gh secret set` 으로 전달한 뒤 즉시 지웁니다.
- 신원 확인은 수 시간~수 일 걸릴 수 있습니다. 중간에 멈췄다면 나중에 **같은 명령으로 다시 실행**하면 이미 만든 리소스는 건너뜁니다.
- 서비스 주체 비밀번호는 보통 1년 뒤 만료됩니다. 만료 전에 스크립트를 다시 실행하면 새 비밀번호로 Secret이 갱신됩니다.

### 신원 확인(5단계) 포털 경로
Azure Portal → Artifact Signing 계정 → **Identity validations** → **+ New identity** → **Public** → 정보 입력 → 제출 →
상태가 **Completed** 가 되면 해당 항목의 **Identity validation Id**(GUID)를 복사합니다.

---

## 2. CI가 자동으로 하는 일 (`.github/workflows/windows.yml`)

`v*` 태그 푸시(예: `git tag v1.2.0 && git push origin v1.2.0`) 또는 수동 실행(workflow_dispatch) 시:

1. `pnpm install` → `packages/core` 빌드 → `apps/web` 빌드 (`apps/web/dist/index.html` 확인)
2. 서명 설정 여부 판단 — Secrets 3개 + Variables(`AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`)가 **모두** 있어야 서명 모드
3. `scripts/windows/sign.ps1 -Install` → `C:\afsign\sign.ps1` 복사, dlib을 NuGet에서 받아 `C:\afsign\dlib` 에 풀기
4. `tauri build` — `bundle.windows.signCommand` 가 파일마다
   `powershell -NoProfile -ExecutionPolicy Bypass -File C:\afsign\sign.ps1 %1` 을 호출
   - `sign.ps1` 은 `metadata.json`(UTF-8, **BOM 없음**)을 쓰고
     `signtool sign /v /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib … /dmdf …` 실행 (일시 오류 시 3회 재시도)
   - 서명 직후 `signtool verify /pa` 와 `Get-AuthenticodeSignature`(Valid + **TimeStamperCertificate 존재**)로 바로 확인
5. **서명 검증 관문**: `dist/` 의 모든 `.exe`/`.msi` 에 대해 `signtool verify /pa /v` + 타임스탬프 확인. 하나라도 실패하면 **릴리스 중단**
6. `SHA256SUMS.txt` 생성 → 아티팩트 업로드 → 태그면 GitHub Release 생성 (softprops/action-gh-release)

### 서명 설정이 없을 때
- 빌드는 그대로 진행되지만 `AZURE_SIGN_PROFILE` 을 넘기지 않으므로 `sign.ps1` 이 "skipping signing" 을 출력하고 통과합니다.
- 모든 파일 이름에 **`-UNSIGNED`** 가 붙고, `UNSIGNED-README.txt` 가 함께 올라가며, 실행 로그에 경고가 표시됩니다.
- 태그 릴리스는 **"(UNSIGNED)" 프리릴리스**로만 게시됩니다. 서명되지 않은 파일이 서명된 것처럼 게시되는 일은 없습니다.

### 로컬 빌드
- 개발용 서명 없는 빌드: 관리자 PowerShell에서 한 번 `powershell -ExecutionPolicy Bypass -File scripts\windows\sign.ps1 -Install -SkipDlib` 실행 후 `apps/desktop` 에서
  `npx @tauri-apps/cli@2.12.3 build` (환경변수 `AZURE_SIGN_PROFILE` 이 없으면 서명을 건너뜀).
- 로컬에서 서명하려면 `sign.ps1 -Install`(dlib 포함) 후 `az login` 하고 `AZURE_SIGN_ACCOUNT`, `AZURE_SIGN_PROFILE`, `AZURE_SIGN_ENDPOINT` 를 설정하세요. 로그인한 계정에도 Certificate Profile Signer 역할이 필요합니다.
- `C:\afsign` 처럼 **공백 없는 경로**를 쓰는 이유: Tauri가 `signCommand` 를 공백 기준으로 나누기 때문입니다.

---

## 3. 문제 해결

| 증상 | 원인 / 해결 |
|---|---|
| **403 Forbidden** / `SignerSign() failed` | ① 서비스 주체에 **Artifact Signing Certificate Profile Signer** 역할이 없음(또는 계정이 아닌 다른 프로필 범위) → 스크립트 7단계 재실행. 역할 반영에 최대 수십 분 걸릴 수 있음 ② `AZURE_SIGN_ENDPOINT` 가 계정 지역과 다름 (koreacentral = `https://krc.codesigning.azure.net/`) ③ `AZURE_SIGN_ACCOUNT`/`AZURE_SIGN_PROFILE` 이름 오타 ④ 신원 확인이 Completed 아님, 프로필이 Active 아님 ⑤ 구독 상태가 Registered 아님 ⑥ dlib 경로·버전 문제 |
| `No certificates were found that met all the given criteria` | `/dlib` 경로가 틀려 signtool이 로컬 인증서 저장소를 찾는 상황. `C:\afsign\dlib\bin\x64\Azure.CodeSigning.Dlib.dll` 존재 확인, x64 signtool과 x64 dlib을 같이 써야 함 |
| `Azure.CodeSigning.Dlib.dll not found` | `sign.ps1 -Install` 을 실행하지 않았거나 `-SkipDlib` 로 설치함. CI에서는 서명 모드일 때 자동 설치 |
| signtool이 아무 메시지 없이 실패 | .NET 8 런타임 또는 VC++ 재배포 패키지 누락 (GitHub `windows-latest` 에는 기본 설치) |
| `metadata.json` 파싱 오류 | BOM이 들어간 경우. `sign.ps1` 은 UTF-8 BOM 없이 씀 — 직접 만들 때 PowerShell 5.1의 `Out-File`/`Set-Content -Encoding UTF8` 은 BOM을 넣으므로 쓰지 말 것 |
| **PowerShell 5.1에서 `Invoke-TrustedSigning` 실패** | `TrustedSigning` PowerShell 모듈은 PowerShell 7 기준으로 만들어져 Windows PowerShell 5.1에서 모듈 로드·인증 오류가 납니다. AutoFlow는 이 모듈을 쓰지 않고 **signtool + dlib 을 직접 호출**하므로 5.1에서도 동작합니다 |
| `MsalUiRequiredException`, 400 | 자격 증명 캐시 문제. CI는 환경 변수(서비스 주체)만 쓰도록 `ExcludeCredentials` 를 넣어 둠. 로컬은 `az logout` → `az login` |
| 타임스탬프 오류 | `http://timestamp.acs.microsoft.com` 에 접근 가능한지 확인(회사 프록시). 타임스탬프 없는 서명은 관문에서 실패 처리 |
| **SmartScreen 경고가 계속 뜸** | 서명이 정상이어도 **새 게시자는 평판(reputation)이 쌓일 때까지** 경고가 납니다. Artifact Signing은 평판이 인증서가 아니라 확인된 신원에 쌓이므로 버전이 바뀌어도 이어지지만, 보통 수 주·수백 회 이상의 정상 설치가 필요합니다. 같은 게시자 이름으로 계속 서명하고, 파일을 Microsoft에 제출([Defender 파일 제출](https://www.microsoft.com/wdsi/filesubmission))하면 도움이 됩니다 |
| 릴리스 이름에 `UNSIGNED` | Secrets/Variables 중 하나가 비어 있음. 실행 로그의 "Decide signing mode" 단계에 빠진 이름이 표시됨 |

### 확인 명령
```powershell
Get-AuthenticodeSignature .\AutoFlow_1.2.0_x64-setup.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
signtool verify /pa /v .\AutoFlow_1.2.0_x64-setup.exe
```
`Status : Valid` 이고 `TimeStamperCertificate` 가 비어 있지 않아야 합니다.
