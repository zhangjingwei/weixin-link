/** The SDK awaits handlers within an update batch. Intake must not hold up a later stop command. */
export function nonBlockingHandler(handle,onError=()=>{}, {enter=()=>()=>{}}={}) {
 return message=>{
  const leave=enter()
  void Promise.resolve().then(()=>handle(message)).catch(error=>{try{onError(error)}catch{}}).finally(leave)
 }
}
