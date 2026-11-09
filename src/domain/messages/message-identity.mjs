import {createHash} from 'node:crypto'

/** Hash normalized owner and external ID values; transport fields stay in adapters. */
export function ingressId(owner, externalId) {return createHash('sha256').update(owner + '\0' + String(externalId)).digest('hex')}
export function taskId(owner, key) {return createHash('sha256').update(owner + '\0' + key).digest('hex')}
