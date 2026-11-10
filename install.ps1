# Install or upgrade a standard Windows deployment from one PowerShell entry.
$ErrorActionPreference = 'Stop'
$bootstrapLocale = if($env:WEIXIN_LINK_LANG){$env:WEIXIN_LINK_LANG}elseif($env:LC_ALL){$env:LC_ALL}else{[cultureinfo]::CurrentUICulture.Name}
$bootstrapEnglish = $bootstrapLocale -match '^en(?:[-_.@]|$)'
if ([Environment]::OSVersion.Platform -ne 'Win32NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw 'Supported: Windows x64. Linux/macOS: use install.sh.'
}
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$bootstrapHome = [Environment]::GetFolderPath('UserProfile')
$bootstrapDest = if ($env:WEIXIN_LINK_DIR) { $env:WEIXIN_LINK_DIR } elseif ($env:ZERO_LINK_DIR) { $env:ZERO_LINK_DIR } else { Join-Path $bootstrapHome '.local\share\weixin-link\source' }
$bootstrapDest = [IO.Path]::GetFullPath($bootstrapDest)
if (!$env:WEIXIN_LINK_DIR -and !$env:ZERO_LINK_DIR -and (Get-Item -LiteralPath (Join-Path $bootstrapHome '.local\share\zero-link\source') -Force -ErrorAction SilentlyContinue)) {
    if (Get-Item -LiteralPath $bootstrapDest -Force -ErrorAction SilentlyContinue) { throw 'Multiple source directories exist; select one with WEIXIN_LINK_DIR.' }
    $bootstrapDest = Join-Path $bootstrapHome '.local\share\zero-link\source'
}
$bootstrapExisting = Get-Item -LiteralPath $bootstrapDest -Force -ErrorAction SilentlyContinue
if ($bootstrapExisting) {
    if (!$bootstrapExisting.PSIsContainer -or ($bootstrapExisting.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Installation directory already exists but is not a supported installation.' }
    foreach ($bootstrapRequired in @('package.json', 'src\setup\setup.mjs')) {
        if (!(Test-Path -LiteralPath (Join-Path $bootstrapDest $bootstrapRequired) -PathType Leaf)) { throw 'Installation directory already exists but is not a supported installation.' }
    }
    if (!(Test-Path -LiteralPath (Join-Path $bootstrapDest 'src\setup\account-manager.mjs') -PathType Leaf) -and !(Test-Path -LiteralPath (Join-Path $bootstrapDest 'src\wechat\account-manager.mjs') -PathType Leaf)) { throw 'Installation directory already exists but is not a supported installation.' }
    $bootstrapPackage = Get-Content -LiteralPath (Join-Path $bootstrapDest 'package.json') -Raw | ConvertFrom-Json
    if ($bootstrapPackage.name -notin @('weixin-link', 'wechat-ping-bot')) { throw 'Unrecognized existing source directory.' }
    $bootstrapNode = Join-Path $bootstrapHome '.local\share\wechat-ping-bot\tools\node\node.exe'
    if (!(Test-Path -LiteralPath $bootstrapNode)) { $bootstrapNodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue; if (!$bootstrapNodeCommand) { throw 'Existing installation needs Node.js 24+ before upgrading.' }; $bootstrapNode = $bootstrapNodeCommand.Source }
    & $bootstrapNode -e 'process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=24?0:1)'
    if ($LASTEXITCODE -ne 0) { throw 'Existing installation needs Node.js 24+ before upgrading.' }
} elseif (Get-ScheduledTask -TaskName 'com.wechat-assistant.wechat-ping-bot' -ErrorAction SilentlyContinue) {
    if($bootstrapEnglish){throw 'A background service exists but the selected source directory is missing. Set WEIXIN_LINK_DIR to the original source; no new installation was created.'}else{throw '检测到已有后台服务，但所选源码目录不存在。请用 WEIXIN_LINK_DIR 指定原目录；未创建新安装。'}
}
if ($bootstrapExisting -and -not [Console]::IsInputRedirected) {
    if($bootstrapEnglish){Write-Output 'Existing installation found. Choose: 1 Upgrade  2 Configure model  3 Log in to WeChat again  4 Add WeChat account  0 Exit'}
    else{Write-Output '检测到已有安装。请选择：1 升级  2 配置模型  3 重新登录微信  4 添加微信账号  0 退出'}
    $choice = Read-Host $(if($bootstrapEnglish){'Choice'}else{'输入序号'})
    if($choice -eq '0'){return}
    if($choice -notin @('1','2','3','4')){throw 'INVALID_INSTALL_CHOICE'}
    if($choice -ne '1'){
        if(!(Test-Path -LiteralPath (Join-Path $bootstrapDest 'src\setup\account-manager.mjs') -PathType Leaf)){throw 'UPGRADE_REQUIRED_FOR_MENU'}
        $account = 'default'
        if($choice -eq '4'){
            $account = Read-Host $(if($bootstrapEnglish){'New account name (lowercase letters, digits, hyphens)'}else{'新账号名称（小写字母、数字、连字符）'})
            if($account -cnotmatch '^[a-z][a-z0-9-]{0,31}$' -or $account -eq 'default'){throw 'INVALID_ACCOUNT_ID'}
        }
        $env:HOME = $bootstrapHome
        $env:PATH = (Split-Path -Parent $bootstrapNode) + ';' + $env:PATH
        Push-Location $bootstrapDest
        try{
            if($choice -eq '2'){& $bootstrapNode 'src/setup/setup.mjs' wizard $account --human}
            if($choice -eq '3'){& $bootstrapNode 'src/setup/setup.mjs' wechat-login --relogin $account --human}
            if($choice -eq '4'){
                & $bootstrapNode 'src/setup/account-manager.mjs' create $account --human
                if($LASTEXITCODE -ne 0){throw 'ACCOUNT_CREATE_FAILED'}
                & $bootstrapNode 'src/setup/setup.mjs' wizard $account --human
                if($LASTEXITCODE -ne 0){throw 'SETUP_FAILED_wizard'}
                & $bootstrapNode 'src/setup/setup.mjs' wechat-login $account --human
            }
            if($LASTEXITCODE -ne 0){throw 'SETUP_FAILED'}
        }finally{Pop-Location}
        return
    }
}
$bootstrapRef = if ($env:WEIXIN_LINK_REF) { $env:WEIXIN_LINK_REF } elseif ($env:ZERO_LINK_REF) { $env:ZERO_LINK_REF } else { 'latest' }
if ($bootstrapRef -eq 'latest') {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/zhangjingwei/weixin-link/releases/latest'
    if ($release.draft -or $release.prerelease -or $release.tag_name -cnotmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') { throw 'No stable release available.' }
    $bootstrapRef = $release.tag_name
}
$bootstrapStable = $bootstrapRef -cmatch '^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'
$bootstrapExpected = $env:WEIXIN_LINK_EXPECTED_COMMIT
if ($bootstrapExpected -and ($bootstrapExpected -cnotmatch '^[0-9a-f]{40}$')) { throw 'Invalid expected commit.' }
$bootstrapDownloadRef = if ($bootstrapExpected) { $bootstrapExpected } else { $bootstrapRef }
$bootstrapParent = Split-Path -Parent $bootstrapDest
New-Item -ItemType Directory -Path $bootstrapParent -Force | Out-Null
$bootstrapTemp = Join-Path $bootstrapParent ('.weixin-link-download-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $bootstrapTemp | Out-Null
try {
    $bootstrapArchive = Join-Path $bootstrapTemp 'source.zip'
    $bootstrapUrl = 'https://api.github.com/repos/zhangjingwei/weixin-link/zipball/' + [Uri]::EscapeDataString($bootstrapDownloadRef)
    Invoke-WebRequest -UseBasicParsing -Uri $bootstrapUrl -OutFile $bootstrapArchive
    $bootstrapExpanded = Join-Path $bootstrapTemp 'expanded'
    Expand-Archive -LiteralPath $bootstrapArchive -DestinationPath $bootstrapExpanded
    $bootstrapRoots = @(Get-ChildItem -LiteralPath $bootstrapExpanded -Force)
    if ($bootstrapRoots.Count -ne 1 -or !$bootstrapRoots[0].PSIsContainer) {
        throw 'Downloaded archive has an unexpected layout.'
    }
    $bootstrapSource = $bootstrapRoots[0].FullName
    if ($bootstrapExpected) {
        if ($bootstrapRoots[0].Name -cnotmatch '^zhangjingwei-weixin-link-([0-9a-f]{7,40})$') { throw 'Downloaded commit could not be verified.' }
        if (!$bootstrapExpected.StartsWith($Matches[1], [StringComparison]::Ordinal)) { throw 'Downloaded commit differs from requested commit.' }
    }
    foreach ($bootstrapRequired in @('src\setup\windows-install.ps1', 'package.json', 'src\setup\setup.mjs')) {
        if (!(Test-Path -LiteralPath (Join-Path $bootstrapSource $bootstrapRequired) -PathType Leaf)) {
            throw 'Downloaded archive is missing installation files.'
        }
    }
    if ($bootstrapStable) {
        $package = Get-Content -LiteralPath (Join-Path $bootstrapSource 'package.json') -Raw | ConvertFrom-Json
        if ('v' + $package.version -cne $bootstrapRef) { throw 'Release tag and package version differ.' }
    }
    if (($bootstrapRef -eq 'main' -or $bootstrapStable) -and $bootstrapRoots[0].Name -match '^zhangjingwei-weixin-link-([0-9a-f]{7,40})$') {
        $bootstrapRelease = @{version=1; repository='zhangjingwei/weixin-link'; ref=$bootstrapRef; commit=$Matches[1]} | ConvertTo-Json -Compress
        [IO.File]::WriteAllText((Join-Path $bootstrapSource '.weixin-link-release.json'), $bootstrapRelease + "`n", (New-Object Text.UTF8Encoding($false)))
    }
    if ($bootstrapExisting) {
        if (!(Test-Path -LiteralPath (Join-Path $bootstrapSource 'src\setup\upgrade.mjs') -PathType Leaf)) { if($bootstrapEnglish){throw 'This release does not support upgrades.'}else{throw '该版本不支持升级。'} }
        $env:PATH = (Split-Path -Parent $bootstrapNode) + ';' + $env:PATH
        if($bootstrapEnglish){Write-Output 'Upgrade source downloaded. Checking the installed service…'}else{Write-Output '下载升级版本完成，正在检查已安装服务…'}
        & $bootstrapNode (Join-Path $bootstrapSource 'src\setup\upgrade.mjs') $bootstrapDest
        if ($LASTEXITCODE -ne 0) { if($bootstrapEnglish){throw 'Upgrade did not finish. Check the diagnostics and recovery record above.'}else{throw '升级未完成，请查看上面的诊断与恢复记录。'} }
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
