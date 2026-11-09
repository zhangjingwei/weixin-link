/** One cancellation generation per owner, shared by ingress, attachments and queued work. */
export class CancellationScopes {
  constructor(){this.scopes=new Map();this.listeners=new Set()}
  capture(userId){
    let scope=this.scopes.get(userId)
    if(!scope){scope=new AbortController();this.scopes.set(userId,scope)}
    return {signal:scope.signal,current:()=>!scope.signal.aborted}
  }
  cancel(userId){this.scopes.get(userId)?.abort();this.scopes.set(userId,new AbortController());for(const fn of this.listeners)fn(userId)}
  onCancel(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn)}
  close(){for(const id of this.scopes.keys())this.cancel(id)}
}
