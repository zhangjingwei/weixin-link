import {controlRequest} from '../../infrastructure/runtime/runtime-control.mjs'
import {serveManagement} from '../mcp/management-server.mjs'
const socket=process.env.ZEROLINK_MANAGEMENT_SOCKET,capability=process.env.ZEROLINK_MANAGEMENT_CAPABILITY,options={token:process.env.ZEROLINK_MANAGEMENT_PIPE_TOKEN}
if(!socket||!capability){process.stderr.write('MANAGEMENT_CONTEXT_REQUIRED\n');process.exitCode=1}
else await serveManagement({
 call:(tool,args)=>controlRequest(socket,'POST','/management',{capability,tool,args},25000,options),
 activate:id=>controlRequest(socket,'POST','/management',{capability,activate:id},5000,options),
})
