import {createHash} from 'node:crypto'

/** Hash normalized owner and external ID values; transport fields stay in adapters. */
export function ingressId(owner, externalId) {return createHash('sha256').update(owner + '\0' + String(externalId)).digest('hex')}
export function taskId(owner, key) {return createHash('sha256').update(owner + '\0' + key).digest('hex')}

export const entryRequestId=id=>{const h=createHash('sha256').update('entry-route:'+id).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
