// SDK running state does not become false while it waits for reauthentication.
export function trackLoginValidity(bot){
 const state={valid:false}
 bot.on('login',()=>{state.valid=true})
 bot.on('session:expired',()=>{state.valid=false})
 bot.on('session:restored',()=>{state.valid=true})
 return state
}
