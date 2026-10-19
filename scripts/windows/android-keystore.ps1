<#
  AutoFlow — Android 릴리스(업로드) 키스토어 생성 도우미
  Creates the Android release/upload keystore and prepares the GitHub secrets.

  실행 방법 (PowerShell, 다운로드 폴더에 이 파일을 둔 경우):
    powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\android-keystore.ps1"
  (다운로드 폴더 위치를 바꿨거나 OneDrive 로 옮겼다면, 파일 탐색기에서 이 파일을 Shift+우클릭 → "경로로 복사" 한 경로를 쓰세요.)

  결과물:
    C:\keys\autoflow\autoflow-release.jks             (키스토어 — 절대 git 에 넣지 마세요)
    C:\keys\autoflow\autoflow-release.jks.base64.txt  (GitHub secret ANDROID_KEYSTORE_BASE64 값)

  집/사무실 PC 를 번갈아 쓰는 경우:
    업로드 키는 "하나"여야 합니다. 다른 PC 에서 이미 만들었다면 그 .jks 를 USB 등으로 이 PC 의 다운로드 폴더나
    KeyDir 에 복사한 뒤 실행하세요. 스크립트가 찾아서 KeyDir 로 옮겨 쓰고, 새 키를 만들지 않습니다.

  주의: 이 파일은 UTF-8 (BOM) + CRLF 로 저장되어야 Windows PowerShell 5.1 에서 한글이 깨지지 않습니다.
#>
param(
  [string]$KeyDir = 'C:\keys\autoflow',
  [string]$KeystoreName = 'autoflow-release.jks',
  [string]$Alias = 'autoflow',
  [string]$Repo = 'work517/autoflow',
  [string]$DName = 'CN=AutoFlow, OU=ProjectTeamForYou, O=ProjectTeamForYou, L=Seoul, C=KR'  # no '+': keytool reads it as an RDN separator
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$SecretsUrl = "https://github.com/$Repo/settings/secrets/actions"

function Write-Step([string]$msg) { Write-Host ''; Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host $msg -ForegroundColor Yellow }
function Fail([string]$msg) { Write-Host ''; Write-Host "[오류] $msg" -ForegroundColor Red; exit 1 }

# 다운로드 폴더 — 집/사무실 PC 마다 위치가 다를 수 있음(D: 드라이브로 이동, OneDrive 백업, 회사 정책 리디렉션).
# 1) Windows 셸이 아는 실제 경로  2) 레지스트리(User Shell Folders, %USERPROFILE% 확장)  3) OneDrive\Downloads  4) 기본값
function Get-DownloadsPath {
  $candidates = @()
  try {
    $p = (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path
    if ($p) { $candidates += $p }
  } catch {}
  try {
    $reg = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop
    $v = $reg.'{374DE290-123F-4565-9164-39C4925E467B}'
    if ($v) { $candidates += [Environment]::ExpandEnvironmentVariables($v) }
  } catch {}
  if ($env:OneDrive) { $candidates += (Join-Path $env:OneDrive 'Downloads') }
  $candidates += (Join-Path $env:USERPROFILE 'Downloads')
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return (Join-Path $env:USERPROFILE 'Downloads')
}

function Find-Keytool {
  $candidates = @()
  if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
  $cmd = Get-Command keytool -ErrorAction SilentlyContinue
  if ($cmd) { $candidates += $cmd.Source }
  foreach ($root in @("$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java", "$env:ProgramFiles\Microsoft", "$env:ProgramFiles\Android\Android Studio\jbr", "$env:LOCALAPPDATA\Programs\Eclipse Adoptium")) {
    if (Test-Path $root) {
      $candidates += @(Get-ChildItem -Path $root -Filter keytool.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
    }
  }
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

function ConvertTo-PlainText([Security.SecureString]$s) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Read-NewPassword {
  while ($true) {
    $p1 = ConvertTo-PlainText (Read-Host '키스토어 비밀번호 입력 (6자 이상, 화면에 표시되지 않음) / keystore password' -AsSecureString)
    if ($p1.Length -lt 6) { Write-Warn '비밀번호는 6자 이상이어야 합니다. 다시 입력하세요.'; continue }
    if ($p1 -notmatch '^[\x21-\x7E]+$' -or $p1.Contains('"')) { Write-Warn '영문/숫자/기호(ASCII)만 쓰고, 공백과 큰따옴표(")는 빼세요. (한/영 키 상태 확인) 다시 입력하세요.'; continue }
    $p2 = ConvertTo-PlainText (Read-Host '비밀번호 한 번 더 입력 / confirm' -AsSecureString)
    if ($p1 -ne $p2) { Write-Warn '두 비밀번호가 다릅니다. 다시 입력하세요.'; continue }
    return $p1
  }
}

function Show-BackupWarning {
  Write-Host ''
  Write-Host '################################################################################' -ForegroundColor Red
  Write-Host '#  [매우 중요] 키스토어 파일과 비밀번호를 반드시 백업하세요!                      #' -ForegroundColor Red
  Write-Host '#  - USB, 암호화된 클라우드(비공개), 비밀번호 관리자 등 두 곳 이상에 보관하세요.   #' -ForegroundColor Red
  Write-Host '#  - Play 앱 서명을 쓰면 이 키는 "업로드 키"라서, 잃어버려도 Play Console 에서     #' -ForegroundColor Red
  Write-Host '#    재설정을 요청할 수 있습니다. (설정 → 앱 무결성 → 업로드 키 재설정)           #' -ForegroundColor Red
  Write-Host '#  - 다른 PC 에서 출시할 때도 같은 .jks 를 쓰세요. 새로 만들면 업로드가 거부됩니다. #' -ForegroundColor Red
  Write-Host '#  - 절대 git 저장소, 이메일, 메신저, 채팅에 올리지 마세요.                       #' -ForegroundColor Red
  Write-Host '#                                                                              #' -ForegroundColor Red
  Write-Host '#  [VERY IMPORTANT] BACK UP the keystore file AND its password (2+ places).     #' -ForegroundColor Red
  Write-Host '#  Use the SAME .jks on every PC. Never commit it, mail it or paste it in chat. #' -ForegroundColor Red
  Write-Host '################################################################################' -ForegroundColor Red
  Write-Host ''
}

$downloads = Get-DownloadsPath
Write-Host 'AutoFlow Android 릴리스(업로드) 키스토어 생성기' -ForegroundColor Green
Write-Host "다운로드 폴더: $downloads"
Write-Host "PC 이름: $env:COMPUTERNAME"

# 1) keytool 확인 -------------------------------------------------------------
Write-Step 'keytool (JDK) 확인'
$keytool = Find-Keytool
if (-not $keytool) {
  Write-Host 'keytool 을 찾을 수 없습니다. JDK 가 필요합니다. / keytool not found, a JDK is required.' -ForegroundColor Red
  Write-Host ''
  Write-Host '설치 방법 (관리자 권한 없이도 대부분 동작):'
  Write-Host '  winget install EclipseAdoptium.Temurin.21.JDK' -ForegroundColor White
  Write-Host '설치 후 PowerShell 창을 새로 열고 이 스크립트를 다시 실행하세요.'
  Write-Host '(winget 이 없으면 https://adoptium.net/temurin/releases/?version=21 에서 Windows x64 JDK .msi 를 받으세요.)'
  exit 1
}
Write-Host "keytool: $keytool"

# 2) 출력 폴더 — git 저장소 밖이어야 함 ---------------------------------------
Write-Step "키 보관 폴더 준비: $KeyDir"
$fullKeyDir = [IO.Path]::GetFullPath($KeyDir)
$probe = $fullKeyDir
while ($probe) {
  if (Test-Path (Join-Path $probe '.git')) {
    Fail "키 폴더가 git 저장소($probe) 안에 있습니다. 저장소 밖의 폴더를 -KeyDir 로 지정하세요. (예: C:\keys\autoflow)"
  }
  $parent = Split-Path $probe -Parent
  if (-not $parent -or $parent -eq $probe) { break }
  $probe = $parent
}
if (-not (Test-Path $fullKeyDir)) { New-Item -ItemType Directory -Path $fullKeyDir -Force | Out-Null }

$keystorePath = Join-Path $fullKeyDir $KeystoreName
$base64Path = "$keystorePath.base64.txt"

# 2b) 다른 PC 에서 만든 키를 다운로드 폴더로 가져온 경우: KeyDir 로 옮겨 그 키를 씀 (업로드 키는 하나!)
if (-not (Test-Path $keystorePath)) {
  $imported = Join-Path $downloads $KeystoreName
  if (Test-Path $imported) {
    Write-Warn "다운로드 폴더에서 기존 키를 찾았습니다: $imported"
    Write-Warn "새 키를 만들지 않고 이 키를 $keystorePath 로 옮겨 사용합니다."
    Move-Item -Path $imported -Destination $keystorePath
  }
}

# 3) 기존 키스토어는 절대 덮어쓰지 않음 ----------------------------------------
$password = $null
if (Test-Path $keystorePath) {
  Write-Warn "이미 키스토어가 있습니다: $keystorePath"
  Write-Warn '덮어쓰지 않습니다. 기존 키로 GitHub secret 값만 다시 준비합니다. / Existing keystore kept (never overwritten).'
  $password = ConvertTo-PlainText (Read-Host '기존 키스토어 비밀번호 입력 / existing keystore password' -AsSecureString)
  $env:AF_KS_PASS = $password
  try {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $keytool -list -keystore $keystorePath -storepass:env AF_KS_PASS -alias $Alias 2>&1 | Out-Null
    $ok = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prevEap
    if (-not $ok) { Fail "비밀번호가 틀렸거나 별칭 '$Alias' 이(가) 없습니다. (한/영, Caps Lock 확인)" }
  } finally { Remove-Item Env:AF_KS_PASS -ErrorAction SilentlyContinue }
} else {
  # 4) 새 키스토어 생성 ------------------------------------------------------
  Write-Step '새 키스토어 생성 (RSA 4096, 유효기간 10000일)'
  Write-Host '참고: 최신 JDK 의 PKCS12 키스토어는 키 비밀번호가 키스토어 비밀번호와 같아야 합니다.'
  Write-Host '      그래서 비밀번호를 한 번만 받고 두 곳에 똑같이 사용합니다.'
  $password = Read-NewPassword
  $env:AF_KS_PASS = $password
  try {
    & $keytool -genkeypair -v `
      -keystore $keystorePath -storetype PKCS12 `
      -alias $Alias -keyalg RSA -keysize 4096 -validity 10000 `
      -dname $DName `
      -storepass:env AF_KS_PASS -keypass:env AF_KS_PASS
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $keystorePath)) { Fail 'keytool 이 키스토어를 만들지 못했습니다. (DName 에 + 기호가 있으면 빼세요)' }
  } finally { Remove-Item Env:AF_KS_PASS -ErrorAction SilentlyContinue }
  Write-Host "생성 완료: $keystorePath" -ForegroundColor Green
}

# 5) base64 텍스트 파일 (BOM·줄바꿈 없음) ---------------------------------------
Write-Step 'GitHub secret 용 base64 파일 작성'
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath))
[IO.File]::WriteAllText($base64Path, $b64, (New-Object Text.UTF8Encoding($false)))
Write-Host "작성 완료: $base64Path"

Show-BackupWarning

# 6) GitHub secret 안내 --------------------------------------------------------
Write-Step 'GitHub Actions secret 등록 (4개)'
Write-Host "등록 위치: $SecretsUrl" -ForegroundColor White
Write-Host ''
Write-Host '  이름                          값'
Write-Host '  ----------------------------  ---------------------------------------------'
Write-Host "  ANDROID_KEYSTORE_BASE64       $base64Path 파일 내용 전체"
Write-Host '  ANDROID_KEYSTORE_PASSWORD     방금 입력한 비밀번호'
Write-Host "  ANDROID_KEY_ALIAS             $Alias"
Write-Host '  ANDROID_KEY_PASSWORD          방금 입력한 비밀번호 (키스토어 비밀번호와 동일)'
Write-Host ''

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
  $loggedIn = $false
  # PS 5.1: 네이티브 stderr 리디렉션이 Stop 모드에서 예외가 되므로 잠시 Continue 로 전환
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & gh auth status 2>&1 | Out-Null
    $loggedIn = ($LASTEXITCODE -eq 0)
  } catch { $loggedIn = $false } finally { $ErrorActionPreference = $prevEap }
  if ($loggedIn) {
    $answer = Read-Host "gh CLI 로 위 4개 secret 을 $Repo 에 지금 등록할까요? (Y/N)"
    if ($answer -match '^[Yy]') {
      $secrets = [ordered]@{
        'ANDROID_KEYSTORE_BASE64'   = $b64
        'ANDROID_KEYSTORE_PASSWORD' = $password
        'ANDROID_KEY_ALIAS'         = $Alias
        'ANDROID_KEY_PASSWORD'      = $password
      }
      foreach ($name in $secrets.Keys) {
        # 값은 명령줄 인자가 아니라 표준입력으로 전달 (프로세스 목록에 노출 방지).
        # PowerShell 5.1 의 파이프는 끝에 CRLF 를 붙이므로, 줄바꿈·BOM 없는 임시 파일을 cmd 리다이렉트로 넘긴다.
        $tmp = [IO.Path]::GetTempFileName()
        try {
          [IO.File]::WriteAllText($tmp, [string]$secrets[$name], (New-Object Text.UTF8Encoding($false)))
          & cmd.exe /c "gh secret set $name --repo $Repo < `"$tmp`""
        } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
        if ($LASTEXITCODE -ne 0) { Fail "gh secret set $name 실패. 위 URL 에서 직접 등록하세요." }
        Write-Host "  등록됨: $name" -ForegroundColor Green
      }
    } else {
      Write-Host '건너뜀. 위 URL 에서 직접 등록하거나 set-android-secrets.ps1 을 쓰세요.'
    }
  } else {
    Write-Host 'gh CLI 가 로그인되어 있지 않습니다 (gh auth login). 위 URL 에서 직접 등록하세요.'
  }
} else {
  Write-Host 'gh CLI 가 없으므로 위 URL 에서 직접 등록하세요. (선택: winget install GitHub.cli)'
}

$password = $null
Write-Host ''
Write-Host '다음 단계: docs/PLAY_RELEASE.md 를 따라 Play Console 설정과 PLAY_SERVICE_ACCOUNT_JSON 을 등록하세요.' -ForegroundColor Green
Write-Host "base64 파일($base64Path)은 secret 등록 후 삭제해도 됩니다 (.jks 원본은 꼭 백업!)."
