import {existsSync} from 'node:fs'
import {delimiter,dirname,join} from 'node:path'
// Keep the active Node available to npm lifecycle scripts in background services.
export function nodeEnvironment(env=process.env,node=process.execPath){return {...env,PATH:[dirname(node),env.PATH??''].filter(Boolean).join(delimiter)}}
// Prefer npm shipped with the active Node; do not depend on a login shell.
export function npmCommand(args,{platform=process.platform,node=process.execPath,path=process.env.PATH??''}={}){
 if(platform!=='win32'){
  const cli=join(dirname(node),'../lib/node_modules/npm/bin/npm-cli.js')
  return existsSync(cli)?{binary:node,args:[cli,...args]}:{binary:join(dirname(node),'npm'),args}
 }
 const roots=[dirname(node),...path.split(delimiter).filter(Boolean)]
 const cli=roots.map(p=>join(p,'node_modules/npm/bin/npm-cli.js')).find(existsSync)
 if(!cli)throw Error('NPM_CLI_NOT_FOUND')
 return {binary:node,args:[cli,...args]}
}
