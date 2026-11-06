import {open,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {USER_GUIDE} from './user-guide.mjs'
export async function welcomeGuideOnce(stateDir,owner,send){const path=join(stateDir,'welcome-'+createHash('sha256').update(owner).digest('hex').slice(0,24)+'.json');let file;try{file=await open(path,'wx',0o600)}catch(e){if(e.code==='EEXIST')return false;throw e}await file.writeFile(JSON.stringify({state:'sending'})+'\n');await file.sync();await file.close();try{await send(USER_GUIDE);await writeFile(path,JSON.stringify({state:'accepted'})+'\n',{mode:0o600})}catch{await writeFile(path,JSON.stringify({state:'unknown'})+'\n',{mode:0o600})}return true}
