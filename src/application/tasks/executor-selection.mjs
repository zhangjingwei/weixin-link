// Before a conversation has an executor, accept only an explicit list choice.
export function selectionRequest(text){
 const value=String(text??'').trim()
 const match=/^(?:绑定\s*)?(codex|claude(?:\s+code)?|workbuddy|doubao|豆包|grok)$/i.exec(value)
 return match?{kind:match[1].toLowerCase().replace(/^claude\s+code$/,'claude').replace('豆包','doubao')}:null
}

export async function offerAgents(context,job,reply,{keep=true}={}){
 if(context.jobs.get(job.id)?.state!=='pending')return
 const agents=context.manager.protocol.availableAgents??[]
 if(keep)context.jobs.waitForAgent(job.owner,job.id)
 else context.jobs.mark(job.id,'done')
 await reply((keep?'原消息已保留。':'')+(agents.length?'可用执行器：'+agents.join('、')+'。请回复执行器名称。':'当前没有可用执行器，请在主机配置后重试。'))
}
