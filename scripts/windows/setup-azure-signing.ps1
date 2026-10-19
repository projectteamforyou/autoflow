<#
.SYNOPSIS
  AutoFlow Windows 코드 서명(Azure Artifact Signing) 1회 설정 도우미.

.DESCRIPTION
  저장소 소유자가 한 번만 실행합니다. 순서:
    1. az / gh 로그인 확인, 구독 선택
    2. Microsoft.CodeSigning 공급자 등록, az 'trustedsigning' 확장 설치
    3. 리소스 그룹 + Artifact Signing 계정 생성 (기본: rg-signing / koreacentral)
    4. 로그인한 사용자에게 "Artifact Signing Identity Verifier" 역할 부여
       (역할 GUID 4339b7cf-9826-4e41-b4ed-c7f4505dac08)
    5. [일시 정지] Azure Portal에서 신원 확인(Identity validation) → Completed 대기
    6. 인증서 프로필(Public Trust) 생성
    7. CI용 서비스 주체 "sp-autoflow-signing-ci" 생성 → 프로필 범위에
       "Artifact Signing Certificate Profile Signer" 역할 부여
    8. GitHub Secrets(AZURE_CLIENT_ID / AZURE_TENANT_ID / AZURE_CLIENT_SECRET)와
       Variables(AZURE_SIGN_ENDPOINT / AZURE_SIGN_ACCOUNT / AZURE_SIGN_PROFILE) 설정

  비밀 값은 화면에 출력하지 않으며, 임시 파일(끝 줄바꿈 없음)을 거쳐 gh에 전달한 뒤 즉시 지웁니다.
  Windows PowerShell 5.1 / PowerShell 7 모두에서 동작합니다.

  사용법 (집/회사 PC 어디서나 같은 방법):
    1) 이 파일을 '다운로드' 폴더에 복사
    2) PowerShell에서:
         cd (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path
         powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-azure-signing.ps1
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-signing',
    [string]$Account = 'ultarineosigning',
    [string]$Profile = '',
    [string]$Location = 'koreacentral',
    [string]$Repo = 'work517/autoflow',
    [string]$ServicePrincipal = 'sp-autoflow-signing-ci',
    [string]$Subscription = '',
    # 확인 질문 없이 진행 (일부 터미널에서 Read-Host 프롬프트가 보이지 않는 문제 대응)
    [switch]$Yes,
    # 신원 확인 ID를 미리 넘길 때 (기존 Active 프로필이 없을 때만 필요)
    [string]$ValidationId = ''
)

$ErrorActionPreference = 'Stop'
$IdentityVerifierRoleId = '4339b7cf-9826-4e41-b4ed-c7f4505dac08'

function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Info([string]$Text) { Write-Host "    $Text" }
# 질문을 먼저 Write-Host 로 출력하고 콘솔에서 한 줄을 읽습니다 (Read-Host 프롬프트가 안 보이는 터미널 대응).
function Ask([string]$Text) {
    Write-Host ''
    Write-Host "$Text " -ForegroundColor Yellow -NoNewline
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { return '' }
    return $line.Trim()
}
function Fail([string]$Text) { Write-Host "[오류] $Text" -ForegroundColor Red; exit 1 }

function Get-DownloadsFolder {
    try {
        $p = (New-Object -ComObject Shell.Application).Namespace('shell:Downloads').Self.Path
        if ($p -and (Test-Path $p)) { return $p }
    } catch { }
    return (Join-Path $env:USERPROFILE 'Downloads')
}

# az 호출: 표준 출력만 값으로 쓰고(경고가 ID에 섞이지 않게), 실패하면 stderr를 보여 주고 중단.
# Windows PowerShell 5.1은 $ErrorActionPreference='Stop'에서 네이티브 stderr를 예외로 바꾸므로
# 함수 안에서는 'Continue'로 둡니다.
function Invoke-AzRaw {
    $ErrorActionPreference = 'Continue'
    $errFile = [System.IO.Path]::GetTempFileName()
    try {
        $out = & az @args 2>$errFile
        $code = $LASTEXITCODE
        $err = Get-Content -Raw -LiteralPath $errFile -ErrorAction SilentlyContinue
    } finally {
        Remove-Item -Force -LiteralPath $errFile -ErrorAction SilentlyContinue
    }
    return [pscustomobject]@{ Code = $code; Out = (($out | Out-String).Trim()); Err = $err }
}
function Invoke-Az {
    $r = Invoke-AzRaw @args
    if ($r.Code -ne 0) { Fail ("az " + ($args -join ' ') + " 실패:`n" + $r.Err) }
    return $r.Out
}
function Try-Az {
    $r = Invoke-AzRaw @args
    if ($r.Code -ne 0) { return $null }
    return $r.Out
}

# 비밀 값을 끝 줄바꿈 없는 임시 파일로 만들어 cmd 리디렉션으로 gh에 전달 (명령줄/화면에 노출 안 됨)
function Set-GhSecret([string]$Name, [string]$Value) {
    $ErrorActionPreference = 'Continue'
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($tmp, $Value, (New-Object System.Text.UTF8Encoding($false)))
        & cmd.exe /c "gh secret set $Name --repo $Repo < `"$tmp`""
        if ($LASTEXITCODE -ne 0) { Fail "gh secret set $Name 실패" }
        Info "Secret $Name 설정 완료 (값은 표시하지 않음)"
    } finally {
        if (Test-Path $tmp) {
            [System.IO.File]::WriteAllText($tmp, (' ' * 64))
            Remove-Item -Force $tmp
        }
    }
}
function Set-GhVariable([string]$Name, [string]$Value) {
    $ErrorActionPreference = 'Continue'
    & gh variable set $Name --repo $Repo --body $Value | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail "gh variable set $Name 실패" }
    Info "Variable $Name = $Value"
}

# ---------------------------------------------------------------- 0. 위치 확인
$downloads = Get-DownloadsFolder
Step "작업 폴더: $downloads"
if ((Resolve-Path .).Path -ne (Resolve-Path $downloads).Path) {
    Info "현재 위치가 '다운로드' 폴더가 아닙니다. '다운로드' 폴더로 이동해서 진행합니다."
    Set-Location $downloads
}

# ---------------------------------------------------------------- 1. 도구와 로그인
Step '1/8 az, gh 확인'
if (-not (Get-Command az -ErrorAction SilentlyContinue)) { Fail 'Azure CLI가 없습니다: winget install -e --id Microsoft.AzureCLI  (설치 후 새 PowerShell 창에서 다시 실행)' }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI가 없습니다: winget install -e --id GitHub.cli  (설치 후 새 PowerShell 창에서 다시 실행)' }
if (-not (Try-Az account show --query id -o tsv)) {
    Info 'Azure에 로그인합니다 (브라우저 창이 열립니다).'
    $r = Invoke-AzRaw login
    if ($r.Code -ne 0) { Fail ('az login 실패: ' + $r.Err) }
}
if ($Subscription) { Invoke-Az account set --subscription $Subscription | Out-Null }
$subId = Invoke-Az account show --query id -o tsv
$subName = Invoke-Az account show --query name -o tsv
$tenantId = Invoke-Az account show --query tenantId -o tsv
Info "구독: $subName ($subId)"
Info 'GitHub 로그인 확인 중...'
# 'gh auth status' 출력 리디렉션은 Windows PowerShell 5.1 에서 멈출 수 있어, 토큰 조회로 확인합니다 (대화형 프롬프트 없음).
$ErrorActionPreference = 'Continue'
$env:GH_PROMPT_DISABLED = '1'
$ghToken = (& gh auth token --hostname github.com 2>$null | Out-String).Trim()
$ghOk = ($LASTEXITCODE -eq 0 -and $ghToken.Length -gt 0)
$ghToken = $null
Remove-Item Env:GH_PROMPT_DISABLED -ErrorAction SilentlyContinue
$ErrorActionPreference = 'Stop'
if ($ghOk) { Info 'GitHub 로그인 확인됨.' }
if (-not $ghOk) {
    Info 'GitHub에 로그인합니다.'
    & gh auth login --web --scopes repo
    if ($LASTEXITCODE -ne 0) { Fail 'gh auth login 실패' }
}
if ($Yes) {
    Info "구독 '$subName' / 저장소 '$Repo' 로 진행합니다 (-Yes)."
} else {
    $answer = Ask "구독 '$subName' 에 리소스를 만들고 저장소 '$Repo' 에 Secrets를 설정합니다. 계속할까요? (y/N)"
    if ($answer -notmatch '^(y|yes|예|ㅇ)$') { Fail '사용자가 취소했습니다.' }
}

# ---------------------------------------------------------------- 2. 공급자와 확장
Step '2/8 Microsoft.CodeSigning 공급자 등록, trustedsigning 확장 설치'
Info '공급자 등록 중... (처음이면 1~3분 걸릴 수 있습니다)'
Invoke-Az provider register --namespace Microsoft.CodeSigning --wait | Out-Null
Invoke-Az extension add --name trustedsigning --upgrade --only-show-errors | Out-Null
Info '완료'

# ---------------------------------------------------------------- 3. 리소스 그룹과 계정
# 이미 있는 서명 계정(예: ultarineosigning)은 어느 리소스 그룹에 있든 찾아서 그대로 씁니다.
$foundRg = Try-Az resource list --resource-type Microsoft.CodeSigning/codeSigningAccounts --name $Account --query "[0].resourceGroup" -o tsv
if ($foundRg) { $ResourceGroup = $foundRg; Info "기존 서명 계정 '$Account' 를 리소스 그룹 '$ResourceGroup' 에서 찾았습니다." }
Step "3/8 리소스 그룹 '$ResourceGroup' / 서명 계정 '$Account' ($Location)"
if (-not $foundRg) { Invoke-Az group create --name $ResourceGroup --location $Location --only-show-errors | Out-Null }
$accountId = Try-Az trustedsigning show --name $Account --resource-group $ResourceGroup --query id -o tsv
if (-not $accountId) {
    Invoke-Az trustedsigning create --name $Account --resource-group $ResourceGroup --location $Location --sku Basic --only-show-errors | Out-Null
    $accountId = Invoke-Az trustedsigning show --name $Account --resource-group $ResourceGroup --query id -o tsv
    Info '계정을 만들었습니다 (Basic SKU, 월 요금 발생).'
} else {
    Info '이미 있는 계정을 사용합니다.'
}
$endpoint = Try-Az trustedsigning show --name $Account --resource-group $ResourceGroup --query properties.accountUri -o tsv
if (-not $endpoint) { $endpoint = 'https://krc.codesigning.azure.net/' }
if (-not $endpoint.EndsWith('/')) { $endpoint = $endpoint + '/' }
Info "Endpoint: $endpoint"

# ---------------------------------------------------------------- 4. Identity Verifier 역할
Step '4/8 로그인한 사용자에게 Artifact Signing Identity Verifier 역할 부여'
$me = Invoke-Az ad signed-in-user show --query id -o tsv
$existing = Try-Az role assignment list --assignee $me --role $IdentityVerifierRoleId --scope $accountId --query "[0].id" -o tsv
if (-not $existing) {
    Invoke-Az role assignment create --assignee-object-id $me --assignee-principal-type User --role $IdentityVerifierRoleId --scope $accountId --only-show-errors | Out-Null
    Info '역할을 부여했습니다 (반영까지 몇 분 걸릴 수 있음).'
} else {
    Info '이미 역할이 있습니다.'
}

# 계정에 이미 Active 인증서 프로필이 있으면 그것을 쓰고 신원 확인 단계를 건너뜁니다.
$existingProfile = ''
if (-not $Profile) {
    $existingProfile = Try-Az trustedsigning certificate-profile list --account-name $Account --resource-group $ResourceGroup --query "[?properties.status=='Active'] | [0].name" -o tsv
    if ($existingProfile) { $Profile = $existingProfile; Info "기존 Active 프로필 '$Profile' 을 사용합니다." } else { $Profile = 'autoflow-public' }
}
$profileId = Try-Az trustedsigning certificate-profile show --account-name $Account --resource-group $ResourceGroup --name $Profile --query id -o tsv

# ---------------------------------------------------------------- 5. 신원 확인 (포털)
if (-not $profileId) {
    Step '5/8 [직접 할 일] Azure Portal에서 신원 확인'
    Info "1) https://portal.azure.com → '$Account' (Artifact Signing 계정) → Identity validations"
    Info '2) + New identity → Public → 회사/개인 정보 입력 → 제출'
    Info '3) 상태가 Completed 가 될 때까지 기다립니다 (수 시간~수 일, 메일로 서류 요청이 올 수 있음).'
    Info '4) Completed 된 항목의 Identity validation Id(GUID)를 복사합니다.'
} else {
    Step '5/8 신원 확인 — 기존 프로필이 있어 건너뜁니다'
}
$validationId = $ValidationId
if ($profileId) { Info '프로필이 이미 있으므로 신원 확인 입력을 건너뜁니다.'; $validationId = '00000000-0000-0000-0000-000000000000' }
while ($validationId -notmatch '^[0-9a-fA-F-]{36}$') {
    $validationId = Ask 'Completed 된 Identity validation Id를 붙여 넣으세요 (나중에 하려면 Ctrl+C 후 이 스크립트를 다시 실행):'
}

# ---------------------------------------------------------------- 6. 인증서 프로필
Step "6/8 인증서 프로필 '$Profile' (PublicTrust)"
if (-not $profileId) {
    Invoke-Az trustedsigning certificate-profile create --account-name $Account --resource-group $ResourceGroup --name $Profile --profile-type PublicTrust --identity-validation-id $validationId --only-show-errors | Out-Null
    $profileId = Invoke-Az trustedsigning certificate-profile show --account-name $Account --resource-group $ResourceGroup --name $Profile --query id -o tsv
    Info '프로필을 만들었습니다.'
} else {
    Info '이미 있는 프로필을 사용합니다.'
}

# ---------------------------------------------------------------- 7. 서비스 주체 + Signer 역할
Step "7/8 CI 서비스 주체 '$ServicePrincipal' + Certificate Profile Signer 역할"
# 이름이 같은 앱이 있으면 비밀번호를 새로 발급합니다 (기존 비밀번호는 무효화).
$spJson = Invoke-Az ad sp create-for-rbac --name $ServicePrincipal --only-show-errors -o json
$sp = $spJson | ConvertFrom-Json
$clientId = $sp.appId
$clientSecret = $sp.password
$spJson = $null
$sp = $null
$spObjectId = Invoke-Az ad sp show --id $clientId --query id -o tsv
$signerRole = Try-Az role definition list --name 'Artifact Signing Certificate Profile Signer' --query "[0].name" -o tsv
if (-not $signerRole) { $signerRole = Try-Az role definition list --name 'Trusted Signing Certificate Profile Signer' --query "[0].name" -o tsv }
if (-not $signerRole) { Fail 'Certificate Profile Signer 역할 정의를 찾지 못했습니다.' }
Info "역할 GUID: $signerRole"
$hasRole = Try-Az role assignment list --assignee $spObjectId --role $signerRole --scope $profileId --query "[0].id" -o tsv
if (-not $hasRole) {
    $assigned = $false
    for ($i = 1; $i -le 6 -and -not $assigned; $i++) {
        $r = Invoke-AzRaw role assignment create --assignee-object-id $spObjectId --assignee-principal-type ServicePrincipal --role $signerRole --scope $profileId --only-show-errors
        if ($r.Code -eq 0) { $assigned = $true } else { Info "서비스 주체 전파 대기 중... ($i/6)"; Start-Sleep -Seconds 10 }
    }
    if (-not $assigned) { Fail '역할 부여 실패. 몇 분 뒤 스크립트를 다시 실행하세요.' }
}
Info '역할 부여 완료 (프로필 범위)'

# ---------------------------------------------------------------- 8. GitHub Secrets / Variables
Step "8/8 GitHub '$Repo' Secrets / Variables"
Set-GhSecret 'AZURE_CLIENT_ID' $clientId
Set-GhSecret 'AZURE_TENANT_ID' $tenantId
Set-GhSecret 'AZURE_CLIENT_SECRET' $clientSecret
$clientSecret = $null
Set-GhVariable 'AZURE_SIGN_ENDPOINT' $endpoint
Set-GhVariable 'AZURE_SIGN_ACCOUNT' $Account
Set-GhVariable 'AZURE_SIGN_PROFILE' $Profile

Step '완료'
Info "이제 태그를 푸시하면 (예: git tag v1.0.0; git push origin v1.0.0) GitHub Actions 'windows' 워크플로가"
Info '서명된 설치 파일을 만들고, 서명 검증 관문을 통과해야만 릴리스를 게시합니다.'
Info '서비스 주체 비밀번호는 보통 1년 뒤 만료됩니다. 만료 전에 이 스크립트를 다시 실행하면 갱신됩니다.'
