/** Interpret the stored WeChat envelope before calling protocol-neutral identity rules. */
export function messageOwner(message) {return message._conversationOwner ?? message.raw?.from_user_id ?? message.userId}
export function externalMessageId(message) {
 for (const value of [message.raw?.message_id, message.raw?.client_id]) {
  if (typeof value === 'string' && value.trim().length > 0 || typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
 }
 return undefined
}
export function requireExternalMessageId(message) {
 const id=externalMessageId(message)
 if(id===undefined)throw Error('WECHAT_MESSAGE_ID_REQUIRED')
 return id
}
