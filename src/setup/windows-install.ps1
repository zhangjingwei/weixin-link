$ErrorActionPreference='Stop'
$setupLocale = if($env:WEIXIN_LINK_LANG){$env:WEIXIN_LINK_LANG}elseif($env:LC_ALL){$env:LC_ALL}else{[cultureinfo]::CurrentUICulture.Name}
$setupEnglish = $setupLocale -match '^en(?:[-_.@]|$)'
if($env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){throw 'Supported: Windows x64'}
# A registered task is an existing deployment, regardless of its source directory.
$existingTask = Get-ScheduledTask -TaskName 'com.wechat-assistant.wechat-ping-bot' -ErrorAction SilentlyContinue
if ($existingTask) {
    if($setupEnglish){Write-Output 'An existing Weixin Link service was found; skipping duplicate installation.';Write-Output "Service state: $($existingTask.State). Send setup-status in WeChat to check. Run the installer again to upgrade."}
    else{Write-Output '检测到已有 Weixin Link 后台服务，跳过重复安装。';Write-Output "服务状态：$($existingTask.State)。请在微信发送「安装状态」检查；升级请重新运行安装命令。"}
    return
}
$env:HOME=[Environment]::GetFolderPath('UserProfile')
$tools=Join-Path $env:HOME '.local\share\wechat-ping-bot\tools'
$node=Join-Path $tools 'node\node.exe'
if(!(Test-Path $node)){$n=Get-Command node.exe -ErrorAction SilentlyContinue;if($n){$node=$n.Source}}
if(!(Test-Path $node) -or [int](& $node -p 'process.versions.node.split(".")[0]') -lt 24){
 $version='v24.21.0';$archive="node-$version-win-x64.zip";$stage=Join-Path $tools ([Guid]::NewGuid().ToString());New-Item $stage -ItemType Directory -Force|Out-Null
 try{
  Invoke-WebRequest "https://nodejs.org/dist/$version/$archive" -OutFile (Join-Path $stage $archive)
  $s=(Invoke-WebRequest "https://nodejs.org/dist/$version/SHASUMS256.txt").Content
  $line=($s -split "`n"|Where-Object {$_ -match "  $([regex]::Escape($archive))\s*$"})
  if(!$line -or (Get-FileHash (Join-Path $stage $archive) -Algorithm SHA256).Hash.ToLower() -ne ($line -split '\s+')[0]){throw 'NODE_CHECKSUM_MISMATCH'}
  Expand-Archive (Join-Path $stage $archive) $stage
  $nodeDir=Join-Path $tools 'node';if(Test-Path $nodeDir){throw 'MANAGED_NODE_EXISTS_REQUIRES_REVIEW'}
  Move-Item (Join-Path $stage "node-$version-win-x64") $nodeDir;$node=Join-Path $nodeDir 'node.exe'
 }finally{Remove-Item $stage -Recurse -Force}
}
$env:PATH=(Split-Path $node)+';'+$env:PATH
# Keep account credentials and control tokens private to this Windows user, SYSTEM and administrators.
$state=Join-Path $env:HOME '.local\share\wechat-ping-bot';New-Item $state -ItemType Directory -Force|Out-Null
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $state /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'|Out-Null
if($LASTEXITCODE -ne 0){throw 'PRIVATE_STATE_ACL_FAILED'}
$sourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $sourceRoot
try{
 foreach($step in @('init','deps')){& $node (Join-Path $sourceRoot 'src/setup/setup.mjs') $step --human;if($LASTEXITCODE -ne 0){throw "SETUP_FAILED_$step"}}
 if(-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected){& $node (Join-Path $sourceRoot 'src/setup/setup.mjs') wizard --human;if($LASTEXITCODE -ne 0){throw 'SETUP_FAILED_wizard'}}
 else{if($setupEnglish){Write-Output 'This terminal is not interactive, so model setup was skipped. Run node src/setup/setup.mjs wizard from the source directory later.'}else{Write-Output '当前终端无法交互，已跳过模型设置。稍后可在源码目录运行 node src/setup/setup.mjs wizard。'}}
 foreach($step in @('services','wechat-login')){& $node (Join-Path $sourceRoot 'src/setup/setup.mjs') $step --human;if($LASTEXITCODE -ne 0){throw "SETUP_FAILED_$step"}}
}finally{Pop-Location}
