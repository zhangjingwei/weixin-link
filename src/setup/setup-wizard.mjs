import {mkdir,readdir,readFile,open,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'

const hash=s=>createHash('sha256').update(s).digest('hex')
const providerName={deepseek:'DeepSeek',qwen:'Qwen'}

export class InstallationWizard{
 constructor({stateDir,ops}){this.ops=ops;this.dir=join(stateDir,'installation-wizard');this.states=new Map();this.ready=this.load()}
 async load(){await mkdir(this.dir,{recursive:true,mode:0o700});for(const name of await readdir(this.dir)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;try{const s=JSON.parse(await readFile(join(this.dir,name),'utf8'));if(s.version===2&&typeof s.owner==='string'&&hash(s.owner)+'.json'===name)this.states.set(s.owner,s)}catch{}}}
 route(text,owner,executionKey){const s=this.states.get(owner);if(s?.executionKey&&s.executionKey!==executionKey)return null;return typeof text==='string'&&s?.active&&/^[0-9]{1,3}$/.test(text.trim())?`wizardChoice:${s.revision}:${text.trim()}`:null}
 async save(s){s.revision=(s.revision??0)+1;const path=join(this.dir,hash(s.owner)+'.json'),tmp=path+'.'+randomUUID()+'.tmp';const f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(s)+'\n');await f.sync()}finally{await f.close()}await rename(tmp,path);this.states.set(s.owner,s)}
 async inspect(s){const r=await this.ops.availability();if(s.phase==='subscription'&&r.installed&&r.loggedIn&&!r.profileKind&&r.activeKind==='subscription')s.phase='modelTest';if(s.phase==='provider'&&r.installed&&r.profileKind===s.provider&&r.activeKind===s.provider)s.phase='modelTest';return r}
 menu(s){
  const command=s.provider?`node src/setup/setup.mjs provider-config ${s.provider} [账号档案]`:''
  const menus={
   select:'请选择一种 Codex 模型接入方式：\n1. 订阅登录（OpenAI/ChatGPT）\n2. 配置 DeepSeek（deepseek-flash）\n3. 配置 Qwen（百炼 qwen3.7-max）',
   subscription:'订阅登录：在官方 OpenAI 页面完成设备授权。若此前配置了第三方模型，请先在本机运行 node src/setup/setup.mjs provider-config subscription [账号档案] 并重启当前账号服务。\n1. 登录或重新检测\n2. 返回接入方式',
   provider:`${providerName[s.provider]} 配置：请在本机源码目录运行\n${command}\n密钥只在本机终端输入，不要发送到微信。配置成功后重启当前账号服务，再回复 1。\n${s.provider==='qwen'?'Qwen 需要百炼按量付费 API Key 和华北 2（北京）Workspace ID；Coding Plan 不支持当前 Codex 的 Responses 协议。\n':''}1. 检测本机配置\n2. 返回接入方式`,
   modelTest:'模型接入已配置。\n1. 发起一次真实模型测试\n2. 暂不测试，结束向导',
   recovery:'上次操作结果尚未确认，不会自动重复执行。\n1. 重新检测当前状态\n2. 查看使用说明'
  }
  return (s.error?'上一步未完成：'+s.error+'\n\n':'')+menus[s.phase]+'\n\n回复对应数字；发送“退出向导”可随时退出。'
 }
 async start(owner,reply,{executionKey}={}){await this.ready;let s=this.states.get(owner);if(!s?.active)s={version:2,owner,active:true,phase:'select',revision:s?.revision??0};if(executionKey)s.executionKey=executionKey;if(s.running){s.resumePhase=s.phase;s.phase='recovery';s.running=false}else await this.inspect(s);await this.save(s);await reply(this.menu(s))}
 async exit(owner,reply){await this.ready;const s=this.states.get(owner);if(!s?.active)return reply('安装向导尚未开启。');s.active=false;s.running=false;await this.save(s);await reply('已退出安装向导。需要时发送“安装向导”重新选择接入方式。')}
 async choice(owner,revision,n,reply,context={}){
  await this.ready;const s=this.states.get(owner)
  if(s?.executionKey&&s.executionKey!==context.executionKey)return reply('请在开启向导的会话中操作，或发送“安装向导”继续。')
  if(!s?.active)return reply('安装向导尚未开启。发送“安装向导”开始。')
  if(!['1','2','3'].includes(n))return reply('请选择当前页面列出的数字。\n'+this.menu(s))
  if(Number(revision)!==s.revision)return reply('安装步骤已变化，本次数字未执行。\n'+this.menu(s))
  if(n==='3'&&s.phase!=='select')return reply('请选择当前页面列出的数字。\n'+this.menu(s))
  if(s.running){s.resumePhase=s.phase;s.phase='recovery';s.running=false;await this.save(s);return reply(this.menu(s))}
  s.error=null
  try{
   if(s.phase==='select'){
    if(n==='1'){s.phase='subscription';s.provider=null}else{s.phase='provider';s.provider=n==='2'?'deepseek':'qwen'}
    await this.inspect(s)
   }else if(s.phase==='subscription'){
    if(n==='2'){s.phase='select'}else if(n==='1'){
     const r=await this.ops.availability()
     if(!r.installed)throw Error('CODEX_BUNDLED_RUNTIME_MISSING')
     if(r.profileKind||r.activeKind!=='subscription'){s.error='订阅方式尚未生效，请按上方命令清除第三方配置并重启服务。';await this.save(s);return reply(this.menu(s))}
     if(!r.loggedIn)await this.operation(s,'login',reply,context)
     await this.operation(s,'check',reply,context)
     await this.inspect(s)
    }
   }else if(s.phase==='provider'){
    if(n==='2')s.phase='select'
    else if(n==='1'){
     const r=await this.inspect(s)
     if(s.phase==='provider')s.error=!r.installed?'Codex 运行时尚未就绪，请在本机运行 node src/setup/setup.mjs deps。':r.profileKind===s.provider?'配置已保存，请重启当前账号服务后重新检测。':'尚未找到该账号的模型配置。'
    }
   }else if(s.phase==='modelTest'){
    if(n==='1'){const r=await this.ops.availability();if(!r.installed||r.activeKind!==(s.provider??'subscription')||(s.provider?r.profileKind!==s.provider:Boolean(r.profileKind)))throw Error('MODEL_CONFIGURATION_CHANGED');await this.operation(s,'modelTest',reply,context);s.active=false;await this.save(s);return reply('模型测试完成，已确认本次推理成功。现在可以直接聊天。')}
    if(n==='2'){s.active=false;await this.save(s);return reply('已结束向导。模型推理尚未验证，可稍后发送“安装向导”测试。')}
   }else if(s.phase==='recovery'){
    if(n==='2'){await this.ops.manual(reply);return reply(this.menu(s))}
    s.phase=s.resumePhase??'select';await this.inspect(s)
   }
  }catch(error){s.running=false;if(context.signal?.aborted){s.active=false;await this.save(s);return}s.error=this.ops.errorText(error)}
  await this.save(s);await reply(this.menu(s))
 }
 async operation(s,name,reply,context){s.running=true;s.lastOperation=name;await this.save(s);try{const result=await this.ops.perform(name,s,reply,context);context.signal?.throwIfAborted();return result}finally{s.running=false}}
}
