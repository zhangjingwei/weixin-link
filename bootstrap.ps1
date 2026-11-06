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
    throw 'An earlier installation exists under .local\share\zero-link\source; inspect it before installing again.'
}
if (Get-Item -LiteralPath $bootstrapDest -Force -ErrorAction SilentlyContinue) {
    throw "Installation directory already exists: $bootstrapDest. Inspect it or choose another WEIXIN_LINK_DIR."
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
