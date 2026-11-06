import test from 'node:test';import assert from 'node:assert/strict';import {controlCommand} from '../../src/base/codex/codex-session.mjs';
test('Chinese controls use the exact same actions as existing English commands',()=>{for(const [zh,en]of [['停止','stop'],['结果','result'],['恢复','recover'],['退出','exit'],['余额','balance'],['模型','models'],['状态','status'],['停止任务','stop'],['查看结果','result'],['恢复任务','recover'],['退出会话','exit'],['帮助','help']]){assert.equal(controlCommand(zh).action,en);assert.equal(controlCommand('/'+en).action,en);assert.equal(controlCommand(zh+'。').action,en)}});
test('ordinary business requests containing control words are never intercepted',()=>{for(const s of ['看看服务器状态','帮我恢复任务记录文件','查看结果页面的布局','停止任务后会怎样','退出会话是什么意思'])assert.equal(controlCommand(s),null)});

test('two-character memory command lists memories',()=>assert.deepEqual(controlCommand('记忆'),{action:'memory',op:'list'}));
