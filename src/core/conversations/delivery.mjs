
export function label(context,key,value){const e=context.entry(key);if(!e||context.root[e.owner].entries.length<2||context.find(e.owner)?.key===key)return value;const prefix=`【会话${e.id} · ${e.name}】\n`;return typeof value==='string'?prefix+value:{...value,text:prefix+value.text};}

export function serialize(context,owner,fn){context.deliveryQueues??=new Map();const run=(context.deliveryQueues.get(owner)??Promise.resolve()).catch(()=>{}).then(fn);context.deliveryQueues.set(owner,run);return run.finally(()=>{if(context.deliveryQueues.get(owner)===run)context.deliveryQueues.delete(owner)})}

export async function flush(context,key,send){const e=context.entry(key);if(!e)return;const saved=context.root[e.owner].entries.find(x=>x.key===key);saved.unread??=[];
 while(saved.unread.length&&context.find(e.owner)?.key===key){const item=saved.unread[0];if(item.state==='sending'||item.state==='unknown')break;item.state='sending';await context.manager.save();try{const result=await send(key,context.label(key,item.value),{checkpoint:()=>context.manager.save()});if(result?.status&&result.status!=='accepted'){item.state=result.status;await context.manager.save();break}saved.unread.shift();await context.manager.save()}catch(error){item.state='unknown';await context.manager.save();throw error}}
 }

export function deliver(context,key,value,options,send){return context.serialize(context.recipient(key),async()=>{
 if(options?.current&&!options.current())return {status:'cancelled'};
 const e=context.entry(key);if(!e)return send(key,value,options);
 if(options?.conversationControl)return send(key,context.label(key,value),options);
 if(e.deleted)return {status:'cancelled'};
 if(context.find(e.owner)?.key===key){await context.flush(key,send);const saved=context.root[e.owner].entries.find(x=>x.key===key);if(!saved.unread?.length)return send(key,context.label(key,value),options);}
 const saved=context.root[e.owner].entries.find(x=>x.key===key);saved.unread??=[];saved.unread.push({value:structuredClone(value),state:'pending'});await context.manager.save();
 const text=typeof value==='string'?value:value.text;
 if(/(?:本轮回答结束|本轮执行失败，回答已结束|本轮已停止)/.test(text)&&context.find(e.owner)?.key!==key)await send(key,`会话${e.id}：${e.name} 的任务已结束，切换${e.id}后查看未展示消息。`,options);
 return {status:'deferred'};
 })}

export function replay(context,key,send){return context.serialize(context.recipient(key),()=>context.flush(key,send))}
