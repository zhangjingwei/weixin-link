// Upload-only diagnostic: does not poll, send messages, rotate credentials or print URLs/keys.
import {WeChatBot} from '@wechatbot/wechatbot'
import {readFile,writeFile} from 'node:fs/promises'
import sharp from 'sharp'
const state=process.env.HOME+'/.local/share/wechat-ping-bot',credentials=JSON.parse(await readFile(state+'/credentials.json','utf8'));
const owners=JSON.parse(await readFile(state+'/codex-owners.json','utf8'));
const logger={child(){return this},debug(){},info(){},warn(){},error(){}};
const bot=new WeChatBot({storage:'memory',logger});
const data=await sharp(process.env.HOME+'/work/wechat-assistant/outputs/home-camera/door-current.jpg').rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).png().toBuffer();
const started=Date.now();let attempts=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{const cdn=init?.headers?.['Content-Type']==='application/octet-stream';if(cdn){attempts++;console.log(JSON.stringify({stage:'cdn_started',attempt:attempts,bytes:data.length,timeoutMs:300000}));}const at=Date.now();try{const r=await originalFetch(input,init);if(cdn)console.log(JSON.stringify({stage:'cdn_response',attempt:attempts,status:r.status,elapsedMs:Date.now()-at}));return r}catch(e){if(cdn)console.log(JSON.stringify({stage:'cdn_error',attempt:attempts,name:e.name,elapsedMs:Date.now()-at}));throw e}};
try{await bot.uploader.upload(credentials.baseUrl,credentials.token,{data,userId:owners[0],mediaType:1});const result={status:'uploaded',bytes:data.length,attempts,elapsedMs:Date.now()-started,timeoutMs:300000,messageSent:false};console.log(JSON.stringify(result));await writeFile('/tmp/wechat-upload-timeout-result.json',JSON.stringify(result));}catch(e){console.log(JSON.stringify({status:'failed',name:e.name,attempts,elapsedMs:Date.now()-started}));process.exitCode=1}
