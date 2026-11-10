import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import test from 'node:test';import assert from 'node:assert/strict';import {controlCommand} from '../../src/wechat/session-manager.mjs';
test('Chinese controls keep one spelling per action without slash aliases',()=>{for(const [zh,action]of [['停止','stop'],['结果','result'],['恢复','recover'],['退出','exit'],['模型','models'],['状态','status'],['进度','progress'],['命令列表','help']]){assert.equal(controlCommand(zh).action,action);assert.equal(controlCommand('/'+zh),null);assert.equal(controlCommand(zh+'。').action,action)}for(const alias of ['停止任务','查看结果','重看结果','恢复任务','核对任务','退出会话','退出当前对话','帮助','控制命令','任务状态','任务进度','进度如何了','现在到哪一步了','停止当前任务','中断任务','关闭 codex'])assert.equal(controlCommand(alias),null)});
test('ordinary business requests containing control words are never intercepted',()=>{for(const s of ['看看服务器状态','帮我恢复任务记录文件','查看结果页面的布局','停止任务后会怎样','退出会话是什么意思'])assert.equal(controlCommand(s),null)});

test('two-character memory command lists memories',()=>assert.deepEqual(controlCommand('记忆'),{action:'memory',op:'list'}));

test('Chinese memory switches use official memory control actions without intercepting ordinary requests',()=>{
 assert.deepEqual(controlCommand('开启记忆'),{action:'memory',op:'auto',on:true})
 assert.deepEqual(controlCommand('关闭记忆。'),{action:'memory',op:'auto',on:false})
 assert.equal(controlCommand('查看记忆'),null)
 for(const text of ['帮我开启记忆里的文件','关闭记忆会怎样','余额','/balance','/codex balance','/余额','查询 DeepSeek 账户余额'])assert.equal(controlCommand(text),null)
})

test('Chinese setup names are exact controls without legacy aliases',async()=>{
 const {setupCommand}=await import('../../src/setup/setup-controller.mjs')
 for(const [label,action]of [['安装智能体','install'],['登录智能体','login'],['验收智能体','check']])assert.equal(setupCommand(label),action)
 for(const alias of ['安装Codex','登录Codex','验收Codex','说明书'])assert.equal(setupCommand(alias),null)
 assert.equal(setupCommand('帮我配置远程主机'),null)
 assert.equal(controlCommand('帮我创建第二个机器人账号'),null)
})

test('WeChat help lists Chinese and English commands and delegates configuration',async()=>{
 const {SessionManager}=await import('../../src/wechat/session-manager.mjs')
 const out=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>{throw Error('help must not start model')}})
 manager.save=async()=>{};manager.state.users.owner={}
 await manager.handle('owner','命令列表',async value=>out.push(value))
 assert(out.some(s=>s.includes('开启记忆')&&s.includes('远程主机')&&s.includes('代码审查')))
 assert(out[0].includes('\n状态（status）\n进度（progress）\n补充（supplement）\n'))
 assert(!out.join('').includes('/balance'));assert(!out.join('').includes('/memory'))
 const {SetupController}=await import('../../src/setup/setup-controller.mjs')
 const home=await mkdtemp(join(tmpdir(),'zero-help-')),controller=await new SetupController({stateDir:home}).init(),help=[]
 await controller.handle('help',async s=>help.push(s))
 assert(help[0].includes('安装智能体'));assert(help[0].includes('配置'));await rm(home,{recursive:true,force:true})
})
