param([Parameter(Mandatory=$true)][string]$Payload)
$ErrorActionPreference='Stop'
$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Payload))|ConvertFrom-Json
if($d.name -notmatch '^com\.wechat-assistant\.(wechat-ping-bot(\.[a-z][a-z0-9-]{0,31})?|wechat-pair-[a-z][a-z0-9-]{0,31})$'){throw 'INVALID_SERVICE_NAME'}
if($d.action -eq 'secure'){
 $state=Join-Path $d.home '.local\share\wechat-ping-bot';$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 & icacls.exe $state /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'|Out-Null
 if($LASTEXITCODE -ne 0){throw 'PRIVATE_STATE_ACL_FAILED'};exit 0
}
$t=Get-ScheduledTask -TaskName $d.name -ErrorAction SilentlyContinue
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().Name
if($t -and ($t.Description -ne 'Managed by wechat-assistant setup v1' -or $t.Principal.UserId -notin @($owner,[Security.Principal.WindowsIdentity]::GetCurrent().User.Value))){throw 'EXISTING_SERVICE_REQUIRES_REVIEW'}
switch($d.action){
 'inspect' {@{exists=($null -ne $t);description=$t.Description;arguments=($t.Actions | ForEach-Object {$_.Arguments}) -join ' '}|ConvertTo-Json -Compress}
 'prepare' {
  # Task Scheduler launches an executable directly; no cmd.exe interpolation.
  function QuoteArg([string]$s){if($s -match '[\r\n\x00]'){throw 'INVALID_PATH'};return '"'+($s -replace '(\\*)"','$1$1\"' -replace '(\\+)$','$1$1')+'"'}
  $entry=if($d.pair){'src/wechat/account-login.mjs'}else{'src/setup/service-entry.mjs'}
  $a=(QuoteArg (Join-Path $d.root $entry))+' '+(QuoteArg $d.account)
  if($t){if($t.Actions.Count -ne 1 -or $t.Actions[0].Execute -ne $d.node -or $t.Actions[0].Arguments -ne $a -or $t.Actions[0].WorkingDirectory -ne $d.root){throw 'SERVICE_CONFIGURATION_CHANGED_REQUIRES_REVIEW'};break}
  $action=New-ScheduledTaskAction -Execute $d.node -Argument $a -WorkingDirectory $d.root
  $principal=New-ScheduledTaskPrincipal -UserId $owner -LogonType Interactive -RunLevel Limited
  $settings=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
  if($d.pair){$settings.ExecutionTimeLimit='PT10M';Register-ScheduledTask -TaskName $d.name -Action $action -Principal $principal -Settings $settings -Description 'Managed by wechat-assistant setup v1'|Out-Null}
  else{$trigger=New-ScheduledTaskTrigger -AtLogOn -User $owner;Register-ScheduledTask -TaskName $d.name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Managed by wechat-assistant setup v1'|Out-Null}
 }
 'start' {if(!$t){throw 'SERVICE_NOT_INSTALLED'};Start-ScheduledTask -TaskName $d.name}
 'stop' {if($t){Stop-ScheduledTask -TaskName $d.name;for($i=0;$i -lt 100;$i++){if((Get-ScheduledTask -TaskName $d.name).State -ne 'Running'){break};Start-Sleep -Milliseconds 100};if((Get-ScheduledTask -TaskName $d.name).State -eq 'Running'){throw 'SERVICE_STOP_UNCONFIRMED'}}}
 'status' {@{active=($t -and $t.State -eq 'Running');pid=0}|ConvertTo-Json -Compress}
 default {throw 'INVALID_ACTION'}
}
