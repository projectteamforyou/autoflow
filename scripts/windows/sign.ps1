<#
.SYNOPSIS
  Signs one file with Azure Artifact Signing (formerly Trusted Signing) through signtool + dlib.

.DESCRIPTION
  Tauri calls this for every binary it produces (the main exe before packaging, then the
  NSIS/MSI installers) via bundle.windows.signCommand:
      powershell -NoProfile -ExecutionPolicy Bypass -File C:\afsign\sign.ps1 %1

  Environment (set by CI, or by you for a local signed build):
    AZURE_SIGN_PROFILE   certificate profile name   (missing -> skip signing, exit 0)
    AZURE_SIGN_ACCOUNT   Artifact Signing account name
    AZURE_SIGN_ENDPOINT  account endpoint (default https://krc.codesigning.azure.net/)
    AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET   service principal
                         (or run `az login` locally; the dlib uses DefaultAzureCredential)
    SIGNTOOL             optional full path to signtool.exe

  One-time install (CI does this; locally run from the repo root in an elevated shell):
      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\sign.ps1 -Install
  copies this script to C:\afsign\sign.ps1 and extracts the dlib NuGet package to
  C:\afsign\dlib. The folder has no spaces on purpose (Tauri splits signCommand on spaces).

  Every signature is RFC 3161 timestamped (certificates live ~3 days) and verified right after
  signing; any failure exits non-zero so the build fails instead of shipping unsigned files.
  Compatible with Windows PowerShell 5.1. This file is ASCII-only on purpose.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string]$Path,
    [switch]$Install,
    [switch]$SkipDlib,
    [string]$DlibPackage = 'Microsoft.Trusted.Signing.Client',
    [string]$DlibVersion = '1.0.95'
)

$ErrorActionPreference = 'Stop'

# Launched as Windows PowerShell 5.1 from PowerShell 7 (Tauri's signCommand inside a pwsh CI step), the inherited
# PSModulePath points at PowerShell 7 modules and Microsoft.PowerShell.Security (Get-AuthenticodeSignature) fails to
# load. Use the Windows PowerShell module paths and import it explicitly.
if ($PSVersionTable.PSEdition -eq 'Desktop') {
    $env:PSModulePath = @(
        (Join-Path $env:USERPROFILE 'Documents\WindowsPowerShell\Modules'),
        (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules'),
        (Join-Path $PSHOME 'Modules')
    ) -join ';'
}
Import-Module Microsoft.PowerShell.Security -ErrorAction Stop
Set-StrictMode -Version 2.0

$Root = 'C:\afsign'
$TimestampUrl = 'http://timestamp.acs.microsoft.com'

function Write-Utf8NoBom([string]$File, [string]$Text) {
    [System.IO.File]::WriteAllText($File, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Install-Signing {
    New-Item -ItemType Directory -Force -Path $Root | Out-Null
    Copy-Item -LiteralPath $PSCommandPath -Destination (Join-Path $Root 'sign.ps1') -Force
    Write-Host "Installed $Root\sign.ps1"
    if ($SkipDlib) { return }
    $dest = Join-Path $Root 'dlib'
    $marker = Join-Path $dest '.version'
    # Self-hosted runners keep C:\afsign between jobs: reuse the dlib when the version matches.
    if ((Test-Path (Join-Path $dest 'bin\x64\Azure.CodeSigning.Dlib.dll')) -and (Test-Path $marker) -and ((Get-Content -Raw $marker).Trim() -eq $DlibVersion)) {
        Write-Host "dlib $DlibVersion already installed"
        return
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    # Windows PowerShell's progress bar makes Invoke-WebRequest crawl on large files.
    $ProgressPreference = 'SilentlyContinue'
    $id = $DlibPackage.ToLowerInvariant()
    $url = "https://api.nuget.org/v3-flatcontainer/$id/$DlibVersion/$id.$DlibVersion.nupkg"
    $zip = Join-Path $env:TEMP "$id.$DlibVersion.zip"
    Write-Host "Downloading $DlibPackage $DlibVersion"
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            if ($curl) {
                & $curl.Source -fsSL --retry 3 --retry-delay 5 -o $zip $url
                if ($LASTEXITCODE -ne 0) { throw "curl.exe exited with $LASTEXITCODE" }
            } else {
                Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 300
            }
            break
        } catch {
            if ($attempt -eq 3) { throw }
            Write-Host "Download failed ($($_.Exception.Message)); retrying ($attempt/3)"
            Start-Sleep -Seconds (5 * $attempt)
        }
    }
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
    Remove-Item -Force $zip
    $dll = Join-Path $dest 'bin\x64\Azure.CodeSigning.Dlib.dll'
    if (-not (Test-Path $dll)) { throw "dlib not found after extraction: $dll" }
    Write-Utf8NoBom $marker $DlibVersion
    Write-Host "Installed dlib: $dll"
}

function Find-SignTool {
    if ($env:SIGNTOOL -and (Test-Path $env:SIGNTOOL)) { return $env:SIGNTOOL }
    $kits = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    if (Test-Path $kits) {
        $found = Get-ChildItem -Path $kits -Directory |
            Where-Object { $_.Name -match '^10\.' } |
            Sort-Object { [version]$_.Name } -Descending |
            ForEach-Object { Join-Path $_.FullName 'x64\signtool.exe' } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($found) { return $found }
    }
    $cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw 'signtool.exe not found. Install the Windows 10/11 SDK (10.0.22621 or newer) or set SIGNTOOL.'
}

function Find-Dlib {
    $default = Join-Path $Root 'dlib\bin\x64\Azure.CodeSigning.Dlib.dll'
    if (Test-Path $default) { return $default }
    $any = Get-ChildItem -Path (Join-Path $Root 'dlib') -Recurse -Filter 'Azure.CodeSigning.Dlib.dll' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\x64\\' } | Select-Object -First 1
    if ($any) { return $any.FullName }
    throw "Azure.CodeSigning.Dlib.dll not found under $Root\dlib. Run: sign.ps1 -Install"
}

if ($Install) {
    Install-Signing
    exit 0
}

if (-not $Path) { throw 'Usage: sign.ps1 <file-to-sign>   |   sign.ps1 -Install' }

if (-not $env:AZURE_SIGN_PROFILE) {
    Write-Host "AZURE_SIGN_PROFILE is not set - skipping signing of '$Path' (local / UNSIGNED build)."
    exit 0
}
if (-not $env:AZURE_SIGN_ACCOUNT) { throw 'AZURE_SIGN_ACCOUNT is not set.' }
$endpoint = $env:AZURE_SIGN_ENDPOINT
if (-not $endpoint) { $endpoint = 'https://krc.codesigning.azure.net/' }
if (-not (Test-Path -LiteralPath $Path)) { throw "File to sign not found: $Path" }

$signtool = Find-SignTool
$dlib = Find-Dlib

# metadata.json must be UTF-8 *without* BOM; a BOM breaks the dlib's JSON parser.
$metadata = Join-Path $Root 'metadata.json'
$json = @"
{
  "Endpoint": "$endpoint",
  "CodeSigningAccountName": "$($env:AZURE_SIGN_ACCOUNT)",
  "CertificateProfileName": "$($env:AZURE_SIGN_PROFILE)",
  "CorrelationId": "autoflow-$($env:GITHUB_RUN_ID)",
  "ExcludeCredentials": [
    "ManagedIdentityCredential",
    "WorkloadIdentityCredential",
    "SharedTokenCacheCredential",
    "VisualStudioCredential",
    "VisualStudioCodeCredential",
    "InteractiveBrowserCredential"
  ]
}
"@
Write-Utf8NoBom $metadata $json

$file = (Resolve-Path -LiteralPath $Path).Path
Write-Host "Signing $file"
Write-Host "  signtool: $signtool"
Write-Host "  dlib:     $dlib"
Write-Host "  account:  $($env:AZURE_SIGN_ACCOUNT) / profile: $($env:AZURE_SIGN_PROFILE) @ $endpoint"

$ok = $false
for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
    & $signtool sign /v /fd SHA256 /tr $TimestampUrl /td SHA256 /dlib $dlib /dmdf $metadata $file
    if ($LASTEXITCODE -eq 0) {
        $ok = $true
    } else {
        Write-Warning "signtool failed (exit $LASTEXITCODE), attempt $attempt of 3"
        if ($attempt -lt 3) { Start-Sleep -Seconds (10 * $attempt) }
    }
}
if (-not $ok) {
    Write-Host '::error::Artifact Signing failed. See docs/WINDOWS_SIGNING.md (403 = role, region endpoint, account/profile names or identity validation).'
    exit 1
}

& $signtool verify /pa /v $file
if ($LASTEXITCODE -ne 0) {
    Write-Host "::error::signtool verify failed for $file"
    exit 1
}
$sig = Get-AuthenticodeSignature -LiteralPath $file
if ($sig.Status -ne 'Valid' -or $null -eq $sig.TimeStamperCertificate) {
    Write-Host "::error::$file is not validly signed and timestamped (status: $($sig.Status))."
    exit 1
}
Write-Host "Signed and timestamped: $file ($($sig.SignerCertificate.Subject))"
exit 0
