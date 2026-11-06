import {DatabaseSync} from 'node:sqlite'
import {join} from 'node:path'
import {chmodSync} from 'node:fs'
import {createHash} from 'node:crypto'
export class SetupReceipts{
 constructor(stateDir){this.db=new DatabaseSync(join(stateDir,'setup-receipts.sqlite'));chmodSync(join(stateDir,'setup-receipts.sqlite'),0o600);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,action TEXT NOT NULL,state TEXT NOT NULL)")}
 key(message){const mid=message.raw?.message_id??message.raw?.client_id;if(mid===undefined)return null;return createHash('sha256').update((message._conversationOwner??message.raw?.from_user_id??message.userId)+'\0'+String(mid)).digest('hex')}
 get(message){const id=this.key(message);return id?this.db.prepare('SELECT * FROM receipts WHERE id=?').get(id):null}
 capture(message){const id=this.key(message);if(!id)return null;this.db.prepare("INSERT OR IGNORE INTO receipts VALUES(?,?,'pending')").run(id,message._setupAction);return this.get(message)}
 claim(id){return this.db.prepare("UPDATE receipts SET state='claimed' WHERE id=? AND state='pending'").run(id).changes===1}
 finish(id){this.db.prepare("UPDATE receipts SET state='handled' WHERE id=?").run(id)}
 close(){this.db.close()}
}
