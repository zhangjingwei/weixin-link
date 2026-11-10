import {FileStorage,MemoryStorage,STORAGE_KEYS} from 'wechatbot-zerolink/storage'

// The pairing worker must not write new credentials before registerLogin checks
// the existing account binding. Seed only the old credential into memory so the
// SDK can send its local token and handle binded_redirect for this account.
export async function pairingStorage(stateDir){
 const storage=new MemoryStorage()
 let previous
 try{previous=await new FileStorage(stateDir).get(STORAGE_KEYS.CREDENTIALS)}
 catch{throw Error('CREDENTIALS_UNREADABLE')}
 if(previous){
  if(['accountId','userId','token','baseUrl'].some(key=>typeof previous[key]!=='string'||!previous[key]))throw Error('CREDENTIALS_UNREADABLE')
  await storage.set(STORAGE_KEYS.CREDENTIALS,previous)
 }
 return storage
}
