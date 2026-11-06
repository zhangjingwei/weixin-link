$ErrorActionPreference='Stop'
if($env:PROCESSOR_ARCHITECTURE -ne 'AMD64'){throw 'Supported: Windows x64'}
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
Push-Location $PSScriptRoot
try{foreach($step in @('init','deps','services','pair','qr')){& $node (Join-Path $PSScriptRoot 'src/setup/setup.mjs') $step --human;if($LASTEXITCODE -ne 0){throw "SETUP_FAILED_$step"}}}finally{Pop-Location}
