import {mkdir,readFile,lstat,open,rename,unlink,rmdir} from 'node:fs/promises'
import {dirname,basename,join} from 'node:path'
import {randomUUID,createHash} from 'node:crypto'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {ConfigError,MAX_CONFIG_BYTES} from './config-schema.mjs'
const exec=promisify(execFile)
export const digest=text=>createHash('sha256').update(text??'').digest('hex')
export async function readPrivateFile(path){
 try{const info=await lstat(path);if(info.size>MAX_CONFIG_BYTES)throw new ConfigError('CONFIG_TOO_LARGE');if(info.isSymbolicLink()||!info.isFile()||info.nlink>1)throw new ConfigError('CONFIG_UNSAFE_FILE');return await readFile(path,'utf8')}catch(error){if(error.code==='ENOENT')return null;throw error}
}
async function privatePermissions(path){
 if(process.platform!=='win32')return
 const script="$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('"+Buffer.from(path).toString('base64')+"'));$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& icacls.exe $p /inheritance:r /grant:r \"*${sid}:F\" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null;if($LASTEXITCODE -ne 0){exit 1}"
 try{await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:10000})}catch{throw new ConfigError('CONFIG_PERMISSIONS_FAILED')}
}
async function replace(path,text,{expected}={}){
 const temp=join(dirname(path),'.'+basename(path)+'.'+randomUUID()+'.tmp');let file
 try{file=await open(temp,'wx',0o600);await privatePermissions(temp);await file.writeFile(text);await file.sync();await file.close();file=null;if(expected!==undefined&&digest(await readPrivateFile(path))!==expected)throw new ConfigError('CONFIG_CHANGED_DURING_CHECK');await rename(temp,path)}finally{await file?.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e})}
}
export async function atomicConfigWrite(path,text,{expected,backup=true}={}){
 await mkdir(dirname(path),{recursive:true,mode:0o700})
 const parent=await lstat(dirname(path));if(parent.isSymbolicLink())throw new ConfigError('CONFIG_UNSAFE_DIRECTORY')
 const lock=path+'.write-lock';try{await mkdir(lock,{mode:0o700})}catch(error){if(error.code==='EEXIST')throw new ConfigError('CONFIG_BUSY');throw error}
 try{
  const previous=await readPrivateFile(path)
  if(expected!==undefined&&digest(previous)!==expected)throw new ConfigError('CONFIG_CHANGED_DURING_CHECK')
  if(previous===text)return {changed:false}
  if(backup&&previous!==null){await readPrivateFile(path+'.previous');await replace(path+'.previous',previous)}
  await replace(path,text,{expected:digest(previous)});return {changed:true,backup:previous!==null&&backup}
 }finally{await rmdir(lock)}
}
