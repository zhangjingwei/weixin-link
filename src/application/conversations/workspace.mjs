import {realpath,stat,readdir} from 'node:fs/promises'
import {isAbsolute,join,basename} from 'node:path'

export async function projectFolderChoices(context,key){
 const root=await realpath(workspaceText(context,key))
 const children=await readdir(root,{withFileTypes:true})
 const privateState=context.manager.stateDir?await realpath(context.manager.stateDir).catch(()=>null):null
 const choices=[{name:`当前文件夹（${basename(root)}）`,path:root}]
 const folders=children.filter(entry=>entry.isDirectory()&&!entry.name.startsWith('.')&&entry.name!=='node_modules'&&join(root,entry.name)!==privateState).sort((a,b)=>a.name.localeCompare(b.name))
 for(const child of folders.slice(0,25)){
  choices.push({name:child.name.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,60),path:join(root,child.name)})
 }
 choices.more=folders.length>25
 return choices
}

export async function bindNewWorkspace(context,key,path){
 if(!path)return
 if(!isAbsolute(path)||/[\0\r\n]/.test(path))throw Error('项目目录必须是现有目录的绝对路径。')
 const saved=context.manager.state.users[key]??={}
 if(saved.threadId||context.manager.sessions.has(key)||saved.hasMessages)throw Error('已有会话不能迁移目录，请新建项目。')
 const actual=await realpath(path)
 if(!(await stat(actual)).isDirectory())throw Error('项目路径不是目录。')
 saved.workspace=actual
 await context.manager.save()
}
export function workspaceText(context,key){return context.manager.workspaceFor?.(key)??context.manager.cwd??'未配置'}
