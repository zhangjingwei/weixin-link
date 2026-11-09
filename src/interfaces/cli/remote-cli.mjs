#!/usr/bin/env node
// Structured stdin only: no user prompt is ever concatenated into a remote shell command.
import {RemoteController} from '../../application/remote-tasks/remote-controller.mjs'
import {remoteWorkspace} from '../../remote/remote-paths.mjs'
import {pathToFileURL} from 'node:url'
export async function runRemoteCli(){
let input=''
try{for await(const chunk of process.stdin){input+=chunk;if(input.length>128*1024)throw Error('INPUT_TOO_LARGE')}const request=JSON.parse(input),controller=new RemoteController({root:remoteWorkspace}),result=await controller.run(request);if(request.watch===true&&['start','send'].includes(request.action)){try{result.progress=await controller.run({action:'watch',task:result.task,timeoutMs:request.timeoutMs})}catch(error){result.progress={error:error.message,task:result.task}}}console.log(JSON.stringify({ok:true,...result}))}
catch(error){console.log(JSON.stringify({ok:false,error:error.message,method:error.method,rpc_code:error.rpcCode,task:error.task}));process.exitCode=1}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runRemoteCli()
