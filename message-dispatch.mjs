/** Serializes intake only; cancelling also invalidates messages not yet handed to SessionManager. */
export class MessageDispatch {
 constructor(){this.users=new Map()}
 cancel(userId){const state=this.users.get(userId);if(state){state.generation++;this.users.delete(userId)}}
 enqueue(userId,work,token){
  let state=this.users.get(userId);if(!state){state={generation:0,tail:Promise.resolve()};this.users.set(userId,state)}
  const generation=state.generation,current=()=>generation===state.generation&&(token?.current()??true)
  const run=state.tail.catch(()=>{}).then(()=>current()?work(current):undefined);state.tail=run
  return run.finally(()=>{if(this.users.get(userId)===state&&state.tail===run)this.users.delete(userId)})
 }
}
