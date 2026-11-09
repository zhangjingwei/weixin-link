import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {resolve,dirname,relative} from 'node:path'
import {fileURLToPath} from 'node:url'

const root=fileURLToPath(new URL('../../src/',import.meta.url))
// Direction follows the existing composition boundary; no lower module may
// import a module above it. Tools and process entry points are separate roots.
const allowed={
 domain:[],
 base:['domain'],
 infrastructure:['base','domain'],
 application:['base','domain','infrastructure'],
 integrations:['application','infrastructure'],
 setup:['base','domain','infrastructure','integrations'],
 interfaces:['application','base','infrastructure','setup'],
 wechat:['application','base','infrastructure','integrations','interfaces','setup'],
}
const entryPoints=new Set(['setup/service-entry.mjs'])

test('runtime modules form an acyclic cross-layer dependency graph',async()=>{
 const files=(await readdir(root,{recursive:true})).filter(name=>name.endsWith('.mjs'))
 const edges=new Map(Object.keys(allowed).map(name=>[name,new Set()]))
 for(const name of files){
  const source=name.split(/[\\/]/)[0]
  if(!Object.hasOwn(allowed,source)||entryPoints.has(name))continue
  const text=await readFile(resolve(root,name),'utf8')
  const imports=text.matchAll(/(?:\bfrom\s*|\bimport\s*\(|(?<!\.)\bimport\s*)['"](\.{1,2}\/[^'"]+)['"]/g)
  for(const [,specifier] of imports){
   const target=relative(root,resolve(dirname(resolve(root,name)),specifier)).split(/[\\/]/)[0]
   if(target===source||!Object.hasOwn(allowed,target))continue
   edges.get(source).add(target)
   assert.ok(allowed[source].includes(target),`${name} imports ${target} through ${specifier}`)
  }
 }
 const visited=new Set(),active=[]
 function visit(source){
  assert.ok(!active.includes(source),`cross-layer cycle: ${[...active,source].join(' -> ')}`)
  if(visited.has(source))return
  active.push(source)
  for(const target of edges.get(source))visit(target)
  active.pop();visited.add(source)
 }
 for(const source of edges.keys())visit(source)
})
