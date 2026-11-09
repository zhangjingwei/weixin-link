/** Interpret the stored WeChat envelope before calling protocol-neutral identity rules. */
export function messageOwner(message) {return message._conversationOwner ?? message.raw?.from_user_id ?? message.userId}
export function externalMessageId(message) {return message.raw?.message_id ?? message.raw?.client_id}
