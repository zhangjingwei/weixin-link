import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
export async function bindingIdentity(account){
 const values=[]
 for(const name of ['credentials.json','account-identity.json']){try{const data=JSON.parse(await readFile(join(account.stateDir,name),'utf8'));if(typeof data.accountId!=='string'||!data.accountId)throw Error('INVALID_WECHAT_BINDING_IDENTITY');values.push(data.accountId)}catch(e){if(e.code!=='ENOENT')throw e}}
 if(!values.length)throw Error('WECHAT_BINDING_IDENTITY_MISSING')
 if(new Set(values).size!==1)throw Error('WECHAT_BINDING_IDENTITY_MISMATCH')
 return values[0]
}
