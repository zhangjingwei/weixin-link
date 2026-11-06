import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
for(const test of ['tests/integrations/news/rss-news.test.py','tests/integrations/monitoring/lisa-proxy-probe.test.py']){
 const result=spawnSync(process.platform==='win32'?'python':'python3',[test],{cwd:root,stdio:'inherit'})
 if(result.error||result.status!==0){process.exitCode=1;break}
}
