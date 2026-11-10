import {saveProviderProfile,clearProviderProfile} from './provider-profile.mjs'

function secretPrompt(label){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('PROVIDER_SETUP_REQUIRES_TERMINAL')
 return new Promise((resolve,reject)=>{
  let value='',done=false
  const finish=(error)=>{if(done)return;done=true;process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');error?reject(error):resolve(value)}
  const onData=chunk=>{for(const char of chunk.toString('utf8')){
   if(char==='\r'||char==='\n'){finish();return}
   if(char==='\u0003'){finish(Error('SETUP_CANCELLED'));return}
   if(char==='\u007f'||char==='\b'){value=value.slice(0,-1);continue}
   if(char>=' '&&value.length<4096)value+=char
  }}
  process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData)
 })
}

function publicPrompt(label){
 if(!process.stdin.isTTY||!process.stdout.isTTY)throw Error('PROVIDER_SETUP_REQUIRES_TERMINAL')
 return new Promise((resolve,reject)=>{
  let value='';process.stdout.write(label)
  const onData=chunk=>{for(const char of chunk.toString('utf8')){
   if(char==='\r'||char==='\n'){process.stdin.off('data',onData);process.stdin.pause();process.stdout.write('\n');resolve(value.trim());return}
   if(char==='\u0003'){process.stdin.off('data',onData);process.stdin.pause();reject(Error('SETUP_CANCELLED'));return}
   if(value.length<100)value+=char
  }}
  process.stdin.resume();process.stdin.on('data',onData)
 })
}

export async function configureProvider(kind,accountId='default',options={}){
 if(kind==='subscription')return clearProviderProfile({accountId,...options})
 if(!['deepseek','qwen'].includes(kind))throw Error('INVALID_PROVIDER_KIND')
 const workspaceId=kind==='qwen'?await publicPrompt('百炼华北 2（北京）Workspace ID：'):undefined
 const apiKey=await secretPrompt('API Key（输入不回显）：')
 try{return await saveProviderProfile({kind,accountId,workspaceId,apiKey,...options})}finally{/* Do not include credentials in output or errors. */}
}
