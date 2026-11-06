import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {RemoteStore} from '../../src/core/registry-lock.mjs'
import {RuntimeControl,controlRequest} from '../../src/core/runtime-control.mjs'
import {controlEndpoint} from '../../src/core/control-endpoint.mjs'
import {ffmpegBinary} from '../../src/media/media-binary.mjs'
import sharp from 'sharp'
import {DatabaseSync} from 'node:sqlite'
// macOS TMPDIR can exceed the Unix socket address limit when used as a fake HOME.
const fixture=async t=>{const p=await mkdtemp(join(process.platform==='darwin'?'/tmp':tmpdir(),'wechat-native-'));t.after(()=>rm(p,{recursive:true,force:true}));return p}
test('portable lock serializes competing stores and releases after errors',async t=>{const root=await fixture(t),stores=[new RemoteStore(root,{platform:'darwin'}),new RemoteStore(root,{platform:'darwin'})];await Promise.all(Array.from({length:8},(_,i)=>stores[i%2].update(async s=>{const n=s.n??0;await new Promise(r=>setTimeout(r,10));s.n=n+1})));assert.equal((await stores[0].read()).n,8);await assert.rejects(stores[0].locked('failure',()=>{throw Error('expected')}),/expected/);assert.equal(await stores[1].locked('failure',()=>42),42)})
test('real platform control transport supports status and authenticated maintenance',async t=>{const home=await fixture(t),old=process.env.HOME;process.env.HOME=home;t.after(()=>{if(old===undefined)delete process.env.HOME;else process.env.HOME=old});const state=join(home,'.local/share/wechat-ping-bot');await mkdir(state,{recursive:true});const endpoint=controlEndpoint(state),runtime=new RuntimeControl({ready:()=>true});await runtime.listen(endpoint);t.after(()=>runtime.close());const status=await controlRequest(endpoint,'GET','/status');assert(status.ready);assert.equal(status.pid,process.pid);await controlRequest(endpoint,'POST','/drain',{lease:'portable-test-lease'});const sealed=await controlRequest(endpoint,'POST','/seal',{lease:'portable-test-lease'});assert(sealed.sealed);await controlRequest(endpoint,'POST','/resume',{lease:'portable-test-lease'});assert(!(await controlRequest(endpoint,'GET','/status')).draining)})
test('native SQLite WAL and attachment image/FFmpeg binaries load',async t=>{const root=await fixture(t),db=new DatabaseSync(join(root,'queue.sqlite'));try{db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE queue(id INTEGER PRIMARY KEY, value TEXT)');db.prepare('INSERT INTO queue(value) VALUES (?)').run('persisted');assert.equal(db.prepare('SELECT value FROM queue').get().value,'persisted')}finally{db.close()}const png=await sharp({create:{width:8,height:8,channels:3,background:'#abcdef'}}).png().toBuffer();assert.equal((await sharp(png).metadata()).width,8);const {stdout}=await promisify(execFile)(ffmpegBinary,['-version'],{timeout:10000});assert(stdout.includes('ffmpeg version'))})
