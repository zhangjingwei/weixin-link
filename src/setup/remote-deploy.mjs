#!/usr/bin/env node
// Deployment only: shared config, SSH and official RPC; no task runner or supervisor.
import {spawn} from 'node:child_process'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {HOSTS} from '../remote/remote-config.mjs'
import {RemoteRpc} from '../infrastructure/agents/remote-rpc.mjs'
import {sshConfig} from '../remote/remote-config.mjs'
export function windowsDeployment(config){
 if(config.platform!=='win32'||config.transport!=='ssh-websocket'||!Number.isInteger(config.port)||config.port<1024||config.port>65535||typeof config.binary!=='string'||! /^[A-Za-z]:[\\/]/.test(config.binary)||/[\r\n\0]/.test(config.binary))throw Error('INVALID_WINDOWS_DEPLOY_CONFIG')
 const data=Buffer.from(JSON.stringify({binary:config.binary,port:config.port})).toString('base64')
 return `$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$config=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
if(!(Test-Path -LiteralPath $config.binary -PathType Leaf)){throw 'CODEX_BINARY_NOT_FOUND'}
$version=(& $config.binary --version | Out-String).Trim(); if($LASTEXITCODE -ne 0){throw 'CODEX_VERSION_FAILED'}
$ErrorActionPreference='Continue'; $login=(& $config.binary login status 2>&1 | Out-String); $loginExit=$LASTEXITCODE; $ErrorActionPreference='Stop'; if($loginExit -ne 0){throw 'CODEX_LOGIN_REQUIRED'}
$dir=Join-Path $env:USERPROFILE '.codex\\wechat-adapter'
$ps=Join-Path $dir 'start-server.ps1'; $vbs=Join-Path $dir 'hidden-server.vbs'; $taskName='WeChatCodexAdapter'
$task=Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$user=[Security.Principal.WindowsIdentity]::GetCurrent().Name
if($task){
 $oldAction=@($task.Actions); if($oldAction.Count -ne 1 -or ($oldAction[0].Arguments -notlike ('*'+$ps+'*') -and $oldAction[0].Arguments -notlike ('*'+$vbs+'*'))){throw 'SCHEDULED_TASK_OWNERSHIP_UNCONFIRMED'}
 $sid=New-Object Security.Principal.NTAccount($user); $sid=$sid.Translate([Security.Principal.SecurityIdentifier]).Value
 if($task.Principal.UserId -notin @($user,$env:USERNAME,$sid)){throw 'SCHEDULED_TASK_USER_MISMATCH'}
 if($task.Principal.LogonType -ne 'Interactive'){throw 'SCHEDULED_TASK_LOGON_MISMATCH'}
}
$listener=@(Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue)
$listenerPid=$null
if($listener.Count){
 if($listener.Count -ne 1 -or $listener[0].LocalAddress -ne '127.0.0.1'){throw 'PORT_BINDING_CONFLICT'}
 $listenerPid=[int]$listener[0].OwningProcess; $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$listenerPid)
 if($proc.CommandLine -notlike ('*app-server*ws://127.0.0.1:'+ $config.port+'*')){throw 'PORT_OWNER_UNCONFIRMED'}
 $owner=Invoke-CimMethod -InputObject $proc -MethodName GetOwner
 if($owner.ReturnValue -ne 0 -or $owner.User -ne $env:USERNAME){throw 'LISTENER_USER_MISMATCH'}
}
# Do not retarget an existing running instance or create a duplicate if the configured port changes.
if($task -and $task.State -eq 'Running' -and !$listener.Count){throw 'RUNNING_TASK_WITHOUT_EXPECTED_LISTENER'}
$binaryLiteral="'"+$config.binary.Replace("'","''")+"'"
$psText='& '+$binaryLiteral+' app-server --listen ws://127.0.0.1:'+$config.port
$vbsText='Set shell = CreateObject("WScript.Shell")'+"\r\n"+'shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -File ""'+$ps+'""", 0, True'
$changed=$false
New-Item -ItemType Directory -Force $dir | Out-Null
foreach($entry in @(@($ps,$psText),@($vbs,$vbsText))){
 if(!(Test-Path -LiteralPath $entry[0]) -or [IO.File]::ReadAllText($entry[0]) -ne $entry[1]){[IO.File]::WriteAllText($entry[0],$entry[1],(New-Object Text.UTF8Encoding($false))); $changed=$true}
}
$exe=Join-Path $env:WINDIR 'System32\\wscript.exe'; $arguments='//B //Nologo "'+$vbs+'"'
$action=New-ScheduledTaskAction -Execute $exe -Argument $arguments
if(!$task){
 $principal=New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
 $trigger=New-ScheduledTaskTrigger -AtLogOn -User $user
 $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
 Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description 'Official Codex app-server on localhost for WeChat SSH adapter' | Out-Null
 $changed=$true
}elseif($task.Actions[0].Execute -ne $exe -or $task.Actions[0].Arguments -ne $arguments){
 Set-ScheduledTask -TaskName $taskName -Action $action | Out-Null; $changed=$true
}
$started=$false
if(!$listener.Count){
 Start-ScheduledTask -TaskName $taskName; $started=$true
 for($i=0;$i -lt 40;$i++){Start-Sleep -Milliseconds 250; $listener=@(Get-NetTCPConnection -State Listen -LocalPort $config.port -ErrorAction SilentlyContinue); if($listener.Count){break}}
 if(!$listener.Count){throw 'APP_SERVER_NOT_LISTENING_USER_LOGON_MAY_BE_REQUIRED'}
 if($listener.Count -ne 1 -or $listener[0].LocalAddress -ne '127.0.0.1'){throw 'PORT_BINDING_CONFLICT'}
 $listenerPid=[int]$listener[0].OwningProcess
}
@{version=$version;task=$taskName;changed=$changed;started=$started;restarted=$false;listenerPid=$listenerPid;hidden=$true;port=$config.port} | ConvertTo-Json -Compress
`
}
export function runSsh(host,script){
 if(!Object.hasOwn(HOSTS,host)||!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(host))throw Error('UNKNOWN_HOST')
 const encoded=Buffer.from(script,'utf16le').toString('base64')
 const runner=Buffer.from("& ([scriptblock]::Create([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))))",'utf16le').toString('base64')
 return new Promise((resolve,reject)=>{
  const child=spawn('ssh',['-F',sshConfig,'-o','BatchMode=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3',host,'powershell -NoProfile -NonInteractive -EncodedCommand '+runner],{stdio:['pipe','pipe','pipe']});let output='',stderr='';const timer=setTimeout(()=>{child.kill();reject(Error('DEPLOY_RESULT_UNCERTAIN_CHECK_BEFORE_RETRY'))},60000)
  child.stdin.on('error',()=>{});child.stdin.end(encoded)
  child.stdout.on('data',d=>{output+=d;if(output.length>65536){child.kill();clearTimeout(timer);reject(Error('DEPLOY_OUTPUT_LIMIT'))}});child.stderr.on('data',d=>{if(stderr.length<65536)stderr+=d});child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',code=>{clearTimeout(timer);if(code!==0){const known=stderr.match(/(?:CODEX_[A-Z_]+|SCHEDULED_TASK_[A-Z_]+|PORT_[A-Z_]+|LISTENER_[A-Z_]+|RUNNING_TASK_[A-Z_]+|APP_SERVER_[A-Z_]+)/);reject(Error(known?.[0]??'SSH_DEPLOY_FAILED'));return}try{resolve(JSON.parse(output.trim()))}catch{reject(Error('DEPLOY_INVALID_RESPONSE'))}})
 })
}
export async function deploy(host,{check=false}={}){
 if(!Object.hasOwn(HOSTS,host))throw Error('UNKNOWN_HOST')
 const config=HOSTS[host];let result={host,changed:false,checkOnly:check}
 if(!check&&config.platform==='win32')result={...result,...await runSsh(host,windowsDeployment(config))}
 // Unix retains its official daemon management; deployment does not restart either platform.
 const rpc=new RemoteRpc(host)
 try{await rpc.connect();await rpc.call('thread/list',{limit:1});return {...result,connectionVerified:true}}finally{rpc.close()}
}
export async function runDeploymentCli(){
 const [host,flag,...extra]=process.argv.slice(2)
 if(!host||extra.length||flag&&flag!=='--check'){console.error('Usage: node remote-deploy.mjs <host> [--check]');process.exitCode=1}
 else try{console.log(JSON.stringify(await deploy(host,{check:flag==='--check'})))}catch(e){console.error(JSON.stringify({ok:false,error:e.message}));process.exitCode=1}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runDeploymentCli()
