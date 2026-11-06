import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
export function targetHints(text,config){
 if(typeof text!=='string'||text.length>12000)return {hosts:[],projects:[],ambiguous:false}
 const clean=text.replace(/```[\s\S]*?```/g,' ').replace(/`[^`]*`/g,' ').replace(/^\s*>.*$/gm,' ').replace(/[“「『][\s\S]*?[”」』]/g,' ').replace(/"[^"\n]*"/g,' ')
 const match=alias=>new RegExp((/^[a-z0-9_-]+$/i.test(alias)?'(?<![a-z0-9_-])':'')+escape(alias)+(/^[a-z0-9_-]+$/i.test(alias)?'(?![a-z0-9_-])':''),'i').test(clean)
 const hosts=(config.hosts??[]).filter(h=>(h.aliases??[]).some(match)).map(h=>h.id)
 const projects=(config.projects??[]).filter(p=>(p.aliases??[]).some(match)).map(p=>({id:p.id,host:p.host,path:p.path}))
 return {hosts,projects,ambiguous:hosts.length>1||projects.length>1||hosts.length===1&&projects.some(p=>p.host!==hosts[0])}
}
export async function addTargetHints(input,cwd){try{const config=JSON.parse(await readFile(process.env.WECHAT_TARGETS_FILE??join(cwd,'targets.json'),'utf8')),value=typeof input==='string'?{text:input}:{...input},hints=targetHints(value.text,config);if(!hints.hosts.length&&!hints.projects.length)return input;value.text+='\n\n[目标识别候选，仅供结合原文与上下文判断，不代表切换或执行授权]\n'+JSON.stringify(hints);return value}catch(e){if(e.code==='ENOENT')return input;throw e}}
