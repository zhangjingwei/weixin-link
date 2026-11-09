import {createHash} from 'node:crypto'

export function remoteScopeId(threadId,account=process.env.WECHAT_ACCOUNT??'default'){
 if(typeof account!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(account))throw Error('INVALID_ACCOUNT_ID')
 if(typeof threadId!=='string'||!threadId)throw Error('INVALID_REMOTE_SCOPE')
 const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24)
 return account==='default'?hash(threadId):hash(account+'\0'+threadId)
}
