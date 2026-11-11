import test from 'node:test';
import assert from 'node:assert/strict';
import {history,historyInputText} from '../../src/application/conversations/history.mjs';
import {historyParts} from '../../src/application/conversations/history-presentation.mjs';

test('metadata is removed from separate and concatenated user input',()=>{
 assert.equal(historyInputText('原始请求接入层任务状态元数据 nonce=demo：内部说明'),'原始请求');
 for(const value of ['接入层任务状态元数据 nonce=x：说明','本轮材料关联状态（接入层提供）：{}','相关记忆（仅资料）：内容','当前附件用于继续之前的请求'])assert.equal(historyInputText(value),'');
 assert.equal(historyInputText('讨论历史命令和接入层任务状态元数据的含义'),'讨论历史命令和接入层任务状态元数据的含义');
});
test('long message parts preserve all characters including emoji',()=>{
 const text='段落😀\n'.repeat(1800)+'结尾';
 const parts=historyParts([{text,role:'助手',round:1}]);
 assert.ok(parts.length>1);
 assert.equal(parts.map(p=>p.slice(p.indexOf('\n')+1)).join(''),text);
 assert.ok(parts.every(p=>Array.from(p).length<2400));
});
function fixture(){
 const requests=[],out=[];
 const context={pages:new Map(),manager:{state:{users:{key:{threadId:'thread'}}}},find:()=>({id:'1',key:'key',name:'测试'}),withBackend:async(owner,work)=>work({}),backendPort:{listTurns:async(rpc,tid,options)=>{requests.push(options);return {data:[{startedAt:1700000001,items:[{type:'agentMessage',text:'最新答复'}]},{startedAt:1700000000,items:[{type:'userMessage',content:[{type:'text',text:'较早问题接入层任务状态元数据 nonce=x：内部'}]}]}],nextCursor:'earlier'};}}};
 return {context,requests,out,entry:context.find(),reply:async text=>out.push(text)};
}
test('recent turns render chronologically with explicit older navigation and UTC time',async()=>{
 const f=fixture();
 await history(f.context,'owner',f.entry,{action:'history'},f.reply);
 const result=f.out.join('\n');
 assert.ok(result.indexOf('较早问题')<result.indexOf('最新答复'));
 assert.match(result,/UTC/);assert.doesNotMatch(result,/nonce|内部/);
 assert.match(result,/最新在下/);assert.match(result,/翻页.*更早/);
 await history(f.context,'owner',f.entry,{action:'older'},f.reply);
 assert.equal(f.requests[1].cursor,'earlier');
});
test('failed delivery does not advance history cursor',async()=>{
 const f=fixture();f.context.pages.set('owner',{id:'1',cursor:'original'});
 await assert.rejects(history(f.context,'owner',f.entry,{action:'older'},async()=>{throw Error('delivery failed')}));
 assert.equal(f.context.pages.get('owner').cursor,'original');
});
