import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {browserLoginUrl} from '../infrastructure/wechat/pairing-state.mjs'
import {setupLanguage} from './setup-locale.mjs'

const exec=promisify(execFile)

export async function displayLoginLink({url},{output=process.stdout,platform=process.platform,env=process.env,run=exec,human=false,language=setupLanguage()}={}){
 const link=browserLoginUrl(url)
 if(!link)throw Error('LOGIN_URL_UNAVAILABLE')
 if(!output.isTTY&&!human)return
 const en=language==='en'
 output.write((en?'WeChat login address (do not share):\n':'微信登录地址（请勿分享）：\n')+link+'\n')
 if(!output.isTTY||env.SSH_CONNECTION||env.SSH_CLIENT||env.SSH_TTY)return
 const command=platform==='win32'?'explorer.exe':platform==='darwin'?'open':platform==='linux'&&(env.DISPLAY||env.WAYLAND_DISPLAY)?'xdg-open':null
 if(!command)return
 try{
  await run(command,[link],{timeout:5000})
  output.write(en?'Opened the login address in your browser. Confirm with WeChat on your phone.\n':'已在浏览器打开登录地址，请在手机微信确认。\n')
 }catch{
  output.write(en?'Could not open the browser. Open the address above yourself.\n':'无法自动打开浏览器，请手动打开上面的登录地址。\n')
 }
}
