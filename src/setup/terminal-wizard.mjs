import {emitKeypressEvents} from 'node:readline'
import {homedir} from 'node:os'
import {assertAccount} from '../infrastructure/accounts/account-store.mjs'
import {setupLanguage} from './setup-locale.mjs'

export async function terminalChoice(prompt){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('TERMINAL_SETUP_REQUIRES_TTY')
 const options=[...prompt.matchAll(/(?:^|\n)([0-9]+)\. ([^\n]+)/g)].map(match=>({value:match[1],label:match[2]}))
 if(!options.length)throw Error('INVALID_SETUP_MENU')
 const title=prompt.slice(0,prompt.indexOf('\n1.')).trim()
 const hint=prompt.includes('请选择：')?'用 ↑/↓ 选择，回车确认：':'Use ↑/↓ to choose, then press Enter:'
 let selected=options.findIndex(option=>/\[(?:当前|current)\]/.test(option.label))
 if(selected<0)selected=options.findIndex(option=>/\[(?:默认|default)\]/.test(option.label))
 if(selected<0)selected=0
 const draw=()=>{for(let i=0;i<options.length;i++)process.stdout.write(`\x1b[2K${i===selected?'> ':'  '}${options[i].label}\n`)}
 process.stdout.write(`\n${title}\n${hint}\n`)
 draw()
 const wasRaw=process.stdin.isRaw
 emitKeypressEvents(process.stdin)
 process.stdin.setRawMode(true)
 process.stdin.resume()
 return new Promise((resolve,reject)=>{
  const finish=(error,value)=>{
   process.stdin.off('keypress',onKey)
   process.stdin.setRawMode(wasRaw)
   process.stdin.pause()
   process.stdout.write('\n')
   error?reject(error):resolve(value)
  }
  const onKey=(character,key={})=>{
   if(key.ctrl&&key.name==='c')return finish(Error('SETUP_CANCELLED'))
   if(key.name==='return'||key.name==='enter')return finish(null,options[selected].value)
   const old=selected
   if(key.name==='up')selected=(selected+options.length-1)%options.length
   else if(key.name==='down')selected=(selected+1)%options.length
   else {const index=options.findIndex(option=>option.value===character);if(index>=0)selected=index;else return}
   if(selected!==old){process.stdout.write(`\x1b[${options.length}A`);draw()}
  }
  process.stdin.on('keypress',onKey)
 })
}

export async function runTerminalWizard({accountId='default',home=process.env.HOME||homedir(),language=setupLanguage(),write=text=>console.log(text)}={}){
 await assertAccount(accountId,home)
 write(language==='en'?'Send a task in WeChat, then reply with the name of an available executor.':'在微信发送任务，然后回复列表中的执行器名称，即可绑定当前会话。')
 return {selection:'wechat'}
}
