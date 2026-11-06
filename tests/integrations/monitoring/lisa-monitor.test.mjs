import test from 'node:test';import assert from 'node:assert/strict';import {transition,recoveryDigest,combineProbe,recordOutcome,candidateByTag} from '../../../src/integrations/monitoring/lisa-monitor.mjs';
test('application probe result never claims success without domestic baseline',()=>{
 const proxy={port:43777,ok:true,reason:'proxy_https_verified',targets:[{target:'cloudflare-trace',ok:true}]}
 assert.equal(combineProbe(proxy,true).ok,true)
 const noBaseline=combineProbe(proxy,false)
 assert.equal(noBaseline.ok,false);assert.equal(noBaseline.proxyOk,undefined);assert.equal(noBaseline.reason,'proxy_https_verified')
})
test('three full proxy failures alert once and three successes recover',()=>{let s={};for(let i=1;i<=3;i++){const r=transition(s,{ok:false,time:'t'});assert.equal(r.event,i===3?'fault':null);s=r.state}assert.equal(transition(s,{ok:false,time:'t'}).event,null);s=transition(s,{ok:true}).state;s=transition(s,{ok:false}).state;for(let i=1;i<=3;i++){const r=transition(s,{ok:true});assert.equal(r.event,i===3?'recovery':null);s=r.state}assert.equal(s.incident,undefined)})
test('all skipped checks break failure and recovery streaks without clearing incidents',()=>{
 const state={fail:2,success:2,incident:'old'}
 const domestic=recordOutcome(state,{ok:false,reason:'proxy_https_failed'},{domesticOk:false,trusted:true,time:'a'})
 assert.equal(domestic.state.fail,0);assert.equal(domestic.state.success,0);assert.equal(domestic.state.incident,'old');assert.equal(domestic.event,null);assert.equal(domestic.state.skipped,'domestic_unavailable')
 const remote=recordOutcome(state,{ok:false,reason:'proxy_https_failed'},{domesticOk:true,trusted:false,time:'b'})
 assert.equal(remote.state.fail,0);assert.equal(remote.state.success,0);assert.equal(remote.state.incident,'old');assert.equal(remote.state.skipped,'remote_unavailable')
 const infrastructure=recordOutcome(state,{ok:false,reason:'probe_execution_failed'},{domesticOk:false,trusted:false,time:'c'})
 assert.equal(infrastructure.state.fail,0);assert.equal(infrastructure.state.success,0);assert.equal(infrastructure.state.incident,'old');assert.equal(infrastructure.state.skipped,'probe_infrastructure')
})
test('rotation candidate is selected by tag after its staged port changes',()=>{
 const candidate={tag:'Lisa-HK',port:45678}
 assert.deepEqual(candidateByTag([{tag:'Lisa-JP',port:43777},candidate],'Lisa-HK'),candidate)
 assert.throws(()=>candidateByTag([],'Lisa-HK'),/ROTATION_CANDIDATE_MISSING/)
})
test('recovery digest aggregates uncertain messages once for every expected port',()=>{const s={ports:{43777:{success:2},25483:{success:3}},notifications:[{id:'a',event:'fault',status:'unknown',text:'failure'},{id:'b',event:'recovery',status:'accepted',text:'ok'}]};assert.equal(recoveryDigest(s,'2026-10-26T16:00:00Z',[43777,25483]),null);s.ports[43777].success=3;const d=recoveryDigest(s,'2026-10-26T16:00:00Z',[43777,25483]);assert.deepEqual(d.sources,['a']);assert.equal(s.notifications[0].status,'unknown');s.notifications.push({...d,status:'unknown'});assert.equal(recoveryDigest(s,'2026-10-26T16:01:00Z',[43777,25483]),null)})
