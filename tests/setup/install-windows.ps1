$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('weixin-link-install-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$previous = @{}
foreach ($name in @('WEIXIN_LINK_DIR','WEIXIN_LINK_REF','ZERO_LINK_DIR','ZERO_LINK_REF','PROCESSOR_ARCHITECTURE','TEST_ARCHIVE','UPGRADE_CAPTURE')) { $previous[$name] = [Environment]::GetEnvironmentVariable($name) }
$entry = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\install.ps1'))
$env:TEST_ARCHIVE = Join-Path $fixtureRoot 'fixture.zip'
$env:UPGRADE_CAPTURE = Join-Path $fixtureRoot 'upgraded-target.txt'
# Mutate one shared object: $script: inside mocks resolves to the invoked installer,
# not this fixture's script scope. Keep URL capture and service state visible to both.
$fixtureState = @{ RequestedUrl = ''; Task = $null }
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    $fixtureState.RequestedUrl = $Uri
    Copy-Item -LiteralPath $env:TEST_ARCHIVE -Destination $OutFile
}
function Get-ScheduledTask { param([string]$TaskName, [string]$ErrorAction) return $fixtureState.Task }
function Assert-True($condition, [string]$message) { if (!$condition) { throw $message } }
function Make-Archive([string]$installer, [bool]$complete = $true) {
    $source = Join-Path $fixtureRoot 'zhangjingwei-weixin-link-abc1234'
    if (Test-Path -LiteralPath $source) { Remove-Item -LiteralPath $source -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $source 'src\setup') -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $source 'src\wechat') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $source 'package.json') -Value '{"name":"weixin-link"}' -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $source 'src\setup\windows-install.ps1') -Value $installer -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $source 'src\setup\upgrade.mjs') -Value "import {writeFileSync} from 'node:fs';writeFileSync(process.env.UPGRADE_CAPTURE,process.argv[2])" -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $source 'src\wechat\account-manager.mjs') -Value '// fixture' -Encoding ASCII
    if ($complete) { Set-Content -LiteralPath (Join-Path $source 'src\setup\setup.mjs') -Value '// fixture' -Encoding ASCII }
    Compress-Archive -LiteralPath $source -DestinationPath $env:TEST_ARCHIVE -Force
}
try {
    $env:WEIXIN_LINK_DIR = Join-Path $fixtureRoot 'source with spaces & symbols'
    $env:ZERO_LINK_DIR = Join-Path $fixtureRoot 'unused'
    $env:WEIXIN_LINK_REF = 'main'
    Make-Archive 'Set-Content -LiteralPath (Join-Path $PSScriptRoot "..\..\installed.txt") -Value "installed"; exit 0'
    & $entry
    Assert-True ($fixtureState.RequestedUrl -ceq 'https://api.github.com/repos/zhangjingwei/weixin-link/zipball/main') 'Fresh install did not request the selected ref.'
    Assert-True (Test-Path -LiteralPath (Join-Path $env:WEIXIN_LINK_DIR 'installed.txt')) 'Fresh installer was not executed.'
    $release = Get-Content -LiteralPath (Join-Path $env:WEIXIN_LINK_DIR '.weixin-link-release.json') -Raw | ConvertFrom-Json
    Assert-True ($release.commit -eq 'abc1234' -and $release.ref -eq 'main') 'Installed commit was not recorded.'
    $env:WEIXIN_LINK_REF = 'feature/a b'
    $fixtureState.RequestedUrl = ''
    & $entry
    Assert-True ($fixtureState.RequestedUrl -ceq 'https://api.github.com/repos/zhangjingwei/weixin-link/zipball/feature%2Fa%20b') 'Target ref was not URL-encoded.'
    Assert-True ((Get-Content -LiteralPath $env:UPGRADE_CAPTURE -Raw) -eq $env:WEIXIN_LINK_DIR) 'Existing deployment did not run upgrade.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $env:WEIXIN_LINK_DIR 'installed.txt')).Trim() -eq 'installed') 'Existing source was replaced by bootstrap.'
    $env:WEIXIN_LINK_DIR = Join-Path $fixtureRoot 'other source'
    $fixtureState.Task = [pscustomobject]@{State='Running'}
    $fixtureState.RequestedUrl = ''
    $refused = $false
    try { & $entry } catch { $refused = $_.Exception.Message -like '*WEIXIN_LINK_DIR*' }
    Assert-True $refused 'Registered service without selected source was not refused.'
    Assert-True ($fixtureState.RequestedUrl -eq '') 'Registered service triggered a download.'
    $fixtureState.Task = $null
    New-Item -ItemType Directory -Path $env:WEIXIN_LINK_DIR | Out-Null
    Set-Content -LiteralPath (Join-Path $env:WEIXIN_LINK_DIR 'keep') -Value 'original'
    $refused = $false
    try { & $entry } catch { $refused = $_.Exception.Message -like '*not a supported installation*' }
    Assert-True $refused 'Unknown existing directory was not refused.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $env:WEIXIN_LINK_DIR 'keep')).Trim() -eq 'original') 'Unknown directory changed.'
    Make-Archive 'exit 0' $false
    $env:WEIXIN_LINK_DIR = Join-Path $fixtureRoot 'incomplete'
    $refused = $false
    try { & $entry } catch { $refused = $_.Exception.Message -like '*missing installation files*' }
    Assert-True $refused 'Incomplete archive was accepted.'
    Assert-True (!(Test-Path -LiteralPath $env:WEIXIN_LINK_DIR)) 'Incomplete archive created a destination.'
    Make-Archive 'exit 17'
    $env:WEIXIN_LINK_DIR = Join-Path $fixtureRoot 'failed installer'
    $refused = $false
    try { & $entry } catch { $refused = $_.Exception.Message -like '*INSTALLER_FAILED*17*' }
    Assert-True $refused 'Installer failure was not propagated.'
    $env:PROCESSOR_ARCHITECTURE = 'ARM64'
    $env:WEIXIN_LINK_DIR = Join-Path $fixtureRoot 'unsupported'
    $refused = $false
    try { & $entry } catch { $refused = $_.Exception.Message -like '*Windows x64*' }
    Assert-True $refused 'Unsupported architecture was not refused.'
    Assert-True (@(Get-ChildItem -LiteralPath $fixtureRoot -Force | Where-Object Name -like '.weixin-link-download-*').Count -eq 0) 'Temporary downloads were not cleaned up.'
    Write-Output 'WINDOWS_INSTALL_FIXTURES_OK'
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name]) }
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
}
