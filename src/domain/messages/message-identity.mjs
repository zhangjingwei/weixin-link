import {createHash} from 'node:crypto'

/** The real sender and external message ID define a replay-safe inbox identity. */
export function messageOwner(message) {return message._conversationOwner ?? message.raw?.from_user_id ?? message.userId}
export function externalMessageId(message) {return message.raw?.message_id ?? message.raw?.client_id}
export function ingressId(owner, externalId) {return createHash('sha256').update(owner + '\0' + String(externalId)).digest('hex')}
export function taskId(owner, key) {return createHash('sha256').update(owner + '\0' + key).digest('hex')}
