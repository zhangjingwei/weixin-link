import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {listAccounts,assertAccount} from '../../wechat/accounts.mjs'
export async function bindingIdentity(account){
 const values=[]
 for(const name of ['credentials.json','account-identity.json']){try{const data=JSON.parse(await readFile(join(account.stateDir,name),'utf8'));if(typeof data.accountId!=='string'||!data.accountId)throw Error('INVALID_WECHAT_BINDING_IDENTITY');values.push(data.accountId)}catch(e){if(e.code!=='ENOENT')throw e}}
 if(!values.length)throw Error('WECHAT_BINDING_IDENTITY_MISSING')
 if(new Set(values).size!==1)throw Error('WECHAT_BINDING_IDENTITY_MISMATCH')
 return values[0]
}
export async function resolveBindingAccount(selector,home){
 const matches=[]
 for(const account of await listAccounts(home)){try{if(await bindingIdentity(account)===selector)matches.push(account)}catch(e){if(e.message!=='WECHAT_BINDING_IDENTITY_MISSING')throw e}}
 if(matches.length>1)throw Error('DUPLICATE_WECHAT_BINDING_IDENTITY')
 if(matches.length===1)return matches[0]
 return assertAccount(selector,home)
}
