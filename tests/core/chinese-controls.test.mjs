import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import test from 'node:test';import assert from 'node:assert/strict';import {controlCommand} from '../../src/base/codex/codex-session.mjs';
test('Chinese controls use the exact same actions as existing English commands',()=>{for(const [zh,en]of [['停止','stop'],['结果','result'],['恢复','recover'],['退出','exit'],['模型','models'],['状态','status'],['停止任务','stop'],['查看结果','result'],['恢复任务','recover'],['退出会话','exit'],['帮助','help']]){assert.equal(controlCommand(zh).action,en);assert.equal(controlCommand('/'+en).action,en);assert.equal(controlCommand(zh+'。').action,en)}});
test('ordinary business requests containing control words are never intercepted',()=>{for(const s of ['看看服务器状态','帮我恢复任务记录文件','查看结果页面的布局','停止任务后会怎样','退出会话是什么意思'])assert.equal(controlCommand(s),null)});

test('two-character memory command lists memories',()=>assert.deepEqual(controlCommand('记忆'),{action:'memory',op:'list'}));

test('Chinese memory switches use official memory control actions without intercepting ordinary requests',()=>{
 assert.deepEqual(controlCommand('开启记忆'),{action:'memory',op:'auto',on:true})
 assert.deepEqual(controlCommand('关闭记忆。'),{action:'memory',op:'auto',on:false})
 assert.deepEqual(controlCommand('查看记忆'),{action:'memory',op:'list'})
 for(const text of ['帮我开启记忆里的文件','关闭记忆会怎样','余额','/balance','/codex balance','/余额','查询 DeepSeek 账户余额'])assert.equal(controlCommand(text),null)
})

test('Chinese setup names are exact controls and legacy names still route',async()=>{
 const {setupCommand}=await import('../../src/setup/setup-controller.mjs')
 for(const [label,action]of [['安装智能体','install'],['登录智能体','login'],['验收智能体','check'],['安装Codex','install']])assert.equal(setupCommand(label),action)
 assert.equal(setupCommand('帮我配置远程主机'),null)
 assert.equal(controlCommand('帮我创建第二个机器人账号'),null)
})

test('WeChat help covers Chinese operations and delegates configuration without English chat commands',async()=>{
 const {SessionManager}=await import('../../src/base/codex/codex-session.mjs')
 const out=[],manager=new SessionManager({stateDir:'/unused',cwd:'/unused',owners:['owner'],rpcFactory:()=>{throw Error('help must not start model')}})
 manager.save=async()=>{};manager.state.users.owner={}
 await manager.handle('owner','帮助',async value=>out.push(value))
 assert(out.some(s=>s.includes('开启记忆')&&s.includes('配置远程主机')))
 assert(!out.join('').includes('/balance'));assert(!out.join('').includes('/memory'))
 const {SetupController}=await import('../../src/setup/setup-controller.mjs')
 const home=await mkdtemp(join(tmpdir(),'zero-help-')),controller=new SetupController({stateDir:home}),help=[];await controller.wizard.ready
 await controller.handle('help',async s=>help.push(s))
 assert(help[0].includes('安装智能体'));assert(help[0].includes('配置'));await rm(home,{recursive:true,force:true})
})
