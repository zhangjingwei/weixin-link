// Isolated real Codex image input check; never sends a WeChat message.
import {SessionManager} from '../wechat/session-manager.mjs'
import {composeMediaInput} from '../infrastructure/media/media-preprocess.mjs'
import {mkdtemp,rm} from 'node:fs/promises'
import sharp from 'sharp'
const dir=await mkdtemp('/tmp/wechat-media-live-'),path=dir+'/picture.png'
const manager=await new SessionManager({stateDir:dir,cwd:dir,owners:['test']}).init()
try{
 await sharp(Buffer.from('<svg width="600" height="200"><rect width="600" height="200" fill="white"/><text x="30" y="135" font-size="100" fill="black" font-family="sans-serif">913684</text></svg>')).png().toFile(path)
 const input=await composeMediaInput({text:'只识别第一张图片中的大号数字验证码，返回数字即可。不要调用工具、运行命令或读取文件。',attachments:[{path,name:'picture.png',kind:'images',image:true}]})
 const result=await manager.ask('test',input,()=>{},90000)
 console.log(JSON.stringify({status:result.status,image_inputs:input.images.length,expected_match:result.reply.includes('913684')}))
 if(result.status!=='completed'||!result.reply.includes('913684'))throw Error('Live image check failed')
}finally{manager.close();await manager.saving;await rm(dir,{recursive:true,force:true})}
