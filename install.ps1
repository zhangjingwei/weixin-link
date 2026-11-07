# Install or upgrade a standard Windows deployment from one PowerShell entry.
$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'Supported: Windows x64. Linux/macOS: use install.sh.'
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
    if (!(Test-Path -LiteralPath $bootstrapNode)) { $bootstrapNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue; if (!$bootstrapNodeCommand) { throw 'Existing installation needs Node.js 24+ before upgrading.' }; $bootstrapNode = $bootstrapNodeCommand.Source }
    & $bootstrapNode -e 'process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=24?0:1)'
    if ($LASTEXITCODE -ne 0) { throw 'Existing installation needs Node.js 24+ before upgrading.' }
} elseif (Get-ScheduledTask -TaskName 'com.wechat-assistant.wechat-ping-bot' -ErrorAction SilentlyContinue) {
    throw '检测到已有后台服务，但所选源码目录不存在。请用 WEIXIN_LINK_DIR 指定原目录；未创建新安装。'
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
    foreach ($bootstrapRequired in @('src\setup\windows-install.ps1', 'package.json', 'src\setup\setup.mjs')) {
        if (!(Test-Path -LiteralPath (Join-Path $bootstrapSource $bootstrapRequired) -PathType Leaf)) {
            throw 'Downloaded archive is missing installation files.'
        }
    }
    if ($bootstrapRef -eq 'main' -and $bootstrapRoots[0].Name -match '^zhangjingwei-weixin-link-([0-9a-f]{7,40})$') {
        $bootstrapRelease = @{version=1; repository='zhangjingwei/weixin-link'; ref='main'; commit=$Matches[1]} | ConvertTo-Json -Compress
        [IO.File]::WriteAllText((Join-Path $bootstrapSource '.weixin-link-release.json'), $bootstrapRelease + "`n", (New-Object Text.UTF8Encoding($false)))
    }
    if ($bootstrapExisting) {
        if (!(Test-Path -LiteralPath (Join-Path $bootstrapSource 'src\setup\upgrade.mjs') -PathType Leaf)) { throw '该版本不支持升级。' }
        $env:PATH = (Split-Path -Parent $bootstrapNode) + ';' + $env:PATH
        Write-Output '下载升级版本完成，正在检查已安装服务…'
        & $bootstrapNode (Join-Path $bootstrapSource 'src\setup\upgrade.mjs') $bootstrapDest
        if ($LASTEXITCODE -ne 0) { throw '升级未完成，请查看上面的诊断与恢复记录。' }
        return
    }
    # Reserve the destination without replacing another installation.
    New-Item -ItemType Directory -Path $bootstrapDest | Out-Null
    Get-ChildItem -LiteralPath $bootstrapSource -Force | Copy-Item -Destination $bootstrapDest -Recurse -Force
    $bootstrapShell = Join-Path $PSHOME 'powershell.exe'
    if (!(Test-Path -LiteralPath $bootstrapShell)) { $bootstrapShell = Join-Path $PSHOME 'pwsh.exe' }
    # Bypass applies only to this installer process; no persistent policy change.
    & $bootstrapShell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $bootstrapDest 'src\setup\windows-install.ps1')
    if ($LASTEXITCODE -ne 0) { throw "INSTALLER_FAILED: exit code $LASTEXITCODE" }
} finally {
    Remove-Item -LiteralPath $bootstrapTemp -Recurse -Force -ErrorAction SilentlyContinue
}
