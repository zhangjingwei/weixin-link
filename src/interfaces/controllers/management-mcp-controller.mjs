import {randomBytes} from 'node:crypto'
import {validateManagementCall} from '../../application/management/tools.mjs'

// The capability identifies the live RPC attempt, never a model-supplied owner ID.
export function createManagementMcpController({manager,service,configuration}){
 const bindings=new Map()
 return {
  bind(session,attempt){
   for(const [token,binding]of bindings)if(binding.session===session||!binding.attempt.current)bindings.delete(token)
   const capability=randomBytes(32).toString('hex');bindings.set(capability,{session,attempt})
   return configuration(capability)
  },
  async onRequest(request){
   const binding=bindings.get(request?.capability)
   if(!binding||!binding.attempt.current||binding.attempt.closing||manager.sessions.get(binding.session.userId)!==binding.session)throw Error('MANAGEMENT_FORBIDDEN')
   if(request.activate){await service.activate(binding.session.userId,request.activate);return {accepted:true}}
   validateManagementCall(request.tool,request.args)
   return service.call(binding.session.userId,request.tool,request.args)
  },
  close(){bindings.clear();service.close()},
 }
}
