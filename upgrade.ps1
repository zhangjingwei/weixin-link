$ErrorActionPreference = 'Stop'
$upgradeHome = [Environment]::GetFolderPath('UserProfile')
$upgradeTarget = if ($env:WEIXIN_LINK_DIR) { $env:WEIXIN_LINK_DIR } elseif ($env:ZERO_LINK_DIR) { $env:ZERO_LINK_DIR } else { Join-Path $upgradeHome '.local\share\weixin-link\source' }
$upgradeRef = if ($env:WEIXIN_LINK_REF) { $env:WEIXIN_LINK_REF } else { 'main' }
$upgradeNode = Join-Path $upgradeHome '.local\share\wechat-ping-bot\tools\node\node.exe'
if (!(Test-Path -LiteralPath $upgradeNode)) { $upgradeNode = (Get-Command node.exe -ErrorAction Stop).Source }
& $upgradeNode -e 'process.exit(Number(process.versions.node.split(String.fromCharCode(46))[0])>=24?0:1)'
if ($LASTEXITCODE -ne 0) { throw '升级需要 Node.js 24 或更新版本。' }
if (!(Test-Path -LiteralPath $upgradeTarget -PathType Container)) { throw '未找到已安装的源码目录，请通过 WEIXIN_LINK_DIR 指定。' }
$env:PATH = (Split-Path $upgradeNode) + ';' + $env:PATH
$upgradeTemp = Join-Path ([IO.Path]::GetTempPath()) ('weixin-upgrade-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $upgradeTemp | Out-Null
try {
    Write-Output '下载升级版本…'
    $archive = Join-Path $upgradeTemp 'source.zip'
    Invoke-WebRequest -UseBasicParsing -Uri ('https://api.github.com/repos/zhangjingwei/weixin-link/zipball/' + [Uri]::EscapeDataString($upgradeRef)) -OutFile $archive
    $expanded = Join-Path $upgradeTemp 'source'
    Expand-Archive -LiteralPath $archive -DestinationPath $expanded
    $roots = @(Get-ChildItem -LiteralPath $expanded -Directory)
    if ($roots.Count -ne 1) { throw '升级包目录结构异常。' }
    & $upgradeNode (Join-Path $roots[0].FullName 'src\setup\upgrade.mjs') $upgradeTarget
    if ($LASTEXITCODE -ne 0) { throw '升级未完成，请查看上面的诊断与恢复记录。' }
} finally { Remove-Item -LiteralPath $upgradeTemp -Recurse -Force }
