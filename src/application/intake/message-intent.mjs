/** Resolve one incoming message to an application intent.
 *
 * The ordered parsers are supplied by the transport boundary. This value is
 * deliberately transient: replayed inbox rows are classified again using the
 * same rules, while the original message and job remain the durable records.
 */
export function messageIntent(message, {hasMedia, diagnostic, setup, agent, upgrade, conversation, session}) {
  if (hasMedia(message)) return null
  const text = message.text?.trim() ?? ''
  if (message._promptReply) {
    const boundConversation=conversation(message,text)
    if (boundConversation) return {kind:'conversation',value:boundConversation}
    const boundSession=message._sessionCommand
    return boundSession?{kind:'session',value:boundSession}:null
  }
  for (const [kind, parse] of [
    ['diagnostic', diagnostic],
    ['setup', setup],
    ['agent', agent],
    ['upgrade', upgrade],
    ['conversation', conversation],
    ['session', session],
  ]) {
    const value = parse(message, text)
    if (value) return {kind, value}
  }
  return null
}
