
export function label(context,key,value){const e=context.entry(key);if(!e||context.root[e.owner].entries.length<2)return value;const prefix=`【会话${e.id} · ${e.name}】\n`;return typeof value==='string'?prefix+value:{...value,text:prefix+value.text};}

export function serialize(context,owner,fn){context.deliveryQueues??=new Map();const run=(context.deliveryQueues.get(owner)??Promise.resolve()).catch(()=>{}).then(fn);context.deliveryQueues.set(owner,run);return run.finally(()=>{if(context.deliveryQueues.get(owner)===run)context.deliveryQueues.delete(owner)})}

export async function flush(context,key,send){}

export function deliver(context,key,value,options,send){}

export function replay(context,key,send){return context.serialize(context.recipient(key),()=>context.flush(key,send))}
