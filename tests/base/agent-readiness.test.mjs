import test from 'node:test'
import assert from 'node:assert/strict'
import {createAgentReadiness} from '../../src/infrastructure/agents/agent-readiness.mjs'

test('host readiness checks only the bundled runtime before real inference',async()=>{
 let result={installed:false,loggedIn:false}
 const calls=[],readiness=createAgentReadiness({backend:{kind:'host'},codexAvailability:async options=>{calls.push(options);return result}})
 assert.equal(await readiness(),'CODEX_NOT_INSTALLED')
 result={installed:true,loggedIn:false};assert.equal(await readiness(),null)
 result={installed:true,loggedIn:true};assert.equal(await readiness(),null)
 assert(calls.every(options=>options.checkLogin===false))
})
