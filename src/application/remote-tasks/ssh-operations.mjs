import {posix,win32} from 'node:path'
import {projectPath,exportPath} from '../../infrastructure/remote/path-guard.mjs'
import {shellQuote,sshCommand} from '../../infrastructure/remote/ssh-transport.mjs'
import {windowsDirectory,windowsExec,windowsExists,windowsRead,windowsWrite} from '../../infrastructure/remote/windows-shell.mjs'

const allowed=new Set(['list','inspect','exec','read','write'])
const safeText=value=>typeof value==='string'&&value.length>0&&value.length<=8192&&!/[\0\r\n]/.test(value)

export class SshOperations{
 constructor({hosts,run=sshCommand}={}){this.hosts=hosts;this.run=run}
 async call(host,command,options){const result=await this.run(host,command,options);return result}
 paths(host){return this.hosts[host].platform==='win32'?win32:posix}
 async directory(host,path){
  const command=this.hosts[host].platform==='win32'?windowsDirectory(path):`test -d ${shellQuote(path)} && test "$(realpath ${shellQuote(path)})" = ${shellQuote(path)}`
  if((await this.call(host,command,{timeoutMs:12000})).exitCode!==0)throw Error('REMOTE_PROJECT_UNAVAILABLE')
 }
 async verifiedProject(host,project){
  const path=projectPath(host,project,this.hosts)
  await this.directory(host,this.paths(host).resolve(this.hosts[host].root))
  await this.directory(host,path)
  return path
 }
 async runRequest(request){
  if(!request||typeof request!=='object'||Array.isArray(request)||!allowed.has(request.action))throw Error('INTEGRATION_OPERATION_NOT_ALLOWED')
  if(request.action==='list')return {hosts:Object.keys(this.hosts)}
  const host=request.host
  if(!Object.hasOwn(this.hosts,host))throw Error('UNKNOWN_HOST')
  const project=await this.verifiedProject(host,request.project)
  if(request.action==='inspect')return {host,project}
  if(request.action==='exec'){
   if(!safeText(request.command)||request.command.length>8192)throw Error('REMOTE_ARGUMENTS_INVALID')
   const timeoutMs=request.timeoutMs??30000
   const windows=this.hosts[host].platform==='win32'
   const result=await this.call(host,windows?windowsExec(project):'sh -s',{input:Buffer.from(windows?request.command:`cd ${shellQuote(project)} && ${request.command}\n`),timeoutMs,maxBytes:65536})
   return {host,project,exit_code:result.exitCode,stdout:result.stdout.toString('utf8'),stderr:result.stderr.toString('utf8')}
  }
  if(!safeText(request.path))throw Error('REMOTE_ARGUMENTS_INVALID')
  const path=exportPath(project,request.path)
  if(request.action==='read'){
   if(this.hosts[host].platform==='win32')await this.directory(host,this.paths(host).dirname(path))
   const command=this.hosts[host].platform==='win32'?windowsRead(path):`test -f ${shellQuote(path)} && test "$(realpath ${shellQuote(path)})" = ${shellQuote(path)} && cat ${shellQuote(path)}`
   const result=await this.call(host,command,{maxBytes:1048576})
   if(result.exitCode!==0)throw Error('REMOTE_FILE_UNAVAILABLE')
   return {host,project,path,data_base64:result.stdout.toString('base64'),bytes:result.stdout.length}
  }
  if(typeof request.data_base64!=='string'||request.data_base64.length>1398104||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.data_base64))throw Error('REMOTE_ARGUMENTS_INVALID')
  const data=Buffer.from(request.data_base64,'base64')
  if(data.length>1048576)throw Error('REMOTE_INPUT_TOO_LARGE')
  const parent=this.paths(host).dirname(path)
  await this.directory(host,parent)
  const windows=this.hosts[host].platform==='win32'
  const exists=await this.call(host,windows?windowsExists(path):`test -e ${shellQuote(path)} || test -L ${shellQuote(path)}`)
  if(exists.exitCode===0)throw Error('REMOTE_FILE_EXISTS')
  const result=await this.call(host,windows?windowsWrite(path):`(umask 077; set -C; cat > ${shellQuote(path)})`,{input:data,maxBytes:4096})
  if(result.exitCode!==0)throw Error('REMOTE_WRITE_FAILED')
  return {host,project,path,bytes:data.length}
 }
}
