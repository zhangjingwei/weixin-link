import {assertAccount,bindingIdentity} from '../infrastructure/accounts/account-store.mjs'

export async function resolveBindingAccount(selector,home){
 const account=await assertAccount('default',home)
 if(selector==='default'||selector===await bindingIdentity(account))return account
 throw Error('ACCOUNT_NOT_FOUND')
}
