import {join} from 'node:path'
import {mkdir,writeFile,access} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {CODEX_VERSION} from '../setup-core.mjs'
import {deviceLogin} from '../setup-login.mjs'

export const codexContainerSpec={
 kind:'codex',
 targetId:identity=>'agent-'+createHash('sha256').update(identity).digest('hex').slice(0,16),
 containerName:id=>'wechat-codex-'+id,
 binary:'/usr/local/bin/codex',
 image:'localhost/wechat-codex:'+CODEX_VERSION+'-node24',
 containerfile:`FROM docker.io/library/node:24-bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git && rm -rf /var/lib/apt/lists/*\nRUN npm install -g @openai/codex@${CODEX_VERSION}\n`,
 description:'Isolated Codex agent',
 environment:['CODEX_HOME=/agent/codex'],
 exec:'/usr/local/bin/codex app-server --listen unix:///run/agent/app-server.sock',
 async prepare(root){
  await mkdir(join(root,'home/codex'),{recursive:true,mode:0o700})
  const path=join(root,'home/codex/config.toml')
  try{await access(path);return}catch(error){if(error.code!=='ENOENT')throw error}
  await writeFile(path,'cli_auth_credentials_store = "file"\n[features]\nmemories = true\n[memories]\ngenerate_memories = true\nuse_memories = true\n',{mode:0o600,flag:'wx'})
 },
 login(target,{send,signal}){return deviceLogin({binary:'podman',prefixArgs:['exec','-i',target.container,target.binary],send,signal})}
}
