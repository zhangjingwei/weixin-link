import {open,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
export const WELCOME_MESSAGE='你好，微信已连接！\n发送「安装状态」检查是否可以开始使用；需要配置时发送「安装向导」。\n完整帮助可发送「使用说明」。'
export const isWelcomeGreeting=text=>typeof text==='string'&&/^(你好|您好|嗨|hello|hi)[！!。.~～]*$/i.test(text.trim())
export async function welcomeGuideOnce(stateDir,owner,send){const path=join(stateDir,'welcome-'+createHash('sha256').update(owner).digest('hex').slice(0,24)+'.json');let file;try{file=await open(path,'wx',0o600)}catch(e){if(e.code==='EEXIST')return false;throw e}await file.writeFile(JSON.stringify({state:'sending'})+'\n');await file.sync();await file.close();try{await send(WELCOME_MESSAGE);await writeFile(path,JSON.stringify({state:'accepted'})+'\n',{mode:0o600})}catch{await writeFile(path,JSON.stringify({state:'unknown'})+'\n',{mode:0o600})}return true}
