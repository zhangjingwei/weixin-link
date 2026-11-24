import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile,unlink,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {importLegacySessions} from '../../src/infrastructure/storage/import-legacy-sessions.mjs'

test('upgrade imports live and archived rollouts once without replacing personal history',async t=>{
 const state=await mkdtemp(join(tmpdir(),'personal-history-'))
 t.after(()=>rm(state,{recursive:true,force:true}))
 const old=join(state,'codex-home'),personal=join(state,'personal')
 for(const base of [old,personal])await mkdir(join(base,'sessions','2026'),{recursive:true})
 await mkdir(join(old,'archived_sessions'))
 const same='sessions/2026/rollout-existing.jsonl',archived='archived_sessions/rollout-old.jsonl'
 await writeFile(join(old,same),'old')
 await writeFile(join(personal,same),'personal')
 await writeFile(join(old,archived),'archived')
 await writeFile(join(old,'sessions','2026','rollout-moved.jsonl'),'older')
 await mkdir(join(personal,'archived_sessions'))
 await writeFile(join(personal,'archived_sessions','rollout-moved.jsonl'),'archived by owner')
 await writeFile(join(old,'auth.json'),'old-auth')
 await importLegacySessions(state,personal)
 await assert.rejects(readFile(join(personal,'sessions','2026','rollout-moved.jsonl')),{code:'ENOENT'})
 assert.equal(await readFile(join(personal,same),'utf8'),'personal')
 assert.equal(await readFile(join(personal,archived),'utf8'),'archived')
 await assert.rejects(readFile(join(personal,'auth.json')),{code:'ENOENT'})
 await unlink(join(personal,archived))
 await importLegacySessions(state,personal)
 await assert.rejects(readFile(join(personal,archived)),{code:'ENOENT'})
 assert.equal(await readFile(join(old,archived),'utf8'),'archived')
})
