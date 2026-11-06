import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {bindingIdentity} from '../../../src/base/codex/backend-identity.mjs'
test('binding identity is the server account ID, not the profile name',async t=>{const stateDir=await mkdtemp(join(tmpdir(),'binding-id-'));t.after(()=>rm(stateDir,{recursive:true,force:true}));const account={id:'local-name',stateDir};await assert.rejects(bindingIdentity(account),/IDENTITY_MISSING/);await writeFile(join(stateDir,'credentials.json'),JSON.stringify({accountId:'server-account'}));assert.equal(await bindingIdentity(account),'server-account');await writeFile(join(stateDir,'account-identity.json'),JSON.stringify({accountId:'different-account'}));await assert.rejects(bindingIdentity(account),/IDENTITY_MISMATCH/);await writeFile(join(stateDir,'account-identity.json'),JSON.stringify({accountId:'server-account'}));assert.equal(await bindingIdentity(account),'server-account')})
