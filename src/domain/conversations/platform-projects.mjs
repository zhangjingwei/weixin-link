// Local project identity survives provider changes. Native IDs are optional links.
export function ensurePlatformProjects(state,owner,entries,users,defaultWorkspace){
 state.platformProjects??={}
 const projects=state.platformProjects[owner]??=[]
 for(const entry of entries){
  if(entry.platformProjectId&&projects.some(p=>p.id===entry.platformProjectId))continue
  const saved=users[entry.key]??{},nativeId=saved.nativeSessions?.codex?.nativeProjectId??saved.nativeProjectId
  let project=nativeId&&projects.find(p=>p.nativeBindings?.codex?.projectId===nativeId)
  if(!project){
   const id='local-'+entry.id
   project={id,name:nativeId?'已关联项目':entry.name,roots:[saved.workspace??defaultWorkspace].filter(Boolean),workspaceVerified:!nativeId,nativeBindings:nativeId?{codex:{projectId:nativeId}}:{}}
   projects.push(project)
  }else if(saved.workspace&&!project.roots.includes(saved.workspace))project.roots.push(saved.workspace)
  entry.platformProjectId=project.id
 }
 return projects
}
