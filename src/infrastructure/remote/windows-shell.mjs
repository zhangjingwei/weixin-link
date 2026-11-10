import {win32} from 'node:path'

const quote=value=>"'"+value.replaceAll("'","''")+"'"
export const powershell=script=>'powershell.exe -NoProfile -NonInteractive -EncodedCommand '+Buffer.from(script,'utf16le').toString('base64')

export function windowsDirectory(path){
 const root=win32.parse(path).root,parts=win32.relative(root,path).split(win32.sep).filter(Boolean),paths=[root]
 let current=root
 for(const part of parts){current=win32.join(current,part);paths.push(current)}
 return powershell(`$ErrorActionPreference='Stop'; try { foreach($p in @(${paths.map(quote).join(',')})) { $item=Get-Item -LiteralPath $p -Force; if(-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { exit 3 } } } catch { exit 3 }`)
}

export function windowsRead(path){
 return powershell(`$ErrorActionPreference='Stop'; try { $p=${quote(path)}; $item=Get-Item -LiteralPath $p -Force; if($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)) { exit 3 }; $file=[IO.File]::OpenRead($p); try { $out=[Console]::OpenStandardOutput(); $file.CopyTo($out); $out.Flush() } finally { $file.Dispose() } } catch { exit 3 }`)
}

export function windowsExists(path){return powershell(`if(Test-Path -LiteralPath ${quote(path)}) { exit 0 } else { exit 1 }`)}

export function windowsWrite(path){
 return powershell(`$ErrorActionPreference='Stop'; try { $file=[IO.File]::Open(${quote(path)},[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None); try { [Console]::OpenStandardInput().CopyTo($file) } finally { $file.Dispose() } } catch { exit 3 }`)
}

export function windowsExec(project){
 // The user command stays on stdin; only this fixed wrapper appears in process arguments.
 return powershell(`$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Console]::OutputEncoding; Set-Location -LiteralPath ${quote(project)}; $reader=[IO.StreamReader]::new([Console]::OpenStandardInput(),[Text.UTF8Encoding]::new($false)); $script=$reader.ReadToEnd(); Invoke-Expression $script; if(-not $?) { if($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }; if($LASTEXITCODE) { exit $LASTEXITCODE }`)
}
