const states=new Set(['connecting','idle','running','stopping','delivering','closed'])
/** All legacy flags are projections of this state, written together at one boundary. */
export function transition(session,state){
 if(!states.has(state))throw Error('Invalid lifecycle state')
 if(session.state==='closed'&&state!=='closed')return false
 Object.assign(session,{state,connecting:state==='connecting',busy:state==='running'||state==='stopping',finishing:state==='delivering',exited:state==='closed'})
 if(state==='closed')session.exiting=false
 return true
}
