import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {managementTools,validateManagementCall} from '../../application/management/tools.mjs'

export async function serveManagement({call,activate,transport=new StdioServerTransport()}){
 const server=new Server({name:'zerolink-management',version:'1.0.0'},{capabilities:{tools:{}}})
 const pending=new Map(),send=transport.send.bind(transport)
 // Never cancel the caller before the tool result has reached the stdio transport.
 transport.send=async message=>{
  try{await send(message)}catch(error){pending.delete(message.id);throw error}
  const id=pending.get(message.id)
  if(id&&message.result?.structuredContent?.operationId===id&&message.result.structuredContent.status==='pending'){pending.delete(message.id);void activate(id).catch(()=>{})}
  else if(message.error)pending.delete(message.id)
 }
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:managementTools}))
 server.setRequestHandler(CallToolRequestSchema,async (request,extra)=>{
  try{
   const {name,arguments:args={}}=request.params;const spec=validateManagementCall(name,args)
   const result=await call(name,args)
   if(!spec.annotations.readOnlyHint&&result.operationId&&result.status==='pending')pending.set(extra.requestId,result.operationId)
   return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result}
  }catch(error){return {isError:true,content:[{type:'text',text:/^MANAGEMENT_[A-Z_]+$/.test(error.message)?error.message:'MANAGEMENT_UNAVAILABLE'}]}}
 })
 await server.connect(transport)
 return server
}
