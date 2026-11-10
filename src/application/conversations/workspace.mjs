import {realpath,stat} from 'node:fs/promises'
import {isAbsolute} from 'node:path'

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
