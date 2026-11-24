export const entryActions=new Set(['task','supplement','status','routing_status','history','result','stop','cancel','cancel_all','prioritize','clarify'])

export function entryPlan(decision,text,projects){
 const steps=decision?.action==='batch'?decision.steps:[decision]
 if(!Array.isArray(steps)||!steps.length||steps.length>5)throw Error('ENTRY_PLAN_INVALID')
 return steps.map((step,index)=>{
  if(!step||!entryActions.has(step.action)||step.action!=='clarify'&&!projects.some(p=>p.projectId===step.projectId))throw Error('ENTRY_PLAN_INVALID')
  if(decision?.action==='batch'&&(step.action!=='task'||typeof step.text!=='string'||!step.text.trim()||!text.includes(step.text)))throw Error('ENTRY_PLAN_INVALID')
  if(step.requestedProjectName&&!['当前项目','这个项目','本项目'].includes(step.requestedProjectName)){
   if(!text.includes(step.requestedProjectName))throw Error('ENTRY_TARGET_UNCONFIRMED')
   const q=step.requestedProjectName.normalize('NFKC').trim().toLowerCase(),matches=projects.filter(project=>{const name=project.name?.normalize('NFKC').toLowerCase()??'';return q.length>=2&&(name.includes(q)||q.includes(name))})
   if(matches.length!==1||matches[0].projectId!==step.projectId)throw Error('ENTRY_TARGET_UNCONFIRMED')
  }
  const dependencies=step.dependsOn??[]
  if(!Array.isArray(dependencies)||new Set(dependencies).size!==dependencies.length||dependencies.some(n=>!Number.isInteger(n)||n<0||n>=index))throw Error('ENTRY_DEPENDENCY_INVALID')
  return {...step,dependsOn:dependencies}
 })
}
