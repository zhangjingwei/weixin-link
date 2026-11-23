import {managementTools} from '../../src/application/management/tools.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'
import {controlEndpoint,isPipe} from '../../src/infrastructure/runtime/control-endpoint.mjs'
import {RuntimeControl,controlRequest} from '../../src/infrastructure/runtime/runtime-control.mjs'
import {createSessionProtocol} from '../../src/infrastructure/agents/session-protocol.mjs'
import {managementConfiguration} from '../../src/infrastructure/agents/management-plugin.mjs'

test('real MCP stdio handshake, tools/list, tools/call and post-response activation use private socket',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'zlm-')),socket=controlEndpoint(dir),calls=[]
 const runtime=new RuntimeControl({controlTokenFile:join(dir,'control-token'),onManagement:async req=>{assert.equal(req.capability,'test-private-capability');calls.push(req);if(req.activate)return {accepted:true};if(req.tool==='get_management_operation')return {operationId:'read-only-pending',status:'pending'};if(req.tool==='request_task_stop')return {operationId:'operation-test',status:'pending'};return {projects:[{projectId:'1',name:'Demo'}]}}})
 await runtime.listen(socket);t.after(async()=>{await runtime.close();await rm(dir,{recursive:true,force:true})})
 if(!isPipe(socket))assert.equal((await stat(socket)).mode&0o777,0o600)
 const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../../src/interfaces/cli/management-mcp.mjs',import.meta.url))],env:{ZEROLINK_MANAGEMENT_SOCKET:socket,ZEROLINK_MANAGEMENT_CAPABILITY:'test-private-capability',...runtime.token?{ZEROLINK_MANAGEMENT_PIPE_TOKEN:runtime.token}:{}},stderr:'pipe'})
 const client=new Client({name:'isolated-test',version:'1'},{capabilities:{}});t.after(()=>client.close())
 await client.connect(transport)
 const list=await client.listTools();assert.equal(list.tools.length,managementTools.length);assert(list.tools.every(tool=>tool.inputSchema.additionalProperties===false))
 const result=await client.callTool({name:'list_projects',arguments:{}});assert.equal(result.structuredContent.projects[0].name,'Demo')
 const invalid=await client.callTool({name:'list_projects',arguments:{ownerId:'victim'}});assert.equal(invalid.isError,true);assert.match(invalid.content[0].text,/INVALID_ARGUMENTS/)
 const stopped=await client.callTool({name:'request_task_stop',arguments:{projectId:'1',taskId:'task',turnId:'turn',requestId:'request'}});assert.equal(stopped.structuredContent.status,'pending')
 await new Promise(resolve=>setTimeout(resolve,100))
 assert.equal(calls.filter(c=>c.activate==='operation-test').length,1)
 await client.callTool({name:'get_management_operation',arguments:{operationId:'read-only-pending'}})
 await new Promise(resolve=>setTimeout(resolve,100))
 assert.equal(calls.filter(c=>c.activate==='read-only-pending').length,0)
 assert(!JSON.stringify(list).includes('test-private-capability'))
 await controlRequest(socket,'POST','/drain',{lease:'test-lease'},2500,{token:runtime.token})
 const unavailable=await client.callTool({name:'list_projects',arguments:{}});assert.match(unavailable.content[0].text,/MANAGEMENT_UNAVAILABLE/)
})
test('trusted MCP config is reapplied on start and resume, without creating a catalogue tool channel',async()=>{
 const requests=[],rpc={async request(method,params){requests.push([method,params]);if(method==='thread/memoryMode/set')return {};return {thread:{id:'existing'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}}}
 let created
 const protocol=createSessionProtocol({providerEnv:{},rpcFactory:options=>{created=options;return rpc}})
 const config=managementConfiguration({socket:'/private/socket',capability:'ephemeral',sourceRoot:'/source'})
 protocol.createRpc({management:config})
 assert(!created.providerOptions.args.join(' ').includes('ephemeral'))
 assert.equal(created.providerSecrets.ZEROLINK_MANAGEMENT_CAPABILITY,'ephemeral')
 await protocol.open(rpc,{saved:{},cwd:'/work',instructions:'rules',provider:protocol.providerOptions()})
 await protocol.resume(rpc,{threadId:'existing',cwd:'/work',instructions:'rules',provider:protocol.providerOptions()})
 const starts=requests.filter(([method])=>['thread/start','thread/resume'].includes(method));assert.equal(starts.length,2)
 for(const [,params]of starts)assert.equal(params.config['mcp_servers.zerolink-management'].command,process.execPath)
 const reader={async request(method,params){if(method==='thread/start')assert(!params.config['mcp_servers.zerolink-management']);return {thread:{id:'existing'},sandbox:{type:'dangerFullAccess'},approvalPolicy:'never'}}}
 await protocol.open(reader,{saved:{},cwd:'/work',instructions:'rules',provider:protocol.providerOptions()})
})
