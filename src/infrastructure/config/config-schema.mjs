import haSchema from './ha-schema.mjs'
import rsshubSchema from './rsshub-schema.mjs'
import {isAbsolute,posix,win32} from 'node:path'
export const MAX_CONFIG_BYTES=1024*1024
export class ConfigError extends Error{constructor(code,field){super(code);this.code=code;if(field&&/^[A-Za-z0-9_.-]{1,100}$/.test(field))this.field=field}}
const text={type:'string',minLength:1,maxLength:8192,pattern:'^[^\\r\\n\\u0000]+$'}
const absolute={...text,format:'absolute-path'}
const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false})
const host=object({platform:{enum:['posix','win32']},binary:{...text,format:'remote-path'},root:{...text,format:'remote-path'},transport:{enum:['daemon-proxy','ssh-websocket']},port:{type:'integer',minimum:1024,maximum:65535}},['platform','binary','root','transport'])
export const CONFIG_SCHEMAS={
 installation:object({version:{const:1},workspace:absolute,codexBinary:absolute,agentBackend:{enum:['codex','claude']},claudeBinary:absolute,createdAt:{...text,format:'date-time'}},['version','workspace']),
 ha: haSchema,
 rsshub: rsshubSchema,
 backup:object({version:{const:1},host:{...text,pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'},remoteDirectory:{...text,format:'backup-directory'}},['version','host','remoteDirectory']),
 'remote-hosts':object({version:{const:1},hosts:{type:'object',propertyNames:{pattern:'^[A-Za-z0-9][A-Za-z0-9._-]*$'},additionalProperties:host}},['version','hosts']),
}
function fail(code,field){throw new ConfigError(code,field)}
function validate(schema,value,path='',parent){
 if(schema.const!==undefined&&value!==schema.const)fail('CONFIG_UNSUPPORTED_VERSION',path)
 if(schema.enum&&!schema.enum.includes(value))fail('CONFIG_INVALID_VALUE',path)
 if(schema.type==='object'){
  if(!value||typeof value!=='object'||Array.isArray(value))fail('CONFIG_EXPECTED_OBJECT',path)
  for(const name of schema.required??[])if(!Object.hasOwn(value,name))fail('CONFIG_REQUIRED_FIELD',path?path+'.'+name:name)
  for(const [key,item]of Object.entries(value)){
   if(schema.propertyNames&&!new RegExp(schema.propertyNames.pattern).test(key))fail('CONFIG_INVALID_HOST_NAME','hosts')
   const child=Object.hasOwn(schema.properties??{},key)?schema.properties[key]:schema.additionalProperties
   if(!child||child===false)fail('CONFIG_UNKNOWN_FIELD',path||'config')
   validate(child,item,path?path+'.'+key:key,value)
  }
 }
 if(schema.type==='string'){
  if(typeof value!=='string')fail('CONFIG_EXPECTED_STRING',path)
  if(value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||schema.pattern&&!new RegExp(schema.pattern).test(value))fail('CONFIG_INVALID_STRING',path)
  if(schema.format==='absolute-path'&&!isAbsolute(value))fail('CONFIG_ABSOLUTE_PATH_REQUIRED',path)
  if(schema.format==='remote-path'&&!(parent.platform==='win32'?win32:posix).isAbsolute(value))fail('CONFIG_ABSOLUTE_PATH_REQUIRED',path)
  if(schema.format==='backup-directory'&&(!/^\/[A-Za-z0-9_./-]+$/.test(value)||value==='/'||value.split('/').includes('..')))fail('CONFIG_INVALID_DIRECTORY',path)
  if(schema.format==='http-url'){let url;try{url=new URL(value)}catch{fail('CONFIG_INVALID_URL',path)}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)fail('CONFIG_INVALID_URL',path)}
  if(schema.format==='date-time'&&!Number.isFinite(Date.parse(value)))fail('CONFIG_INVALID_DATE',path)
 }
 if(schema.type==='integer'&&(!Number.isInteger(value)||value<schema.minimum||value>schema.maximum))fail('CONFIG_INVALID_INTEGER',path)
}
export function validateHostConfig(name,value){
 if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))fail('CONFIG_INVALID_HOST_NAME','hosts')
 validate(host,value,'hosts.'+name)
 if(value.platform==='win32'&&value.transport!=='ssh-websocket')fail('CONFIG_INVALID_TRANSPORT','hosts.'+name+'.transport')
 if(value.transport==='ssh-websocket'&&value.port===undefined)fail('CONFIG_REQUIRED_FIELD','hosts.'+name+'.port')
 return value
}
export function validateConfig(kind,input){
 const schema=Object.hasOwn(CONFIG_SCHEMAS,kind)?CONFIG_SCHEMAS[kind]:null;if(!schema)fail('CONFIG_UNKNOWN_KIND')
 if(!input||typeof input!=='object'||Array.isArray(input))fail('CONFIG_EXPECTED_OBJECT','config')
 let value
 if(kind==='remote-hosts'&&!Object.hasOwn(input,'hosts')&&!Object.hasOwn(input,'version'))value={version:1,hosts:input}
 else value={version:1,...input}
 validate(schema,value)
 if(kind==='installation'&&value.agentBackend==='claude'&&!value.claudeBinary)fail('CONFIG_REQUIRED_FIELD','claudeBinary')
 if(kind==='remote-hosts')for(const [name,entry]of Object.entries(value.hosts))validateHostConfig(name,entry)
 return structuredClone(value)
}
export function parseConfig(kind,text){if(Buffer.byteLength(text)>MAX_CONFIG_BYTES)fail('CONFIG_TOO_LARGE');let value;try{value=JSON.parse(text)}catch{fail('CONFIG_INVALID_JSON')};return validateConfig(kind,value)}
export const configSchema=kind=>{if(!Object.hasOwn(CONFIG_SCHEMAS,kind))fail('CONFIG_UNKNOWN_KIND');return {$schema:'https://json-schema.org/draft/2020-12/schema',...structuredClone(CONFIG_SCHEMAS[kind])}}
