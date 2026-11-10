import {join} from 'node:path'
import {DurableJobs} from './durable-jobs.mjs'

/** Keep ingress, task and WeChat send ledgers under the account. */
export async function openAccountInbox(accountDir){
 const jobs=new DurableJobs(join(accountDir,'inbox.sqlite'))
 try{
  jobs.db.exec("CREATE TABLE IF NOT EXISTS weixin_sent(client_id TEXT PRIMARY KEY,peer TEXT NOT NULL,message_id TEXT,state TEXT NOT NULL,text TEXT,created INTEGER NOT NULL)")
  return jobs
 }catch(error){jobs.close();throw error}
}
