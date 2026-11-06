/** Account-local, serialized native typing state. Failures never block task execution. */
export class TypingStatus {
 constructor({start,stop,log=()=>{},refreshMs=8000,now=Date.now}){Object.assign(this,{start,stop,log,refreshMs,now});this.users=new Map();this.closed=false}
 sync(active){
  if(this.closed)return
  const owners=new Set([...active,...this.users.keys()])
  for(const owner of owners){
   let s=this.users.get(owner)
   if(!s){s={wanted:false,shown:false,last:-Infinity,pending:false};this.users.set(owner,s)}
   s.wanted=active.has(owner)
   this.drive(owner,s)
  }
 }
 drive(owner,s){
  if(s.pending)return
  const start=s.wanted
  if(start?s.shown&&this.now()-s.last<this.refreshMs:!s.shown){if(!start)this.users.delete(owner);return}
  s.pending=true;s.last=this.now()
  // Mark an attempted start too: a timed-out request may already be visible at WeChat.
  if(start)s.shown=true
  void Promise.resolve().then(()=>start?this.start(owner):this.stop(owner)).then(()=>{if(start!==s.logged){this.log('wechat.typing_requested',{userId:owner,status:start?'active':'inactive'});s.logged=start}}).catch(()=>this.log('wechat.typing_failed',{userId:owner,stage:start?'start':'stop'})).finally(()=>{
   s.pending=false;if(!start)s.shown=false
   if(s.wanted!==start)this.drive(owner,s)
   else if(!s.wanted)this.users.delete(owner)
  })
 }
 close(){this.closed=true;for(const [owner,s] of this.users){s.wanted=false;this.drive(owner,s)}}
}
export function typingOwners(manager){
 const blocked=new Set([...manager.questions.values()].map(q=>q.session.userId))
 return new Set([...manager.sessions.values()].filter(s=>!s.exited&&!s.exiting&&s.state!=='stopping'&&s.state!=='connecting'&&!blocked.has(s.userId)&&(s.workToken?.current()??true)&&(s.busy||s.finishing)).map(s=>s.userId))
}
