function projectRecord(value){
 if(typeof value?.id!=='string'||!value.id||typeof value.name!=='string')throw Error('CODEX_PROJECT_INVALID')
 return {id:value.id,name:value.name.replace(/[\r\n\t]/g,' ').trim(),roots:(value.roots??[]).map(root=>root.path)}
}

export async function listCodexProjects(rpc){
 const projects=new Map(),cursors=new Set()
 let cursor
 do{
  const page=await rpc.request('project/list',{limit:100,...cursor?{cursor}:{}})
  if(!Array.isArray(page?.data))throw Error('CODEX_PROJECT_LIST_INVALID')
  for(const value of page.data){const project=projectRecord(value);projects.set(project.id,project)}
  cursor=page.nextCursor
  if(cursor!=null&&(typeof cursor!=='string'||!cursor||cursors.has(cursor)||cursors.size>=999))throw Error('CODEX_PROJECT_LIST_PAGINATION_INVALID')
  cursors.add(cursor)
 }while(cursor)
 return [...projects.values()]
}

export const nativeProjects={
 async read(rpc,id){
  const project=projectRecord((await rpc.request('project/read',{projectId:id})).project)
  if(project.id!==id)throw Error('CODEX_PROJECT_CHANGED')
  return project
 },
 async create(rpc,name,path,key){
  const project=projectRecord((await rpc.request('project/create',{name,roots:[{path}],idempotencyKey:key})).project)
  if(project.name!==name||!project.roots.includes(path))throw Error('CODEX_PROJECT_CREATION_UNCONFIRMED')
  return project
 },
 async includeRoots(rpc,id,roots){
  const project=projectRecord((await rpc.request('project/update',{projectId:id,roots:roots.map(path=>({path}))})).project)
  if(project.id!==id||!roots.every(path=>project.roots.includes(path)))throw Error('CODEX_PROJECT_ROOTS_UNCONFIRMED')
  return project
 },
 async createGroup(rpc,name,roots,key){
  const project=projectRecord((await rpc.request('project/create',{name,roots:roots.map(path=>({path})),idempotencyKey:key})).project)
  if(project.name!==name||!roots.every(path=>project.roots.includes(path)))throw Error('CODEX_PROJECT_CREATION_UNCONFIRMED')
  return project
 },
 async rename(rpc,id,name){
  const project=projectRecord((await rpc.request('project/update',{projectId:id,name})).project)
  if(project.id!==id||project.name!==name)throw Error('CODEX_PROJECT_RENAME_UNCONFIRMED')
  return project
 },
 async assignThread(rpc,threadId,projectId){
  await rpc.request('thread/metadata/update',{threadId,projectId})
  const {thread}=await rpc.request('thread/read',{threadId,includeTurns:false})
  if(thread?.id!==threadId||thread.projectId!==projectId)throw Error('CODEX_PROJECT_ASSIGNMENT_UNCONFIRMED')
 },
 async sessions(rpc,id,cursor,limit=50){
  const page=await rpc.request('thread/list',{...(id?{projectId:id}:{}),archived:false,limit,sortKey:'updated_at',sortDirection:'desc',modelProviders:[],...(cursor?{cursor}:{})})
  if(!Array.isArray(page.data)||page.data.some(t=>!t?.id||id&&t.projectId!==id))throw Error('CODEX_PROJECT_THREADS_INVALID')
  return {sessions:page.data.filter(t=>!t.ephemeral&&!t.parentThreadId).map(t=>({threadId:t.id,name:t.name??null,preview:t.preview?.slice(0,300)??null,cwd:t.cwd,status:t.status?.type??null,nativeProjectId:t.projectId??null})),nextCursor:page.nextCursor??null}
 },
}
