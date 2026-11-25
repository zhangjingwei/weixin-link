// Compare the bundled Codex protocol with the arguments actually sent by management tools.
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,readFile,readdir,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {findCodex} from '../infrastructure/config/install-config.mjs'
import {CodexRpc} from '../infrastructure/agents/codex/rpc.mjs'
import {initializeCodex} from '../infrastructure/agents/codex/protocol-operations.mjs'
import {managementTools} from '../application/management/tools.mjs'
import {nativeControlMethods,nativeControlParams} from '../application/management/native-controls.mjs'

const root=fileURLToPath(new URL('../..',import.meta.url))
const binary=findCodex()
const exec=promisify(execFile)
const sample=schema=>{
 if(schema.enum)return schema.enum[0]
 if(schema.type==='string')return 'sample'
 if(schema.type==='integer')return schema.minimum??1
 if(schema.type==='boolean')return false
 if(schema.type==='array')return Array.from({length:Math.max(1,schema.minItems??0)},(_,index)=>schema.items?.type==='string'?`sample-${index}`:sample(schema.items))
 if(schema.type==='object')return Object.fromEntries(Object.entries(schema.properties??{}).map(([key,value])=>[key,sample(value)]))
 throw Error('MANAGEMENT_SAMPLE_UNSUPPORTED')
}
const resolve=(schema,definitions)=>schema?.$ref?definitions[schema.$ref.split('/').at(-1)]:schema
function matches(schema,value,definitions){
 schema=resolve(schema,definitions)
 if(schema.anyOf)return schema.anyOf.some(part=>matches(part,value,definitions))
 if(schema.oneOf)return schema.oneOf.filter(part=>matches(part,value,definitions)).length===1
 if(schema.allOf)return schema.allOf.every(part=>matches(part,value,definitions))
 if(schema.const!==undefined&&value!==schema.const)return false
 if(schema.enum&&!schema.enum.includes(value))return false
 const types=Array.isArray(schema.type)?schema.type:[schema.type]
 if(types.includes('null')&&value===null)return true
 if(types.includes('string'))return typeof value==='string'
 if(types.includes('integer'))return Number.isInteger(value)
 if(types.includes('number'))return typeof value==='number'&&Number.isFinite(value)
 if(types.includes('boolean'))return typeof value==='boolean'
 if(types.includes('array'))return Array.isArray(value)&&value.every(item=>matches(schema.items,item,definitions))
 if(types.includes('object'))return !!value&&typeof value==='object'&&!Array.isArray(value)&&
  (schema.required??[]).every(key=>Object.hasOwn(value,key))&&
  Object.entries(value).every(([key,item])=>schema.properties?.[key]?matches(schema.properties[key],item,definitions):schema.additionalProperties===false?false:typeof schema.additionalProperties==='object'?matches(schema.additionalProperties,item,definitions):true)
 return false
}
async function sourceFiles(dir){
 const found=[]
 for(const item of await readdir(dir,{withFileTypes:true})){
  const path=join(dir,item.name)
  if(item.isDirectory())found.push(...await sourceFiles(path))
  else if(item.name.endsWith('.mjs'))found.push(path)
 }
 return found
}
function checkMethods(schema,methods){
 const supported=new Map(schema.oneOf.map(item=>[item.properties?.method?.enum?.[0],item.properties?.params]))
 for(const method of methods)if(!supported.has(method))throw Error(`CODEX_METHOD_MISSING: ${method}`)
 for(const [name,method]of Object.entries(nativeControlMethods)){
  const tool=managementTools.find(item=>item.name===name)
  if(!tool)throw Error(`MANAGEMENT_TOOL_MISSING: ${name}`)
  const args=Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([key,value])=>[key,sample(value)]))
  const params=nativeControlParams(name,args)
  if(name==='request_project_import')params.roots=[{path:'/tmp/isolated-workspace'}]
  const requestSchema=supported.get(method)
  if(!matches(requestSchema,params,schema.definitions))throw Error(`CODEX_PARAMS_MISMATCH: ${name} -> ${method}`)
 }
 return Object.keys(nativeControlMethods).length
}
async function probe(binary,home){
 let exited
 const closed=new Promise(resolve=>{exited=resolve})
 const rpc=new CodexRpc({binary,codexHome:home,cwd:home,onClose:exited,providerOptions:{args:['app-server','--listen','stdio://']}})
 try{
  await initializeCodex(rpc,{name:'weixin_contract_check',version:'1.0.0'})
  const projects=await rpc.request('project/list',{limit:1},5000)
  const memory=await rpc.request('memory/status',{},5000)
  const search=await rpc.request('thread/search',{searchTerm:'contract-probe',limit:1},5000)
  if(!Array.isArray(projects.data)||typeof memory.v2Ready!=='boolean'||!Array.isArray(search.data))throw Error('CODEX_READ_RESPONSE_MISMATCH')
 }finally{
  rpc.close()
  let timer
  await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(resolve,3000)})])
  clearTimeout(timer)
 }
}

const dir=await mkdtemp(join(tmpdir(),'weixin-codex-contract-'))
try{
 const schemaDir=join(dir,'schema'),home=join(dir,'codex-home')
 await mkdir(home)
 const {stdout:version}=await exec(binary,['--version'],{timeout:10000})
 const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
 if(version.trim()!==`codex-cli ${manifest.dependencies['@openai/codex']}`)throw Error('CODEX_BUNDLED_VERSION_MISMATCH')
 await exec(binary,['app-server','generate-json-schema','--experimental','--out',schemaDir],{timeout:30000,env:{...process.env,CODEX_HOME:home}})
 const schema=JSON.parse(await readFile(join(schemaDir,'ClientRequest.json'),'utf8'))
 const literalMethods=new Set()
 for(const file of await sourceFiles(join(root,'src'))){
  // These adapters own different wire contracts; ACP methods are not Codex RPC.
  if(file.startsWith(join(root,'src','infrastructure','agents','workbuddy')+sep)||file.startsWith(join(root,'src','infrastructure','agents','claude')+sep))continue
  const source=await readFile(file,'utf8')
  for(const match of source.matchAll(/\.(?:request|call)\('([A-Za-z]+\/[A-Za-z/]+)'/g))literalMethods.add(match[1])
 }
 const mapped=checkMethods(schema,new Set([...literalMethods,...Object.values(nativeControlMethods)]))
 await probe(binary,home)
 console.log(JSON.stringify({version:version.trim(),literalMethods:literalMethods.size,nativeToolMappings:mapped,readOnlyProbe:'passed'}))
}finally{await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100})}
