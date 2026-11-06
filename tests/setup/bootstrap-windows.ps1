$ErrorActionPreference = 'Stop'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('weixin-link-bootstrap-test-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
$previousNewDest = $env:WEIXIN_LINK_DIR
$previousNewRef = $env:WEIXIN_LINK_REF
$env:WEIXIN_LINK_DIR = $null
$env:WEIXIN_LINK_REF = $null
$previousDest = $env:ZERO_LINK_DIR
$previousRef = $env:ZERO_LINK_REF
$previousArch = $env:PROCESSOR_ARCHITECTURE
$previousFixture = $env:ZERO_LINK_TEST_ARCHIVE
$previousUrl = $env:ZERO_LINK_TEST_REQUESTED_URL
$bootstrapPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\bootstrap.ps1'))
$env:ZERO_LINK_TEST_ARCHIVE = Join-Path $fixtureRoot 'fixture.zip'
$env:ZERO_LINK_TEST_REQUESTED_URL = ''
function Invoke-WebRequest {
    param([switch]$UseBasicParsing, [string]$Uri, [string]$OutFile)
    $env:ZERO_LINK_TEST_REQUESTED_URL = $Uri
    Copy-Item -LiteralPath $env:ZERO_LINK_TEST_ARCHIVE -Destination $OutFile
}
function Assert-True($condition, [string]$message) { if (!$condition) { throw $message } }
function Make-Archive([string]$installer, [bool]$complete = $true) {
    $source = Join-Path $fixtureRoot 'fixture-source'
    if (Test-Path -LiteralPath $source) { Remove-Item -LiteralPath $source -Recurse -Force }
    New-Item -ItemType Directory -Path (Join-Path $source 'src\setup') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $source 'package.json') -Value '{}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $source '.sample') -Value 'included' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $source 'install.ps1') -Value $installer -Encoding UTF8
    if ($complete) { Set-Content -LiteralPath (Join-Path $source 'src\setup\setup.mjs') -Value '// fixture' -Encoding UTF8 }
    Compress-Archive -LiteralPath $source -DestinationPath $env:ZERO_LINK_TEST_ARCHIVE -Force
}
try {
    # The child installer is a fixture: no packages, accounts, services or network are touched.
    Make-Archive 'Set-Content -LiteralPath (Join-Path $PSScriptRoot "installed.txt") -Value "installed"; exit 0'
    $env:ZERO_LINK_DIR = Join-Path $fixtureRoot 'source with spaces & symbols'
    $env:ZERO_LINK_REF = 'feature/a b'
    & $bootstrapPath
    Assert-True (Test-Path -LiteralPath (Join-Path $env:ZERO_LINK_DIR 'installed.txt')) 'Installer was not executed.'
    Assert-True (Test-Path -LiteralPath (Join-Path $env:ZERO_LINK_DIR '.sample')) 'Dotfile was not copied.'
    Assert-True ($env:ZERO_LINK_TEST_REQUESTED_URL.EndsWith('feature%2Fa%20b')) 'Ref was not URL-encoded.'
    $env:WEIXIN_LINK_DIR = Join-Path $fixtureRoot 'preferred source'
    $env:WEIXIN_LINK_REF = 'new/branch'
    & $bootstrapPath
    Assert-True (Test-Path -LiteralPath (Join-Path $env:WEIXIN_LINK_DIR 'installed.txt')) 'New destination did not take precedence.'
    Assert-True ($env:ZERO_LINK_TEST_REQUESTED_URL.EndsWith('new%2Fbranch')) 'New ref did not take precedence.'
    $env:WEIXIN_LINK_DIR = $null
    $env:WEIXIN_LINK_REF = $null
    $refused = $false
    try { & $bootstrapPath } catch { $refused = $_.Exception.Message -like '*already exists*' }
    Assert-True $refused 'Existing installation was not refused.'
    Assert-True ((Get-Content -LiteralPath (Join-Path $env:ZERO_LINK_DIR 'installed.txt')).Trim() -eq 'installed') 'Existing content changed.'
    Make-Archive 'exit 0' $false
    $env:ZERO_LINK_DIR = Join-Path $fixtureRoot 'incomplete'
    $refused = $false
    try { & $bootstrapPath } catch { $refused = $_.Exception.Message -like '*missing installation files*' }
    Assert-True $refused 'Incomplete archive was accepted.'
    Assert-True (!(Test-Path -LiteralPath $env:ZERO_LINK_DIR)) 'Incomplete download reserved destination.'
    Make-Archive 'exit 17'
    $env:ZERO_LINK_DIR = Join-Path $fixtureRoot 'failed-installer'
    $refused = $false
    try { & $bootstrapPath } catch { $refused = $_.Exception.Message -like '*INSTALLER_FAILED*17*' }
    Assert-True $refused 'Installer failure was not propagated.'
    $env:PROCESSOR_ARCHITECTURE = 'ARM64'
    $env:ZERO_LINK_DIR = Join-Path $fixtureRoot 'unsupported'
    $refused = $false
    try { & $bootstrapPath } catch { $refused = $_.Exception.Message -like '*Windows x64*' }
    Assert-True $refused 'Unsupported architecture was not refused.'
    Assert-True (@(Get-ChildItem -LiteralPath $fixtureRoot -Force | Where-Object Name -like '.weixin-link-download-*').Count -eq 0) 'Temporary downloads were not cleaned up.'
    Write-Output 'WINDOWS_BOOTSTRAP_FIXTURES_OK'
} finally {
    $env:WEIXIN_LINK_DIR = $previousNewDest
    $env:WEIXIN_LINK_REF = $previousNewRef
    $env:ZERO_LINK_DIR = $previousDest
    $env:ZERO_LINK_REF = $previousRef
    $env:PROCESSOR_ARCHITECTURE = $previousArch
    $env:ZERO_LINK_TEST_ARCHIVE = $previousFixture
    $env:ZERO_LINK_TEST_REQUESTED_URL = $previousUrl
    Remove-Item -LiteralPath $fixtureRoot -Recurse -Force
}
