import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,realpath} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {conversationRepository} from '../../src/infrastructure/agents/conversation-repository.mjs'

test('real repository and worktree share canonical identity while another repo stays separate',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'conversation-git-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const repo=join(dir,'repo'),tree=join(dir,'tree'),other=join(dir,'other');await mkdir(repo);await mkdir(other)
 const git=(path,...args)=>execFileSync('git',['-c','core.fsmonitor=false','-C',path,...args],{stdio:'pipe'})
 git(repo,'init');git(repo,'-c','user.name=Test','-c','user.email=test@example.invalid','-c','core.hooksPath=/dev/null','commit','--allow-empty','-m','fixture')
 git(repo,'worktree','add','--detach',tree);git(other,'init')
 const a=await conversationRepository(repo),b=await conversationRepository(tree),c=await conversationRepository(other)
 assert.equal(a.commonDir,b.commonDir);assert.notEqual(a.commonDir,c.commonDir)
 assert.equal(a.root,await realpath(repo));assert.equal(b.root,await realpath(tree))
 assert.equal(await conversationRepository(dir),null)
})

test('repository inspection distinguishes a missing repo from an unreadable command',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'conversation-git-failure-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 await assert.rejects(conversationRepository(dir,{run:async()=>{throw Object.assign(Error('private detail'),{code:'EACCES'})}}),/MANAGEMENT_REPOSITORY_UNAVAILABLE/)
 await assert.rejects(conversationRepository('relative'),/MANAGEMENT_REPOSITORY_UNAVAILABLE/)
})
