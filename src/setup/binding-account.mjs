import {bindingIdentity} from '../infrastructure/accounts/account-store.mjs'
import {listAccounts,assertAccount} from '../infrastructure/accounts/account-store.mjs'

export async function resolveBindingAccount(selector,home){
 const matches=[]
 for(const account of await listAccounts(home)){try{if(await bindingIdentity(account)===selector)matches.push(account)}catch(e){if(e.message!=='WECHAT_BINDING_IDENTITY_MISSING')throw e}}
 if(matches.length>1)throw Error('DUPLICATE_WECHAT_BINDING_IDENTITY')
 if(matches.length===1)return matches[0]
 return assertAccount(selector,home)
}
