import {emitKeypressEvents} from 'node:readline'
import {setupLanguage} from './setup-locale.mjs'

// Read the short code from the local terminal without echoing it or putting it in argv.
export async function readPairingCode({input=process.stdin,output=process.stderr}={}){
 if(!input.isTTY||typeof input.setRawMode!=='function'){
  let text=''
  for await(const chunk of input){text+=chunk.toString();if(text.length>32)throw Error('INVALID_VERIFICATION_CODE')}
  return text.trim()
 }
 const wasRaw=!!input.isRaw
 input.setRawMode(true)
 try{
  return await new Promise((resolve,reject)=>{
   let code=''
   const onKeypress=(character,key)=>{
    if(key?.ctrl&&['c','d'].includes(key.name)){input.off('keypress',onKeypress);reject(Error('VERIFICATION_CANCELLED'));return}
    if(key?.name==='return'||key?.name==='enter'){input.off('keypress',onKeypress);resolve(code);return}
    if(key?.name==='backspace'){code=code.slice(0,-1);return}
    if(/^\d$/.test(character)&&code.length<12)code+=character
   }
   emitKeypressEvents(input)
   input.on('keypress',onKeypress)
   output.write(setupLanguage()==='en'?'Enter the PIN shown in WeChat on your phone (input is hidden): ':'请输入微信手机上显示的 PIN（看到提示后再输入，输入不回显）：')
   input.resume()
  })
 }finally{input.setRawMode(wasRaw);input.pause();output.write('\n')}
}
