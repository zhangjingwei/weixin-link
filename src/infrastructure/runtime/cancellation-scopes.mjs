/** Intake shares a generation. Once a turn starts it can finish independently of the queue. */
export class CancellationScopes {
  constructor(){
    this.scopes=new Map()
    this.active=new Map()
    this.listeners=new Set()
  }
  capture(userId){
    let scope=this.scopes.get(userId)
    if(!scope){
      scope=new AbortController()
      this.scopes.set(userId,scope)
    }
    return {
      get signal(){return scope.signal},
      current:()=>!scope.signal.aborted,
      activate:()=>{
        if(scope.signal.aborted||this.active.get(userId)===scope)return
        scope=new AbortController()
        this.active.set(userId,scope)
      }
    }
  }
  cancel(userId,{preserveActive=false,queueAlreadyCancelled=false}={}){
    if(!preserveActive){
      this.active.get(userId)?.abort()
      this.active.delete(userId)
    }
    this.scopes.get(userId)?.abort()
    this.scopes.set(userId,new AbortController())
    for(const fn of this.listeners)fn(userId,{queueAlreadyCancelled})
  }
  onCancel(fn){this.listeners.add(fn);return ()=>this.listeners.delete(fn)}
  close(){for(const id of this.scopes.keys())this.cancel(id)}
}
