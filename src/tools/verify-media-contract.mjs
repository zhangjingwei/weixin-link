import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {codexInput} from '../base/codex/codex-input.mjs'
const exec=promisify(execFile),binary=join(process.env.HOME,'.local/bin/codex'),dir=await mkdtemp(join(tmpdir(),'codex-input-contract-'))
try{
 const version=(await exec(binary,['--version'])).stdout.trim();await exec(binary,['app-server','generate-json-schema','--out',dir])
 const schema=JSON.parse(await readFile(join(dir,'v2/TurnStartParams.json'),'utf8')),variants=schema.definitions.UserInput.oneOf
 for(const item of codexInput({text:'contract check',images:['/tmp/example.png'],audios:['/tmp/example.wav']})){
  const variant=variants.find(v=>v.properties?.type?.enum?.includes(item.type));if(!variant||variant.required.some(k=>!(k in item)))throw Error('Installed Codex input contract changed')
 }
 console.log(JSON.stringify({version,verified_types:['text','localImage','localAudio'],native_audio_enabled_in_bot:false,reason:'Schema support is separate from actual model modality; current model probe reported audio unsupported.'}))
}finally{await rm(dir,{recursive:true,force:true})}
