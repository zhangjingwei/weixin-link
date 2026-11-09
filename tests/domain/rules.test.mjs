import test from 'node:test'
import assert from 'node:assert/strict'
import {messageOwner, externalMessageId, ingressId, taskId} from '../../src/domain/messages/message-identity.mjs'
import {conversationHasUnfinishedWork, canSubmitScheduledTask} from '../../src/domain/conversations/eligibility.mjs'
import {shouldPromptForUpdate, canRecoverFailedFinal} from '../../src/domain/delivery/notification-state.mjs'
import {executionState} from '../../src/domain/tasks/execution-state.mjs'

test('message identities bind external IDs to the real owner and task keys to their conversation', () => {
  const message = {userId: 'alice#conversation#2', _conversationOwner: 'alice', raw: {message_id: '42'}}
  assert.equal(messageOwner(message), 'alice')
  assert.equal(externalMessageId(message), '42')
  assert.equal(ingressId(messageOwner(message), externalMessageId(message)), ingressId('alice', '42'))
  assert.notEqual(ingressId('alice', '42'), ingressId('bob', '42'))
  assert.notEqual(taskId('alice#conversation#2', '42'), taskId('alice#conversation#3', '42'))
})

test('busy or uncertain conversations cannot be changed or used as a scheduled target', () => {
  assert.equal(conversationHasUnfinishedWork({session: {state: 'stopping'}}), true)
  assert.equal(conversationHasUnfinishedWork({recovery: {execution: 'unknown'}}), true)
  assert.equal(conversationHasUnfinishedWork({pending: true}), true)
  assert.equal(conversationHasUnfinishedWork({session: {state: 'idle'}}), false)
  assert.equal(canSubmitScheduledTask({owner: 'alice', entry: {owner: 'alice'}, taskSupported: true}), true)
  assert.equal(canSubmitScheduledTask({owner: 'alice', entry: {owner: 'bob'}, taskSupported: true}), false)
  assert.equal(canSubmitScheduledTask({owner: 'alice', entry: {owner: 'alice', archived: true}, taskSupported: true}), false)
  assert.equal(canSubmitScheduledTask({owner: 'alice', entry: {owner: 'alice'}, taskSupported: false}), false)
})

test('unknown notifications are not replayed and only a confirmed rejected final can recover once', () => {
  assert.equal(shouldPromptForUpdate({tag: 'v1.1.0', status: 'unknown'}, 'v1.1.0'), false)
  assert.equal(shouldPromptForUpdate({tag: 'v1.1.0', status: 'deferred'}, 'v1.1.0'), true)
  const record = {lastReply: 'saved', recovery: {execution: 'completed', delivery: 'failed', delivery_error: {api_code: -2}}}
  assert.equal(canRecoverFailedFinal(record, null), true)
  assert.equal(canRecoverFailedFinal(record, {busy: true}), false)
  assert.equal(canRecoverFailedFinal({...record, recovery: {...record.recovery, autoResend: 'attempted'}}, null), false)
  assert.equal(executionState('completed', true), 'waiting_attachment')
  assert.equal(executionState('running'), 'unknown')
})
