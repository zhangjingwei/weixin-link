import {access,stat} from 'node:fs/promises'
import {constants} from 'node:fs'
import {delimiter,isAbsolute,join} from 'node:path'
import {inspectSystemCodex} from './codex/installation.mjs'
import {inspectClaude} from './claude/installation.mjs'
import {inspectDoubao} from './doubao/installation.mjs'
import {inspectGrok} from './grok/installation.mjs'
import {inspectWorkbuddy} from './workbuddy/installation.mjs'

// Discover optional adapters for this process. Explicit paths always win; do not
// rewrite account configuration or change a conversation's selected agent.
export async function discoverAgentBinaries(selected,{env=process.env,platform=process.platform,kinds,verifyExplicit=false,inspectors={codex:inspectSystemCodex,claude:inspectClaude,workbuddy:inspectWorkbuddy,doubao:inspectDoubao,grok:inspectGrok}}={}){
 const binaries={}
 const directories=[...new Set((env.PATH??env.Path??'').split(delimiter).filter(path=>isAbsolute(path)))]
 await Promise.all(Object.entries({codex:'codex',claude:'claude',workbuddy:'codebuddy',doubao:'doubao',grok:'grok'}).map(async([kind,name])=>{
  if((kinds&&!kinds.includes(kind))||typeof inspectors[kind]!=='function')return
  const explicit=selected[kind+'Binary']??(selected.kind===kind?selected.binary:null)
  if(explicit){if(verifyExplicit||kind==='codex'){try{await inspectors[kind](explicit,{env})}catch{return}}binaries[kind+'Binary']=explicit;return}
  // Batch-file shims require a shell and are not supported by stdio transports.
  const names=platform==='win32'?[name+'.exe',name]:[name]
  for(const directory of directories)for(const name of names){
   const binary=join(directory,name)
   try{
    if(!(await stat(binary)).isFile())continue
    await access(binary,platform==='win32'?constants.F_OK:constants.X_OK)
   }catch{continue}
   try{await inspectors[kind](binary,{env});binaries[kind+'Binary']=binary}catch(error){
    if(kind==='codex'&&error.code==='CODEX_PROJECT_BINARY')continue
   }
   // Respect PATH precedence even when the installed CLI is incompatible.
   return
  }
 }))
 return binaries
}
