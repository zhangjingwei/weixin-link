import test from 'node:test'
import assert from 'node:assert/strict'
import {messageIntent} from '../../src/application/intake/message-intent.mjs'
import {createCommandClassifier} from '../../src/wechat/command-classifier.mjs'

test('intent classification has one ordered rule and ignores media', () => {
  const calls = []
  const parsers = {hasMedia: message => !!message.media}
  for (const kind of ['diagnostic', 'setup', 'conversation', 'session']) parsers[kind] = () => {calls.push(kind); return kind === 'conversation' ? {action: 'switch'} : null}
  assert.deepEqual(messageIntent({text: '切换智能体'}, parsers), {kind: 'conversation', value: {action: 'switch'}})
  assert.deepEqual(calls, ['diagnostic', 'setup', 'conversation'])
  calls.length = 0
  assert.equal(messageIntent({text: '切换智能体', media: true}, parsers), null)
  assert.deepEqual(calls, [])
})

test('only recovery commands and bound prompt replies bypass model intake',()=>{
 const classify=createCommandClassifier()
 for(const text of ['停止','退出','stop','exit'])assert.equal(classify({text})?.kind,'session')
 assert.deepEqual(classify({text:'服务状态'}),{kind:'diagnostic',value:'service'})
 assert.deepEqual(classify({text:'安装帮助',_setupAction:'help'}),{kind:'setup',value:'help'})
 for(const text of ['关闭','代码审查','压缩上下文','分叉会话','开启快速模式','记忆','重启','升级'])assert.equal(classify({text}),null)
 assert.deepEqual(classify({text:'批准',_promptReply:true,_sessionCommand:{action:'approval',code:'question-1',accept:true}}),{kind:'session',value:{action:'approval',code:'question-1',accept:true}})
})
