import {randomUUID} from 'node:crypto'
import {monitorEventLoopDelay} from 'node:perf_hooks'
/** Metadata-only instrumentation around installed SDK components. Never serializes payloads. */
export function traceIngress(bot,log){
 const arrivals=new WeakMap()
 const shape=wire=>({messageId:wire?.message_id??wire?.client_id,seq:typeof wire?.seq==='number'?wire.seq:undefined,source_ms:wire?.create_time_ms,parts:wire?.item_list?.length??0,kind:(wire?.item_list??[]).map(x=>Number.isInteger(x.type)?x.type:'unknown').join('-').slice(0,100)||'empty',count:(wire?.item_list??[]).filter(x=>x.is_completed===true).length,reason:wire?.group_id?'group_present':wire?.parent_id?'parent_present':(wire?.item_list??[]).some(x=>x.ref_msg)?'reference_present':'no_explicit_group'})
 const api=bot.api.getUpdates.bind(bot.api)
 bot.api.getUpdates=async(...args)=>{
  const trace_id=randomUUID(),start=Date.now();log('ingress.poll_started',{trace_id})
  try{const result=await api(...args);const at=Date.now();log('ingress.poll_returned',{trace_id,duration_ms:at-start,count:result.msgs?.length??0})
   for(const wire of result.msgs??[]){arrivals.set(wire,{trace_id,at});log('ingress.wire_received',{trace_id,...shape(wire)})}
   return result
  }catch(error){log('ingress.poll_failed',{trace_id,duration_ms:Date.now()-start,error_type:error?.name==='AbortError'?'AbortError':'Error'});throw error}
 }
 const execute=bot.http.executeRequest.bind(bot.http)
 bot.http.executeRequest=async(options)=>{
  let poll=false;try{poll=new URL(options.url).pathname==='/ilink/bot/getupdates'}catch{}
  if(!poll)return execute(options)
  const trace_id=randomUUID(),start=Date.now();log('ingress.http_started',{trace_id})
  try{const result=await execute(options);log('ingress.http_returned',{trace_id,duration_ms:Date.now()-start,count:result.data?.msgs?.length??0});return result}
  catch(e){log('ingress.http_failed',{trace_id,duration_ms:Date.now()-start});throw e}
 }
 const parse=bot.parser.parse.bind(bot.parser)
 bot.parser.parse=wire=>{const meta=arrivals.get(wire)??{};log('ingress.parse_started',{...meta,...shape(wire),duration_ms:meta.at?Date.now()-meta.at:undefined});const result=parse(wire);log('ingress.parse_completed',{trace_id:meta.trace_id,...shape(wire),status:result?'parsed':'filtered'});return result}
 const callback=message=>{const meta=arrivals.get(message.raw)??{};log('ingress.sdk_callback',{trace_id:meta.trace_id,...shape(message.raw),duration_ms:meta.at?Date.now()-meta.at:undefined})}
 const histogram=monitorEventLoopDelay({resolution:20});histogram.enable()
 const timer=setInterval(()=>{const max=histogram.max/1e6;if(max>200)log('ingress.event_loop_delayed',{duration_ms:Math.round(max)});histogram.reset()},30000);timer.unref()
 return {callback,close(){clearInterval(timer);histogram.disable()}}
}
