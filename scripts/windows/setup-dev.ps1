<#
.SYNOPSIS
  AutoFlow 개발 환경 준비 (집/회사 PC 공통). Downloads 폴더에서 바로 실행하세요.

.DESCRIPTION
  1) 다운로드 폴더를 PC마다 정확히 찾습니다 (Known Folder → USERPROFILE\Downloads 순).
  2) C:\code\autoflow 가 없으면 git clone, 있으면 원격이 더 최신일 때 git pull 합니다.
  3) Node 22 / pnpm / Rust 가 없으면 winget 으로 설치를 제안합니다.
  4) pnpm install → core/web 빌드 → 테스트를 실행합니다.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\setup-dev.ps1"
#>
[CmdletBinding()]
param(
  [string]$Repo = "https://github.com/work517/autoflow.git",
  [string]$Branch = "main",
  [string]$CodeRoot = "C:\code",
  [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

function Get-DownloadsFolder {
  try {
    $sig = '[DllImport("shell32.dll")] public static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);'
    $t = Add-Type -MemberDefinition $sig -Name KnownFolders -Namespace AutoFlow -PassThru -ErrorAction SilentlyContinue
    $p = [IntPtr]::Zero
    if ($t::SHGetKnownFolderPath([Guid]"374DE290-123F-4565-9164-39C4925E467B", 0, [IntPtr]::Zero, [ref]$p) -eq 0) {
      $path = [Runtime.InteropServices.Marshal]::PtrToStringUni($p)
      [Runtime.InteropServices.Marshal]::FreeCoTaskMem($p)
      if (Test-Path $path) { return $path }
    }
  } catch { }
  return (Join-Path $env:USERPROFILE "Downloads")
}

function Need($cmd, $wingetId) {
  if (Get-Command $cmd -ErrorAction SilentlyContinue) { return }
  Write-Host "[$cmd] 이(가) 없습니다. winget 으로 $wingetId 를 설치합니다..." -ForegroundColor Yellow
  winget install -e --id $wingetId --accept-source-agreements --accept-package-agreements
  $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
}

$downloads = Get-DownloadsFolder
Write-Host "다운로드 폴더: $downloads" -ForegroundColor Cyan

Need git "Git.Git"
Need node "OpenJS.NodeJS.LTS"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { corepack enable; corepack prepare pnpm@9.15.0 --activate }

New-Item -ItemType Directory -Force $CodeRoot | Out-Null
$dir = Join-Path $CodeRoot "autoflow"
if (-not (Test-Path (Join-Path $dir ".git"))) {
  Write-Host "새로 받습니다: $Repo → $dir" -ForegroundColor Cyan
  git clone --branch $Branch $Repo $dir
} else {
  Push-Location $dir
  git fetch origin $Branch
  $local = git rev-parse HEAD
  $remote = git rev-parse "origin/$Branch"
  $base = git merge-base HEAD "origin/$Branch"
  if ($local -eq $remote) { Write-Host "이미 최신입니다 ($($local.Substring(0,7)))." -ForegroundColor Green }
  elseif ($local -eq $base) { Write-Host "서버가 더 최신입니다 → pull" -ForegroundColor Cyan; git pull --ff-only origin $Branch }
  else { Write-Host "로컬에 서버에 없는 커밋이 있습니다. 직접 확인하세요 (git status)." -ForegroundColor Yellow }
  Pop-Location
}

Push-Location $dir
pnpm install
pnpm --filter @autoflow/core build
pnpm --filter @autoflow/web build
if (-not $SkipTests) { pnpm --filter @autoflow/core test }
Pop-Location

Write-Host ""
Write-Host "완료. 개발 서버:  cd $dir ; pnpm --filter @autoflow/web dev   →  http://localhost:5173" -ForegroundColor Green
Write-Host "Windows 앱 빌드:  cd $dir\apps\desktop ; pnpm tauri build   (Rust 필요: winget install Rustlang.Rustup)" -ForegroundColor Green
