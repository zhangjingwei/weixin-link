# Download Weixin Link into a persistent directory, then run its Windows installer.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'Supported: Windows x64. Linux/macOS: use bootstrap.sh.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$bootstrapHome = [Environment]::GetFolderPath('UserProfile')
$bootstrapRef = if ($env:WEIXIN_LINK_REF) { $env:WEIXIN_LINK_REF } elseif ($env:ZERO_LINK_REF) { $env:ZERO_LINK_REF } else { 'main' }
$bootstrapDest = if ($env:WEIXIN_LINK_DIR) { $env:WEIXIN_LINK_DIR } elseif ($env:ZERO_LINK_DIR) { $env:ZERO_LINK_DIR } else { Join-Path $bootstrapHome '.local\share\weixin-link\source' }
$bootstrapDest = [IO.Path]::GetFullPath($bootstrapDest)
if (!$env:WEIXIN_LINK_DIR -and !$env:ZERO_LINK_DIR -and (Get-Item -LiteralPath (Join-Path $bootstrapHome '.local\share\zero-link\source') -Force -ErrorAction SilentlyContinue)) {
    if (Get-Item -LiteralPath $bootstrapDest -Force -ErrorAction SilentlyContinue) { throw 'Multiple source directories exist; select one with WEIXIN_LINK_DIR.' }
    $bootstrapDest = Join-Path $bootstrapHome '.local\share\zero-link\source'
}
$bootstrapExisting = Get-Item -LiteralPath $bootstrapDest -Force -ErrorAction SilentlyContinue
if ($bootstrapExisting) {
    if (!$bootstrapExisting.PSIsContainer -or ($bootstrapExisting.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation directory already exists but is not a supported installation.' }
    foreach ($bootstrapRequired in @('package.json', 'src\wechat\account-manager.mjs', 'src\setup\setup.mjs')) {
        if (!(Test-Path -LiteralPath (Join-Path $bootstrapDest $bootstrapRequired) -PathType Leaf)) { throw 'Installation directory already exists but is not a supported installation.' }
    }
    $bootstrapPackage = Get-Content -LiteralPath (Join-Path $bootstrapDest 'package.json') -Raw | ConvertFrom-Json
    if ($bootstrapPackage.name -notin @('weixin-link', 'wechat-ping-bot')) { throw 'Unrecognized existing source directory.' }
    $bootstrapNode = Join-Path $bootstrapHome '.local\share\wechat-ping-bot\tools\node\node.exe'
    if (!(Test-Path -LiteralPath $bootstrapNode)) { $bootstrapNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue; if (!$bootstrapNodeCommand) { throw 'Existing installation needs Node.js 24+ before pairing can resume.' }; $bootstrapNode = $bootstrapNodeCommand.Source }
    & $bootstrapNode -e 'process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=24?0:1)'
    if ($LASTEXITCODE -ne 0) { throw 'Existing installation needs Node.js 24+ before pairing can resume.' }
    $bootstrapManager = Join-Path $bootstrapDest 'src\wechat\account-manager.mjs'
    $bootstrapAccounts = & $bootstrapNode $bootstrapManager list
    if ($LASTEXITCODE -ne 0) { throw 'ACCOUNT_STATUS_FAILED' }
    $bootstrapAccount = (($bootstrapAccounts | Out-String | ConvertFrom-Json).accounts | Where-Object account -eq 'default' | Select-Object -First 1)
    if (!$bootstrapAccount) { throw 'DEFAULT_ACCOUNT_NOT_FOUND' }
    if ($bootstrapAccount.ready) { Write-Output '微信已登录，请发送「安装状态」继续配置。'; return }
    if ($bootstrapAccount.service_active) { throw 'The account service is running but not ready; inspect its status before re-pairing.' }
    Write-Output '检测到已有安装，正在刷新微信登录二维码…'
    # Older installed sources do not understand --human; format their JSON here.
    $bootstrapQrOutput = & $bootstrapNode $bootstrapManager refresh-qr default
    if ($LASTEXITCODE -ne 0) { throw '无法刷新二维码，请稍后重试。错误代码：QR_REFRESH_FAILED' }
    $bootstrapQr = $bootstrapQrOutput | Out-String | ConvertFrom-Json
    if (!$bootstrapQr.ok -or $bootstrapQr.status -ne 'scan_to_login' -or !$bootstrapQr.path -or !(Test-Path -LiteralPath $bootstrapQr.path -PathType Leaf)) { throw '二维码图片不可用，请重试。错误代码：QR_IMAGE_UNAVAILABLE' }
    Write-Output "✓ 登录二维码已刷新。`n请用微信扫描 PNG 图片：`n$($bootstrapQr.path)"
    if (!$env:SSH_CONNECTION -and !$env:SSH_CLIENT -and !$env:SSH_TTY -and [Environment]::UserInteractive -and ![Console]::IsOutputRedirected) {
        try { Start-Process -FilePath $bootstrapQr.path -ErrorAction Stop; Write-Output '已打开二维码图片，请及时扫码。' }
        catch { Write-Output '无法自动打开图片，请手动打开上面的 PNG 文件。' }
    }
    Write-Output '扫码并在手机上确认后，请在微信发送「安装状态」继续配置。'
    return
}
$bootstrapParent = Split-Path -Parent $bootstrapDest
New-Item -ItemType Directory -Path $bootstrapParent -Force | Out-Null
$bootstrapTemp = Join-Path $bootstrapParent ('.weixin-link-download-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $bootstrapTemp | Out-Null
try {
    $bootstrapArchive = Join-Path $bootstrapTemp 'source.zip'
    $bootstrapUrl = 'https://api.github.com/repos/zhangjingwei/weixin-link/zipball/' + [Uri]::EscapeDataString($bootstrapRef)
    Invoke-WebRequest -UseBasicParsing -Uri $bootstrapUrl -OutFile $bootstrapArchive
    $bootstrapExpanded = Join-Path $bootstrapTemp 'expanded'
    Expand-Archive -LiteralPath $bootstrapArchive -DestinationPath $bootstrapExpanded
    $bootstrapRoots = @(Get-ChildItem -LiteralPath $bootstrapExpanded -Force)
    if ($bootstrapRoots.Count -ne 1 -or !$bootstrapRoots[0].PSIsContainer) {
        throw 'Downloaded archive has an unexpected layout.'
    }
    $bootstrapSource = $bootstrapRoots[0].FullName
    foreach ($bootstrapRequired in @('install.ps1', 'package.json', 'src\setup\setup.mjs')) {
        if (!(Test-Path -LiteralPath (Join-Path $bootstrapSource $bootstrapRequired) -PathType Leaf)) {
            throw 'Downloaded archive is missing installation files.'
        }
    }
    # Reserve the destination without replacing another installation.
    New-Item -ItemType Directory -Path $bootstrapDest | Out-Null
    Get-ChildItem -LiteralPath $bootstrapSource -Force | Copy-Item -Destination $bootstrapDest -Recurse -Force
    $bootstrapShell = Join-Path $PSHOME 'powershell.exe'
    if (!(Test-Path -LiteralPath $bootstrapShell)) { $bootstrapShell = Join-Path $PSHOME 'pwsh.exe' }
    # Bypass applies only to this installer process; no persistent policy change.
    & $bootstrapShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bootstrapDest 'install.ps1')
    if ($LASTEXITCODE -ne 0) { throw "INSTALLER_FAILED: exit code $LASTEXITCODE" }
} finally {
    Remove-Item -LiteralPath $bootstrapTemp -Recurse -Force -ErrorAction SilentlyContinue
}
