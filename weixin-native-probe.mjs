// Diagnostic only: native HTTPS requests, no WeChat SDK or bot adapter imports.
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {randomBytes,randomUUID,createHash,createCipheriv} from 'node:crypto'
import {join} from 'node:path'
import {encode,decode} from 'silk-wasm'
if(!process.argv.includes('--send'))throw Error('EXPLICIT_SEND_REQUIRED')
const home=process.env.HOME,account=process.env.WECHAT_ACCOUNT??'default';if(!/^[a-z][a-z0-9-]{0,31}$/.test(account))throw Error('INVALID_ACCOUNT')
const base=join(home,'.local/share/wechat-ping-bot'),state=account==='default'?base:join(base,'accounts',account)
const credentials=JSON.parse(await readFile(join(state,'credentials.json'),'utf8')),owners=JSON.parse(await readFile(join(state,'codex-owners.json'),'utf8'))
if(owners.length!==1)throw Error('EXACT_RECIPIENT_REQUIRED');const peer=owners[0],contexts=JSON.parse(await readFile(join(state,'context_tokens.json'),'utf8')),context=contexts[peer];if(!context)throw Error('CONTEXT_MISSING')
const origin=new URL(credentials.baseUrl);if(origin.protocol!=='https:'||!origin.hostname.endsWith('.weixin.qq.com'))throw Error('UNEXPECTED_ORIGIN')
const root=join(home,'work/wechat-assistant/.private/weixin-native-probes');await mkdir(root,{recursive:true,mode:0o700});const run=randomUUID(),file=join(root,run+'.json'),receipt={run,transport:'native-fetch-no-sdk',started:new Date().toISOString(),results:[]}
const save=()=>writeFile(file,JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
const safe=response=>({http:response.status})
async function post(path,body,label){const row={label,stage:'sending'};receipt.results.push(row);await save();try{const response=await fetch(new URL(path,origin),{method:'POST',headers:{'Content-Type':'application/json',AuthorizationType:'ilink_bot_token',Authorization:'Bearer '+credentials.token,'X-WECHAT-UIN':Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),'iLink-App-Id':'bot','iLink-App-ClientVersion':String(2<<16|2<<8)},body:JSON.stringify({...body,base_info:{channel_version:'2.2.0',bot_agent:'WeChatNativeProbe/1.0'}}),signal:AbortSignal.timeout(30000)});const text=await response.text();const d=text?JSON.parse(text,(k,v,c)=>['message_id','msg_id','svr_id'].includes(k)&&typeof v==='number'?c.source:v):{};Object.assign(row,safe(response),{stage:response.ok&&!d.ret&&!d.errcode?'accepted':'rejected',ret:d.ret??null,errcode:d.errcode??null,messageId:d.message_id??null,responseFields:Object.keys(d)});await save();if(row.stage!=='accepted')throw Error('NATIVE_API_REJECTED');return d}catch(e){if(row.stage==='sending')row.stage='unknown';await save();throw e}}
const message=(items,id)=>({msg:{from_user_id:'',to_user_id:peer,client_id:id,message_type:2,message_state:2,context_token:context,item_list:items}})
try{
 await post('/ilink/bot/sendmessage',message([{type:1,text_item:{text:'【原生接口对照测试】这条文字直接通过 HTTP 发送，随后测试一条 2 秒语音；未调用微信 SDK。'}}],run+'-text'),'text-control')
 const pcm=Buffer.alloc(24000*2*2);for(let n=0;n<24000*2;n++)pcm.writeInt16LE(Math.round(3000*Math.sin(2*Math.PI*660*n/24000)),n*2)
 const voice=await encode(pcm,24000),data=Buffer.from(voice.data),decoded=await decode(data,24000)
 receipt.audio={codec:'SILK',sampleRate:24000,channels:1,encodeDurationMs:voice.duration,decodeDurationMs:decoded.duration,bytes:data.length,headerHex:data.subarray(0,10).toString('hex'),sha256:createHash('sha256').update(data).digest('hex')};await save()
 const key=randomBytes(16),cipher=createCipheriv('aes-128-ecb',key,null),encrypted=Buffer.concat([cipher.update(data),cipher.final()]),filekey=randomBytes(16).toString('hex')
 const upload=await post('/ilink/bot/getuploadurl',{filekey,media_type:4,to_user_id:peer,rawsize:data.length,rawfilemd5:createHash('md5').update(data).digest('hex'),filesize:encrypted.length,no_need_thumb:true,aeskey:key.toString('hex')},'voice-upload-url')
 const url=new URL(upload.upload_full_url??`https://novac2c.cdn.weixin.qq.com/c2c/upload?encrypted_query_param=${encodeURIComponent(upload.upload_param)}&filekey=${filekey}`);if(url.protocol!=='https:'||!url.hostname.endsWith('.weixin.qq.com'))throw Error('UNEXPECTED_CDN')
 const row={label:'voice-cdn-upload',stage:'sending'};receipt.results.push(row);await save();const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:encrypted,signal:AbortSignal.timeout(60000)});row.http=response.status;row.stage=response.ok?'accepted':'rejected';await save();const query=response.headers.get('x-encrypted-param');if(!response.ok||!query)throw Error('CDN_UPLOAD_FAILED')
 await post('/ilink/bot/sendmessage',message([{type:3,voice_item:{media:{encrypt_query_param:query,aes_key:Buffer.from(key.toString('hex')).toString('base64'),encrypt_type:1},encode_type:6,sample_rate:24000,bits_per_sample:16,playtime:Math.round(voice.duration),size:data.length}}],run+'-voice'),'voice-message')
 receipt.status='submitted-awaiting-client-observation';await save();console.log(JSON.stringify(receipt))
}catch(error){receipt.status='test-incomplete';await save();console.log(JSON.stringify({status:receipt.status,results:receipt.results,error:'NATIVE_TEST_FAILED'}));process.exitCode=1}
