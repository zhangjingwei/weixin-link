import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import sharp from 'sharp'
import {execFileSync} from 'node:child_process'
const ffmpeg=new URL('../../node_modules/@ffmpeg-installer/linux-arm64/ffmpeg',import.meta.url).pathname
import {OutputStore,OutputTransport,outputLinks} from '../../src/media/outbound-media.mjs'
import {SessionManager} from '../../src/base/codex/codex-session.mjs'
async function fixture(work){const dir=await mkdtemp(join(tmpdir(),'wx-out-'));const cwd=join(dir,'work'),stateDir=join(dir,'state');await mkdir(cwd);const store=new OutputStore({stateDir,cwd,roots:[cwd]});try{await work({dir,cwd,store,stateDir})}finally{await rm(dir,{recursive:true,force:true})}}
async function image(cwd){const path=join(cwd,'image.png');await sharp({create:{width:64,height:64,channels:3,background:'#1a3e2f'}}).png().toFile(path);return path}
test('only explicit local deliverable links are selected; remote URLs and code examples are ignored',()=>{assert.deepEqual(outputLinks('![图](/tmp/a.png) [文件](sandbox:/tmp/a.pdf) [web](https://a/b.png) `![例](/tmp/c.png)`\n```\n[x](/tmp/d.pdf)\n```'),['/tmp/a.png','/tmp/a.pdf'])})
test('image and document snapshots deduplicate, survive source changes and are isolated by owner',()=>fixture(async({cwd,store})=>{
 const png=await image(cwd),txt=join(cwd,'report.txt');await writeFile(txt,'test report');const packet=await store.package('a',`![image](${png}) [report](${txt})`,[{path:png,image:true}]);assert.equal(packet.attachments.length,2);assert.deepEqual(packet.attachments.map(a=>a.kind),['image','file'])
 await writeFile(txt,'changed');assert.equal((await store.bytes('a',packet.attachments[1])).toString(),'test report');await assert.rejects(store.bytes('b',packet.attachments[0]));assert.equal((await stat(packet.attachments[0].path)).mode&0o777,0o600)
}))
test('outside roots, symlinks and hidden credentials cannot become outbound files',()=>fixture(async({cwd,dir,store})=>{
 const outside=join(dir,'secret.txt');await writeFile(outside,'secret');const link=join(cwd,'link.txt');await symlink(outside,link);const hidden=join(cwd,'.env.txt');await writeFile(hidden,'secret')
 const packet=await store.package('a',`[one](${outside}) [two](${link}) [three](${hidden})`);assert.equal(packet.attachments.length,0);assert.equal(packet.errors.length,3)
}))
test('native image bytes and real H264 MP4 become image/video packets',()=>fixture(async({cwd,store})=>{
 const png=await image(cwd),video=join(cwd,'clip.mp4');execFileSync(ffmpeg,['-loglevel','error','-f','lavfi','-i','color=blue:s=128x128:d=1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-y',video])
 const packet=await store.package('a',`[video](${video})`,[{data:(await readFile(png)).toString('base64'),image:true}]);assert.deepEqual(packet.attachments.map(a=>a.kind),['image','video']);assert.equal(packet.errors.length,0)
}))
test('typed send accepts once; text is Unicode-safe and checkpointed before media upload',()=>fixture(async({cwd,store})=>{
 const png=await image(cwd),packet=await store.package('a','😀'.repeat(1801),[{path:png,image:true}]);const calls=[];let checkpoints=0
 const transport=new OutputTransport({store,send:async(_user,content)=>{calls.push(content);if(content.image)assert.equal(packet.attachments[0].status,'sending')}})
 await transport.deliver('a',packet,{checkpoint:async()=>{checkpoints++}});assert.equal(Array.from(calls[0]).length,1800);assert.equal(calls[1],'😀');assert.ok(calls[2].image);assert.equal(packet.attachments[0].status,'accepted');assert.ok(checkpoints>=6)
 await transport.deliver('a',packet);assert.equal(calls.length,3)
}))
test('cancellation suppresses unsent media, preserves result text and explicit replay resets status',()=>fixture(async({cwd,store})=>{
 const packet=await store.package('a','result',[{path:await image(cwd),image:true}]),calls=[];const transport=new OutputTransport({store,send:async(_u,c)=>calls.push(c)})
 await transport.deliver('a',packet,{current:()=>false});assert.deepEqual(calls,[]);assert.equal(packet.text,'result');assert.equal(packet.attachments[0].status,'cancelled');await transport.deliver('a',store.replay(packet));assert.equal(calls.length,2)
}))
test('ambiguous upload is marked unknown and never automatically resent; checkpoint failure prevents upload',()=>fixture(async({cwd,store})=>{
 const packet=await store.package('a','result',[{path:await image(cwd),image:true}]);let uploads=0
 const transport=new OutputTransport({store,send:async(_u,c)=>{if(c.image){uploads++;throw Error('network lost')}}});await transport.deliver('a',packet);assert.equal(packet.attachments[0].status,'unknown');await transport.deliver('a',packet);assert.equal(uploads,1)
 const replay=store.replay(packet);await assert.rejects(transport.deliver('a',replay,{checkpoint:async()=>{throw Error('disk full')}}));assert.equal(uploads,1)
}))

test('explicit API rejection retries only the failed text part and records attempts',async()=>{
 const logs=[];let calls=0
 const transport=new OutputTransport({retryDelayMs:0,log:(event,fields)=>logs.push({event,...fields}),send:async()=>{calls++;if(calls===1)throw Object.assign(Error('private rejection token=secret'),{name:'ApiError',code:'API_ERROR',httpStatus:409,errcode:19001})}})
 assert.deepEqual(await transport.deliver('owner','final answer'),{status:'accepted'});assert.equal(calls,2)
 const failed=logs.find(x=>x.event==='outbound.text_failed');assert.equal(failed.attempt,1);assert.equal(failed.final_attempt,false);assert.equal(failed.delivery_state,'failed');assert.equal(failed.http_status,409);assert.equal(failed.api_code,19001);assert.ok(!JSON.stringify(logs).includes('secret'))
})

test('ambiguous transport errors are never automatically replayed',async()=>{
 let calls=0;const error=Object.assign(Error('private network failure'),{name:'TransportError',code:'TRANSPORT_ERROR'})
 const transport=new OutputTransport({retryDelayMs:0,send:async()=>{calls++;throw error}})
 await assert.rejects(transport.deliver('owner','final answer'),error);assert.equal(calls,1)
})
test('tampered snapshot is not uploaded',()=>fixture(async({cwd,store})=>{
 const packet=await store.package('a','result',[{path:await image(cwd),image:true}]);await writeFile(packet.attachments[0].path,'tampered');let uploads=0;const transport=new OutputTransport({store,send:async(_u,c)=>{if(typeof c!=='string')uploads++}});await transport.deliver('a',packet);assert.equal(uploads,0);assert.equal(packet.attachments[0].status,'failed')
}))
test('imageView is never forwarded, native generation is collected once and persisted with final output',()=>fixture(async({cwd,stateDir})=>{
 const manager=await new SessionManager({stateDir,cwd,owners:['a']}).init(),png=await image(cwd),output=[];manager.state.users.a={}
 const s={userId:'a',threadId:'thread',turnId:'turn',turnReady:true,busy:true,finals:[],items:new Map(),queue:[],reply:async value=>output.push(value)}
 const event=item=>manager.event(s,{method:'item/completed',params:{threadId:'thread',turnId:'turn',item}})
 await event({id:'view',type:'imageView',path:png});assert.equal(s.generatedOutputs,undefined)
 await event({id:'gen',type:'imageGeneration',status:'completed',savedPath:png,result:''});await event({id:'gen',type:'imageGeneration',status:'completed',savedPath:png,result:''})
 await event({id:'final',type:'agentMessage',phase:'final_answer',text:'done'});await manager.event(s,{method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}})
 assert.equal(output[0].attachments.length,1);assert.equal(manager.state.users.a.lastOutput.attachments[0].kind,'image');const restored=await new SessionManager({stateDir,cwd,owners:['a']}).init();assert.equal(restored.state.users.a.lastOutput.attachments.length,1)
}))
test('plain-text formatting occurs after image and file capture, preserving actual attachments',()=>fixture(async({cwd,store})=>{
 const png=await image(cwd),csv=join(cwd,'report.csv');await writeFile(csv,'name,status\nNAS,online')
 const original=`## **状态**\n![状态图](${png})\n[数据表](${csv})\n[官网](https://example.com)`
 const packet=await store.package('owner',original),sent=[]
 const transport=new OutputTransport({store,send:async(owner,value)=>sent.push(value)})
 await transport.deliver('owner',packet)
 assert.equal(packet.attachments.length,2);assert.ok(packet.attachments.every(a=>a.status==='accepted'))
 const text=sent.filter(x=>typeof x==='string').join('\n');assert.ok(text.includes('状态图'));assert.ok(text.includes('官网：https://example.com'));assert.ok(!text.includes(cwd));assert.ok(!text.includes('**'))
}))
test('HTML is sent as a file with exact bytes and filename, not zipped or interpreted',()=>fixture(async({cwd,store})=>{
 const path=join(cwd,'news.html'),html='<!doctype html><html lang="zh-CN"><body>完整条件：TOP50、审核、最高20万元。</body></html>';await writeFile(path,html)
 const packet=await store.package('owner',`[新闻HTML](${path})`);assert.equal(packet.errors.length,0);assert.equal(packet.attachments.length,1)
 const calls=[],transport=new OutputTransport({store,send:async(_u,c)=>calls.push(c)})
 assert.equal((await transport.deliver('owner',packet)).status,'accepted');assert.equal(calls[1].fileName,'news.html');assert.equal(calls[1].file.toString(),html)
}))

test('long PNG news is delivered as an image with original bytes and resolution',()=>fixture(async({cwd,store})=>{
 const path=join(cwd,'news-long.png');const original=await sharp({create:{width:880,height:6000,channels:3,background:'#e5f4ea'}}).png().toBuffer();await writeFile(path,original)
 const packet=await store.package('a',`![长图](${path})`);assert.equal(packet.errors.length,0);assert.equal(packet.attachments[0].kind,'image');const data=await store.bytes('a',packet.attachments[0]);assert.deepEqual(data,original);assert.equal((await sharp(data).metadata()).height,6000)
}))

test('compressed JPEG long news stays byte-identical and does not get resized or re-encoded',()=>fixture(async({cwd,store})=>{
 const path=join(cwd,'news-80.jpg');const original=await sharp({create:{width:880,height:3000,channels:3,background:'#f0faf3'}}).jpeg({quality:80}).toBuffer();await writeFile(path,original);const packet=await store.package('a',`![新闻](${path})`);assert.equal(packet.errors.length,0);assert.equal(packet.attachments[0].kind,'image');assert.ok(packet.attachments[0].fileName.endsWith('.jpg'));assert.deepEqual(await store.bytes('a',packet.attachments[0]),original)
}))

test('audio delivery defaults to an ordinary file; native bubbles require explicit opt-in',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'voice-fallback-'))
 try{const path=join(dir,'tone.wav');await writeFile(path,Buffer.from('RIFFtest'))
 for(const [voiceMode,kind]of [['file','file'],['native','voice']]){const store=new OutputStore({stateDir:join(dir,voiceMode),cwd:dir,voiceMode});const packet=await store.package('owner',`[tone](${path})`);assert.equal(packet.attachments[0].kind,kind);assert.equal(packet.attachments[0].fileName,'tone.wav')}
 }finally{await rm(dir,{recursive:true,force:true})}
})
