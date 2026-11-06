import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const dir=mkdtempSync(join(tmpdir(),'remote-config-test-'))
process.env.WECHAT_REMOTE_WORKSPACE=dir
process.env.WECHAT_REMOTE_HOSTS=join(dir,'hosts.json')
writeFileSync(process.env.WECHAT_REMOTE_HOSTS,JSON.stringify({spark:{platform:'posix',binary:'/opt/codex',root:'/home/example/work',transport:'daemon-proxy'},windows197:{platform:'win32',binary:'C:\\Users\\example\\codex.cmd',root:'C:\\Users\\example',transport:'ssh-websocket',port:47831}}))
process.on('exit',()=>rmSync(dir,{recursive:true,force:true}))
