import {mkdir,readdir,readFile,open,rename,unlink} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
const hash=s=>createHash('sha256').update(s).digest('hex')
export class InstallationWizard{
 constructor({stateDir,backend,ops}){Object.assign(this,{backend,ops});this.dir=join(stateDir,'installation-wizard');this.states=new Map();this.ready=this.load()}
 async load(){await mkdir(this.dir,{recursive:true,mode:0o700});for(const name of await readdir(this.dir)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;try{const s=JSON.parse(await readFile(join(this.dir,name),'utf8'));if(s.version===1&&typeof s.owner==='string'&&hash(s.owner)+'.json'===name)this.states.set(s.owner,s)}catch{}}}
 route(text,owner,executionKey){const s=this.states.get(owner);if(s?.executionKey&&s.executionKey!==executionKey&&!(s.phase==='binding'&&this.backend?.kind==='podman'&&(!s.target||s.target===this.backend.id)))return null;return typeof text==='string'&&s?.active&&/^[0-9]{1,3}$/.test(text.trim())?`wizardChoice:${s.revision}:${text.trim()}`:null}
 async save(s){s.revision=(s.revision??0)+1;const path=join(this.dir,hash(s.owner)+'.json'),tmp=path+'.'+randomUUID()+'.tmp';const f=await open(tmp,'wx',0o600);try{await f.writeFile(JSON.stringify(s)+'\n');await f.sync()}finally{await f.close()}await rename(tmp,path);this.states.set(s.owner,s)}
 async inspect(s){if(this.backend?.kind==='podman'){s.mode='container';s.phase='verify';return}const r=await this.ops.availability();s.phase=!r.installed?'install':!r.loggedIn?'login':'verify'}
 menu(s){const exit='\n3. 退出向导';const menus={
 environment:'安装向导：选择运行位置\n1. 电脑本机（宿主机）\n2. 独立容器（隔离文件和账号）'+exit,
 install:'尚未安装 Codex。\n1. 安装 Codex\n2. 重新检测'+exit,
 login:'需要完成 Codex 登录授权。\n1. 获取官方登录链接和设备验证码\n2. 重新检测'+exit,
 verify:'已检测到 Codex 登录。\n1. 检查连接和原生记忆接口\n2. 重新检测安装步骤'+exit,
 containerConfig:'创建独立容器，默认内存上限1.5GiB、CPU上限0.5核、交换空间0。\n程序会先检查 Podman 和内存控制器，缺失时停止，不自动改内核或重启。\n1. 检查并创建容器\n2. 返回运行位置选择'+exit,
 containerLogin:'容器已准备，尚未切换。\n1. 登录容器内的 Codex\n2. 返回运行位置选择'+exit,
 bindConfirm:'容器登录已确认。\n1. 切换到该独立容器（保留原环境历史）\n2. 重新检查容器登录'+exit,
 binding:'正在等待账号空闲后切换。\n1. 核对切换结果\n2. 查看使用说明'+exit,
 modelTest:'基础连接检查通过，还需确认模型实际可用。\n1. 发起一次真实模型测试\n2. 暂不测试，退出向导'+exit,
 recovery:'上次操作结果尚未确认，不会自动重复执行。\n1. 重新检测当前状态\n2. 查看使用说明'+exit
 };return (s.error?'上一步未完成：'+s.error+'\n\n':'')+(menus[s.phase]??menus.environment)+'\n\n请只回复对应数字。'}
 async start(owner,reply,{executionKey}={}){await this.ready;let s=this.states.get(owner);if(!s?.active)s={version:1,owner,active:true,phase:'environment',revision:s?.revision??0};if(executionKey)s.executionKey=executionKey;if(s.running){s.resumePhase=s.phase;s.phase='recovery';s.running=false}if(this.backend?.kind==='podman'&&s.phase==='environment'){await this.inspect(s)}await this.save(s);await reply(this.menu(s))}
 async choice(owner,revision,n,reply,context={}){await this.ready;const s=this.states.get(owner);if(s?.executionKey&&s.executionKey!==context.executionKey&&!(s.phase==='binding'&&this.backend?.kind==='podman'&&(!s.target||s.target===this.backend.id)))return reply('请在开启向导的会话中操作，或发送“安装向导”继续。');if(s?.phase==='binding'&&this.backend?.kind==='podman'&&context.executionKey)s.executionKey=context.executionKey;if(!s?.active)return reply('安装向导尚未开启。发送“安装向导”开始。');if(!['1','2','3'].includes(n))return reply('请选择 1、2 或 3。\n'+this.menu(s));if(Number(revision)!==s.revision)return reply('安装步骤已变化，本次数字未执行。\n'+this.menu(s));if(n==='3'){const cancellation=await this.ops.cancelBinding?.(owner);s.active=false;s.running=false;await this.save(s);return reply((cancellation==='committing'?'切换已经提交，退出不会撤销；请用安装状态核对。\n':'')+'已退出安装向导。已安装内容和原有会话保留；需要时发送“安装向导”继续。')}
 if(s.running){s.resumePhase=s.phase;s.phase='recovery';s.running=false;await this.save(s);return reply(this.menu(s))}
 s.error=null
 try{
  if(s.phase==='environment'){s.mode=n==='1'?'host':'container';if(s.mode==='host')await this.inspect(s);else{const target=await this.ops.containerReadback?.();if(target){s.target=target;s.phase='containerLogin'}else s.phase='containerConfig'}}
  else if(s.phase==='install'){if(n==='1'){await this.operation(s,'install',reply,context);await this.inspect(s)}else await this.inspect(s)}
  else if(s.phase==='login'){if(n==='1')await this.operation(s,'login',reply,context);await this.inspect(s)}
  else if(s.phase==='verify'){if(n==='1'){await this.operation(s,'check',reply,context);s.phase='modelTest'}else await this.inspect(s)}
  else if(s.phase==='containerConfig'){if(n==='2')s.phase='environment';else{const result=await this.operation(s,'containerCreate',reply,context);s.target=result.backend;s.phase='containerLogin'}}
  else if(s.phase==='containerLogin'){if(n==='2')s.phase='environment';else{await this.operation(s,'containerLogin',reply,context);s.phase='bindConfirm'}}
  else if(s.phase==='bindConfirm'){if(n==='2'){await this.operation(s,'containerLogin',reply,context)}else{await this.operation(s,'containerBind',reply,context);s.phase='binding'}}
  else if(s.phase==='binding'){if(n==='2'){await this.ops.manual(reply);return reply(this.menu(s))}if(this.backend?.kind==='podman'&&(!s.target||this.backend.id===s.target))s.phase='verify';else{const r=await this.ops.bindingStatus();if(r==='binding_failed_or_unconfirmed'){s.phase='bindConfirm';s.error='切换未确认，可重新核对后再切换。'}}}
  else if(s.phase==='modelTest'){if(n==='1'){await this.operation(s,'modelTest',reply,context);s.active=false;await this.save(s);return reply('模型测试完成，已确认本次推理成功。现在可以直接聊天；发送“使用说明”随时查阅。')}s.active=false;await this.save(s);return reply('已退出向导。基础连接通过，但尚未确认模型推理；可直接发一条普通消息测试。')}
  else if(s.phase==='recovery'){if(n==='2'){await this.ops.manual(reply);return reply(this.menu(s))}if(s.mode==='host'||this.backend?.kind==='podman')await this.inspect(s);else if(['containerBind','check'].includes(s.lastOperation))s.phase='binding';else if(s.lastOperation==='containerLogin')s.phase='containerLogin';else{const target=await this.ops.containerReadback?.();if(target){s.target=target;s.phase='containerLogin'}else s.phase='containerConfig'}}
 }catch(error){s.running=false;if(context.signal?.aborted){const cancelled=await this.ops.cancelBinding?.(owner);if(cancelled==='committing')await reply('切换已经提交，取消不会撤销；请用安装状态核对。');s.active=false;await this.save(s);return}s.error=this.ops.errorText(error);s.phase=s.lastOperation==='modelTest'?'modelTest':s.phase}
 await this.save(s);await reply(this.menu(s))
 }
 async operation(s,name,reply,context){s.running=true;s.lastOperation=name;await this.save(s);try{const result=await this.ops.perform(name,s,reply,context);context.signal?.throwIfAborted();return result}finally{s.running=false}}
}
