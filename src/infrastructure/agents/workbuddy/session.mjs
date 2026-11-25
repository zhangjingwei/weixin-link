import {AcpSession} from '../acp/session.mjs'
import {workbuddyEnvironment} from './environment.mjs'
export class WorkbuddySession extends AcpSession {
 constructor(options){super({...options,kind:'workbuddy',name:'WorkBuddy',environment:workbuddyEnvironment,args:instructions=>['--acp','--strict-mcp-config','{"mcpServers":{}}','--permission-mode','default',...instructions?['--append-system-prompt',instructions]:[]]})}
}
