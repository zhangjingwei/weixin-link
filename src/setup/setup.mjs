#!/usr/bin/env node
import {setupMessage,setupError,setupProgress} from './cli-output.mjs'
import {npmCommand} from './platform-command.mjs'
import {fileURLToPath} from 'node:url'
import {initInstallation,installServices,doctor,installCodex,checkCodex,setupPaths} from './setup-core.mjs'
import {deviceLogin} from './setup-login.mjs'
import {projectRoot,installConfig} from './install-config.mjs'
import {execFile,spawn} from 'node:child_process'
import {promisify} from 'node:util'
const exec=promisify(execFile),[action='help',...args]=process.argv.slice(2).filter(arg=>arg!=='--human')
const human=process.argv.includes('--human')
const report=(action,result)=>console.log(human?setupMessage(action,result):JSON.stringify(result))
try{
 if(human&&setupProgress[action])console.log(setupProgress[action])
 if(['config-schema','config-check','config-set','config-restore'].includes(action)&&args.length!==1||action==='config-status'&&args.length)throw Error('CONFIG_ARGUMENTS_INVALID')
 if(action.startsWith('integration-')){const {runIntegrationCommand}=await import('../integrations/cli.mjs');console.log(JSON.stringify(await runIntegrationCommand(action.slice('integration-'.length),args)))}
 else if(action==='config-schema'){const {configSchema}=await import('./config-schema.mjs');console.log(JSON.stringify(configSchema(args[0]),null,2))}
 else if(action==='config-check'){const {validateConfig}=await import('./config-schema.mjs');const {readConfigStdin}=await import('./config-manager.mjs');const config=validateConfig(args[0],await readConfigStdin());console.log(JSON.stringify({kind:args[0],valid:true,version:config.version}))}
 else if(action==='config-set'){const {configure,readConfigStdin}=await import('./config-manager.mjs');console.log(JSON.stringify(await configure(args[0],await readConfigStdin())))}
 else if(action==='config-restore'){const {restoreConfiguration}=await import('./config-manager.mjs');console.log(JSON.stringify(await restoreConfiguration(args[0])))}
 else if(action==='config-status'){const {configStatus}=await import('./config-manager.mjs');console.log(JSON.stringify(await configStatus()))}
 else if(action==='init')report(action,await initInstallation(args[0]?{workspace:args[0]}:{}))
 else if(action==='services')report(action,await installServices())
 else if(action==='doctor')console.log(JSON.stringify(await doctor(),null,2))
 else if(action==='deps'){const npm=npmCommand(['ci']);await exec(npm.binary,npm.args,{cwd:projectRoot,timeout:600000,maxBuffer:1024*1024});console.log(human?setupMessage(action):'Dependencies installed; SDK patches applied.')}
 else if(action==='codex-install')console.log(JSON.stringify(await installCodex()))
 else if(action==='codex-login')console.log(JSON.stringify(await deviceLogin({send:text=>console.log(text)})))
 else if(action==='codex-check')console.log(JSON.stringify(await checkCodex()))
 else if(action==='pair'&&human){try{const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('../wechat/account-manager.mjs',import.meta.url)),'login',args[0]??'default'],{timeout:30000});report(action,JSON.parse(stdout))}catch(error){let code;try{code=JSON.parse(error.stdout).error}catch{}throw code?Error(code):error}}
 else if(action==='pair'){const child=spawn(process.execPath,[fileURLToPath(new URL('../wechat/account-manager.mjs',import.meta.url)),'login',args[0]??'default'],{stdio:'inherit'});child.on('exit',code=>{process.exitCode=code??1})}
 else if(action==='qr'){let result;for(let n=0;n<40;n++){try{const {stdout}=await exec(process.execPath,[fileURLToPath(new URL('../wechat/account-manager.mjs',import.meta.url)),'qr',args[0]??'default'],{timeout:10000});result=stdout;break}catch(error){if(n===39)throw Error('QR_NOT_READY_OR_EXPIRED');await new Promise(r=>setTimeout(r,500))}}const qr=JSON.parse(result.trim());const {accountPaths}=await import('../wechat/accounts.mjs');const {displayQr}=await import('./qr-display.mjs');await displayQr(qr,accountPaths(args[0]??'default').stateDir,{human});if(human)console.log(setupMessage('qr'));else console.log(result.trim())}
 else if(action==='container-create'||action==='container-login'){const {containerSetup}=await import('./setup-container.mjs');console.log(JSON.stringify(await containerSetup(action,args[0]??'default',{send:text=>console.log(text)})))}
 else console.log('配置命令（JSON 内容通过标准输入提供）：config-schema 类型、config-check 类型、config-set 类型、config-restore 类型、config-status。核心类型：installation、backup、remote-hosts；集成配置类型由 integration-list 返回。集成命令：integration-list/status [账号]、integration-enable/disable/check/call 集成ID [账号]。\n安装顺序：\nnode src/setup/setup.mjs init [工作目录]\nnode src/setup/setup.mjs deps\nnode src/setup/setup.mjs services\nnode src/setup/setup.mjs pair [账号档案]\nnode src/setup/setup.mjs qr [账号档案]\n扫码后优先在微信发送：安装状态、安装智能体、登录智能体、验收智能体。\n容器：node src/setup/setup.mjs container-create|container-login [账号档案]\n诊断：node src/setup/setup.mjs doctor\n默认账号档案可省略；新档案先运行 src/wechat/account-manager.mjs create。')
}catch(error){if(human){console.error(setupError(error));process.exitCode=1}else{console.error(JSON.stringify({ok:false,error:/^[A-Z0-9_]+$/.test(error.message)?error.message:error.code??'SETUP_FAILED',...(error.field?{field:error.field}:{})}));process.exitCode=1}}
