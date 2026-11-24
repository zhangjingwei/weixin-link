import {taskDisplayTitle} from '../../domain/tasks/task-label.mjs'
import {projectTaskRoute} from '../tasks/project-dispatch.mjs'

export function label(context,key,value){const e=context.entry(key);if(!e||context.root[e.owner].entries.length<2||context.find(e.owner)?.key===key)return value;const prefix=`【会话${e.id} · ${e.name}】\n`;return typeof value==='string'?prefix+value:{...value,text:prefix+value.text};}

export function serialize(context,owner,fn){context.deliveryQueues??=new Map();const run=(context.deliveryQueues.get(owner)??Promise.resolve()).catch(()=>{}).then(fn);context.deliveryQueues.set(owner,run);return run.finally(()=>{if(context.deliveryQueues.get(owner)===run)context.deliveryQueues.delete(owner)})}

function routedHeading(input){
 const savedTitle=input?.projectDispatch?.title
 const source=savedTitle===taskDisplayTitle(input)?input?.text:savedTitle??input?.text
 const title=String(source??'').replace(/[\x00-\x1f\x7f【】]/g,' ').replace(/\s+/g,' ').trim()
  .replace(/^[\p{L}\p{N}_-]{1,24}\s*项目[：:，,\s]+/u,'')
  .replace(/^(?:我想|想要?|请(?:你)?|帮我|麻烦(?:你)?)[，,\s]*/u,'')
  .split(/[，。！？；]/,1)[0].trim()
 const chars=Array.from(title||'当前任务')
 return chars.slice(0,18).join('')+(chars.length>18?'…':'')
}

export async function flush(context,key,send){const e=context.entry(key);if(!e)return;const saved=context.root[e.owner].entries.find(x=>x.key===key);saved.unread??=[];
 while(saved.unread.length&&context.find(e.owner)?.key===key){const item=saved.unread[0];if(item.state==='sending'||item.state==='unknown')break;item.state='sending';await context.manager.save();try{const result=await send(key,context.label(key,item.value),{checkpoint:()=>context.manager.save(),traceId:item.traceId});if(result?.status!=='accepted'){item.state=['deferred','partial','unknown','cancelled','failed'].includes(result?.status)?result.status:'unknown';await context.manager.save();break}saved.unread.shift();await context.manager.save()}catch(error){item.state='unknown';await context.manager.save();throw error}}
 }

export function deliver(context,key,value,options,send){return context.serialize(context.recipient(key),async()=>{
 if(options?.current&&!options.current())return {status:'cancelled'};
 const e=context.entry(key);if(!e){if(options?.projectTaskId)throw Error('PROJECT_TASK_ROUTE_INVALID');return send(key,value,options);}
 if(options?.projectTaskId){
  const job=context.manager.submissions?.get(options.projectTaskId)
  if(!job||job.owner!==key||!projectTaskRoute({manager:context.manager,conversations:context},job))throw Error('PROJECT_TASK_ROUTE_INVALID')
  const model=job.context?.executionModel
  const modelName=typeof model==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(model)?model:'未确认'
  const heading=routedHeading(job.input)
  const name=String(e.name??'').replace(/[\x00-\x1f\x7f【】]/g,' ').replace(/\s+/g,' ').trim()
  const shortName=Array.from(name).length<=8&&!/^(?:原有对话|当前会话|未命名|会话\d+)/.test(name)&&name!==heading?name:null
  const identity=shortName?`${shortName}（会话${e.id}）`:`会话${e.id}`
  const prefix=`【${heading}】\n${identity}${modelName==='未确认'?'':' · 模型 '+modelName}\n\n`
  return send(key,typeof value==='string'?prefix+value:{...value,text:prefix+value.text},options)
 }
 if(options?.conversationControl)return send(key,context.label(key,value),options);
 if(e.deleted)return {status:'cancelled'};
 if(context.find(e.owner)?.key===key){await context.flush(key,send);const saved=context.root[e.owner].entries.find(x=>x.key===key);if(!saved.unread?.length)return send(key,context.label(key,value),options);}
 const saved=context.root[e.owner].entries.find(x=>x.key===key);saved.unread??=[];saved.unread.push({value:structuredClone(value),state:'pending',traceId:options?.traceId});await context.manager.save();
 const text=typeof value==='string'?value:value.text;
 if(/(?:本轮回答结束|本轮执行失败，回答已结束|本轮已停止)/.test(text)&&context.find(e.owner)?.key!==key)await send(key,`会话${e.id}：${e.name} 的任务已结束，你可以说“看看${e.name}的结果”。`,options);
 return {status:'deferred'};
 })}

export function replay(context,key,send){return context.serialize(context.recipient(key),()=>context.flush(key,send))}
