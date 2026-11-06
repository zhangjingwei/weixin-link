import {existsSync} from 'node:fs'
import {delimiter,dirname,join} from 'node:path'
// Invoke npm's JS entry point directly on Windows; never interpolate a cmd.exe command.
export function npmCommand(args,{platform=process.platform,node=process.execPath,path=process.env.PATH??''}={}){
 if(platform!=='win32')return {binary:'npm',args}
 const roots=[dirname(node),...path.split(delimiter).filter(Boolean)]
 const cli=roots.map(p=>join(p,'node_modules/npm/bin/npm-cli.js')).find(existsSync)
 if(!cli)throw Error('NPM_CLI_NOT_FOUND')
 return {binary:node,args:[cli,...args]}
}
