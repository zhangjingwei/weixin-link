import {conversationInput} from '../../src/interfaces/wechat/conversation-command.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {voiceCommandInput} from '../../src/wechat/voice-command-input.mjs'
import {TextConversations} from '../../src/application/conversations/text-conversations.mjs'
const voice=text=>({userId:'owner',type:'voice',text:'[voice]',voices:[{text}],raw:{message_id:'voice-1',item_list:[{voice_item:{text}}]}})
test('transcribed voice binds a conversation command before queue classification',()=>{
 const original=voice('列表。'),normalized=voiceCommandInput(original)
 const manager={state:{users:{}},owners:new Set(['owner']),sessions:new Map(),questions:new Map()}
 const conversations=new TextConversations(manager,['owner'],conversationInput)
 assert.equal(conversations.bind(normalized)._conversationCommand.action,'list')
 assert.equal(normalized.raw,original.raw);assert.equal(original.voices.length,1)
 assert.equal(voiceCommandInput(normalized),normalized)
})
test('system commands tolerate ASR punctuation while ordinary text and arguments remain intact',()=>{
 for(const text of ['列表','状态','停止','安装状态','升级','重启'])assert.equal(voiceCommandInput(voice(text+'。')).text,text)
 for(const text of ['给我列出文件。','命名 项目。','补充 保留句号。'])assert.equal(voiceCommandInput(voice(text)).text,text)
})
test('missing transcripts and mixed attachments never become commands',()=>{
 for(const message of [{...voice('停止'),images:[{}]},{...voice('停止'),files:[{}]},{...voice('停止'),voices:[{text:'停止'},{}]},{...voice('停止'),voices:[{}]}])assert.equal(voiceCommandInput(message),message)
})
