<#
  AutoFlow — Android 서명 secret 4개를 다시 등록한다 (키는 새로 만들지 않음).
  1) 비밀번호로 키스토어가 실제로 열리는지 PC 에서 먼저 확인
  2) 확인되면 줄바꿈·BOM 없는 임시 파일로 gh secret set (PowerShell 파이프 CRLF 문제 회피)
  키 파일 찾는 순서: -Keystore 경로 → C:\keys\autoflow → 다운로드 폴더(집/사무실 PC 어디서든 USB 로 옮겨 온 경우)
  실행: powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\set-android-secrets.ps1"
  주의: UTF-8 (BOM) + CRLF 로 저장되어야 Windows PowerShell 5.1 에서 한글이 깨지지 않습니다.
#>
param(
  [string]$Keystore = 'C:\keys\autoflow\autoflow-release.jks',
  [string]$Alias = 'autoflow',
  [string]$Repo = 'work517/autoflow'
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
function Fail([string]$m) { Write-Host "[오류] $m" -ForegroundColor Red; Read-Host '엔터를 누르면 닫힙니다'; exit 1 }

# 다운로드 폴더 — 셸 → 레지스트리(User Shell Folders) → OneDrive\Downloads → %USERPROFILE%\Downloads
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

if (-not (Test-Path $Keystore)) {
  $name = Split-Path $Keystore -Leaf
  $fallbacks = @((Join-Path 'C:\keys\autoflow' $name), (Join-Path (Get-DownloadsPath) $name))
  $found = $fallbacks | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $found) { Fail "키 파일이 없습니다: $Keystore (다운로드 폴더 $(Get-DownloadsPath) 에도 $name 없음)" }
  Write-Host "키 파일을 다른 위치에서 찾았습니다: $found" -ForegroundColor Yellow
  $Keystore = $found
}

$kt = $null
if ($env:JAVA_HOME -and (Test-Path (Join-Path $env:JAVA_HOME 'bin\keytool.exe'))) { $kt = Join-Path $env:JAVA_HOME 'bin\keytool.exe' }
if (-not $kt) { $kt = (Get-Command keytool -ErrorAction SilentlyContinue).Source }
if (-not $kt) { $kt = Get-ChildItem 'C:\Program Files\Eclipse Adoptium','C:\Program Files\Java','C:\Program Files\Microsoft','C:\Program Files\Android' -Recurse -Filter keytool.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName }
if (-not $kt) { Fail 'keytool 을 찾을 수 없습니다 (JDK 설치 필요: winget install EclipseAdoptium.Temurin.21.JDK)' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'gh 가 없습니다: winget install GitHub.cli 후 gh auth login' }
Write-Host "키 파일: $Keystore"
Write-Host "keytool: $kt"
Write-Host "저장소: $Repo"

$sec = Read-Host '키를 만들 때 정한 비밀번호 (화면에 표시되지 않음)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $pw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if ($pw -match '[^\x20-\x7E]') { Write-Host '주의: 비밀번호에 영문/숫자/기호 외 문자(한글 등)가 있습니다. 한/영 키 상태를 확인하세요.' -ForegroundColor Yellow }

# 1) PC 에서 먼저 열어 본다 (비밀번호는 명령줄이 아니라 환경변수로 전달)
$env:AF_KS_PASS = $pw
$ErrorActionPreference = 'Continue'
$out = & $kt -list -keystore $Keystore -storepass:env AF_KS_PASS -alias $Alias 2>&1 | Out-String
$code = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Remove-Item Env:AF_KS_PASS -ErrorAction SilentlyContinue
if ($code -ne 0) {
  Write-Host ($out -replace '(?i)storepass\S*', '')
  Fail '이 비밀번호로 키가 열리지 않습니다 (또는 별칭이 다릅니다). 비밀번호(한/영, Caps Lock)를 확인하고 다시 실행하세요. GitHub 에는 아무것도 바꾸지 않았습니다.'
}
Write-Host '확인: 비밀번호로 키가 정상적으로 열립니다.' -ForegroundColor Green

# 2) 줄바꿈·BOM 없는 임시 파일 → cmd 리다이렉트로 gh 에 전달
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($Keystore))
$values = [ordered]@{
  'ANDROID_KEYSTORE_BASE64'   = $b64
  'ANDROID_KEYSTORE_PASSWORD' = $pw
  'ANDROID_KEY_ALIAS'         = $Alias
  'ANDROID_KEY_PASSWORD'      = $pw
}
foreach ($name in $values.Keys) {
  $tmp = [IO.Path]::GetTempFileName()
  try {
    [IO.File]::WriteAllText($tmp, [string]$values[$name], (New-Object Text.UTF8Encoding($false)))
    & cmd.exe /c "gh secret set $name --repo $Repo < `"$tmp`""
    if ($LASTEXITCODE -ne 0) { Fail "gh secret set $name 실패 (gh auth login 상태와 저장소 권한 확인)" }
    Write-Host "  등록됨: $name" -ForegroundColor Green
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}
$pw = $null
Write-Host ''
Write-Host '완료. Claude 에게 "secret 다시 등록했어" 라고 알려 주세요.' -ForegroundColor Cyan
Read-Host '엔터를 누르면 닫힙니다'
