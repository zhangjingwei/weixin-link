// Explicitly invoked live send to the sole authorized owner; never starts another poller.
import {WeChatBot} from 'wechatbot-zerolink'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {execFileSync} from 'node:child_process'
import sharp from 'sharp'
import {ffmpegBinary} from '../infrastructure/media/media-binary.mjs'
import {OutputStore,OutputTransport} from '../infrastructure/media/outbound-media.mjs'
import {createDiagnosticLog,createSdkLogger,errorFields} from '../infrastructure/diagnostics/diagnostic-log.mjs'
const root=join(process.env.HOME,'.local/share/wechat-ping-bot'),cwd=join(process.env.HOME,'work/wechat-assistant')
const owners=JSON.parse(await readFile(join(root,'codex-owners.json'),'utf8'))
if(owners.length!==1)throw Error('Live media check requires one explicitly selected authorized recipient')
const userId=owners[0],dir=join(cwd,'outputs','wechat-media-check-'+Date.now());await mkdir(dir,{recursive:true,mode:0o700})
const png=join(dir,'wechat-image-test.png'),video=join(dir,'wechat-video-test.mp4'),file=join(dir,'wechat-file-test.txt')
await sharp({create:{width:640,height:360,channels:3,background:'#1a3e2f'}}).png().toFile(png)
execFileSync(ffmpegBinary,['-loglevel','error','-f','lavfi','-i','color=blue:s=320x240:d=1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-movflags','+faststart','-y',video])
await writeFile(file,'微信富媒体发件测试。此文件、纯色图片和1秒视频均为合成测试产物。\n',{mode:0o600})
const diagnostic=createDiagnosticLog({dir:join(root,'integration-logs')}),log=(event,fields)=>{void diagnostic.log(event,fields)}
const bot=new WeChatBot({storage:'file',storageDir:root,logger:createSdkLogger(log)})
let report
try{
 const credentials=await bot.auth.loadCredentials();if(!credentials)throw Error('Stored login unavailable')
 // login uses the existing credentials; QR interaction is never part of this smoke test.
 await bot.login();await bot.contextStore.load()
 const store=new OutputStore({stateDir:root,cwd}),packet=await store.package(userId,'微信富媒体发件测试：下面依次发送纯色图片、1秒视频和文本文件。',[{path:png,image:true},{path:video},{path:file}])
 if(packet.errors.length||packet.attachments.length!==3)throw Error('Test artifact preparation failed')
 const receipt=join(root,'outbound-live-check.json'),checkpoint=()=>writeFile(receipt,JSON.stringify({checked_at:new Date().toISOString(),packet},null,2)+'\n',{mode:0o600})
 await checkpoint();const transport=new OutputTransport({store,log,send:(id,content)=>bot.send(id,content)})
 await transport.deliver(userId,packet,{checkpoint})
 report={attachments:packet.attachments.map(a=>({kind:a.kind,bytes:a.bytes,status:a.status})),status:packet.attachments.every(a=>a.status==='accepted')?'api_accepted':'partial',recipient_read_verified:false}
 console.log(JSON.stringify(report));if(report.status!=='api_accepted')process.exitCode=1
}catch(error){console.log(JSON.stringify({status:'failed',...errorFields(error)}));process.exitCode=1}finally{await diagnostic.flush()}
