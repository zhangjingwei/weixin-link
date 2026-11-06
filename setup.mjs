#!/usr/bin/env node
import {npmCommand} from './platform-command.mjs'
import {fileURLToPath} from 'node:url'
import {initInstallation,installServices,doctor,installCodex,checkCodex,setupPaths} from './setup-core.mjs'
import {deviceLogin} from './setup-login.mjs'
import {projectRoot,installConfig} from './install-config.mjs'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),[action='help',...args]=process.argv.slice(2)
try{
 if(action==='init')console.log(JSON.stringify(await initInstallation(args[0]?{workspace:args[0]}:{})))
 else if(action==='services')console.log(JSON.stringify(await installServices()))
 else if(action==='doctor')console.log(JSON.stringify(await doctor(),null,2))
 else if(action==='deps'){const npm=npmCommand(['ci']);await exec(npm.binary,npm.args,{cwd:projectRoot,timeout:600000,maxBuffer:1024*1024});console.log('Dependencies installed; SDK patches applied.')}
 else if(action==='codex-install')console.log(JSON.stringify(await installCodex()))
 else if(action==='codex-login')console.log(JSON.stringify(await deviceLogin({send:text=>console.log(text)})))
 else if(action==='codex-check')console.log(JSON.stringify(await checkCodex()))
 else if(action==='pair'){const child=spawn(process.execPath,[fileURLToPath(new URL('./account-manager.mjs',import.meta.url)),'login',args[0]??'default'],{stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1})}
 else if(action==='qr'){let result;for(let n=0;n<40;n++){try{const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('./account-manager.mjs',import.meta.url)),'qr',args[0]??'default'],{timeout:10000});result=stdout;break}catch(error){if(n===39)throw Error('QR_NOT_READY_OR_EXPIRED');await new Promise(r=>setTimeout(r,500))}}const qr=JSON.parse(result.trim());const {accountPaths}=await import('./accounts.mjs');const {readFile}=await import('node:fs/promises');const {join}=await import('node:path');const dir=accountPaths(args[0]??'default').stateDir;try{const state=JSON.parse(await readFile(join(dir,'pairing.json'),'utf8'));if(state.status==='waiting_scan'&&Date.now()<state.valid_until)console.log(await readFile(join(dir,'login-'+state.qr_version+'.terminal'),'utf8'))}catch{}console.log(result.trim())}
 else if(action==='container-create'||action==='container-login'){const {containerSetup}=await import('./setup-container.mjs');console.log(JSON.stringify(await containerSetup(action,args[0]??'default',{send:text=>console.log(text)})))}
 else console.log('安装顺序：\nnode setup.mjs init [工作目录]\nnode setup.mjs deps\nnode setup.mjs services\nnode setup.mjs pair [账号档案]\nnode setup.mjs qr [账号档案]\n扫码后优先在微信发送：安装状态、安装Codex、登录Codex、验收Codex。\n容器：node setup.mjs container-create|container-login [账号档案]\n诊断：node setup.mjs doctor\n默认账号档案可省略；新档案先运行 account-manager.mjs create。')
}catch(error){console.error(JSON.stringify({ok:false,error:/^[A-Z0-9_]+$/.test(error.message)?error.message:error.code??'SETUP_FAILED'}));process.exitCode=1}
