// Upgrade reload helper: abort restart if backup or restore verification fails.
import {spawn} from 'node:child_process'
const run=(bin,args)=>new Promise((resolve,reject)=>{const c=spawn(bin,args,{stdio:'inherit'});c.on('error',reject);c.on('exit',code=>code===0?resolve():reject(Error('Upgrade preparation failed')))})
try{await run('/usr/bin/node',[new URL('./backup-run.mjs',import.meta.url).pathname]);await run('/usr/bin/node',[new URL('../../tools/activate-diagnostics.mjs',import.meta.url).pathname])}catch{console.error('Backup/reload failed; do not proceed with upgrade.');process.exitCode=1}
