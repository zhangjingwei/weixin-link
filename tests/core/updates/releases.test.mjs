import test from 'node:test'
import assert from 'node:assert/strict'
import {githubLatestRelease,newerRelease,releaseTag} from '../../../src/core/updates/releases.mjs'
const sha='a'.repeat(40),tagSha='b'.repeat(40)
const response=value=>({ok:true,text:async()=>JSON.stringify(value)})
test('stable versions compare numerically and reject prereleases and downgrade',()=>{
 assert.equal(newerRelease('v1.10.0','v1.9.0'),true)
 assert.equal(newerRelease('v1.0.0','v2.0.0'),false)
 assert.equal(newerRelease('v1.0.0','v1.0.0'),false)
 for(const value of ['main','v01.0.0','v1.0.0-rc.1','../x'])assert.equal(releaseTag(value),false)
})
test('latest release resolves annotated tags to a pinned commit',async()=>{
 const paths=[]
 const release=await githubLatestRelease({request:async url=>{
  paths.push(url)
  if(url.endsWith('releases/latest'))return response({tag_name:'v1.2.0',draft:false,prerelease:false})
  if(url.endsWith('/git/ref/tags/v1.2.0'))return response({object:{type:'tag',sha:tagSha}})
  if(url.endsWith('/git/tags/'+tagSha))return response({object:{type:'commit',sha}})
  throw Error('unexpected URL')
 }})
 assert.deepEqual(release,{tag:'v1.2.0',commit:sha});assert.equal(paths.length,3)
})
test('no release does not fall back to main and prereleases are refused',async()=>{
 let calls=0
 assert.equal(await githubLatestRelease({request:async()=>{calls++;return {status:404}}}),null)
 assert.equal(calls,1)
 await assert.rejects(githubLatestRelease({request:async()=>response({tag_name:'v2.0.0',prerelease:true})}),/INVALID/)
})
