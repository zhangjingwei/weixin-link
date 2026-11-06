import test from 'node:test'
import assert from 'node:assert/strict'
import {hybridDedup,dedupCandidates,applyDedupGroups,codexDedup} from '../../../src/integrations/news/news-dedup.mjs'
import {aggregate,renderDigestHtml} from '../../../src/integrations/news/news-digest.mjs'
const rows=[{id:'a',title:'Google Chrome 推出 Gemini 网站反诈检测',summary:'Google Chrome推出Gemini网站反诈功能，显示可疑网站警告。'},{id:'b',title:'Chrome新增可疑网站提醒，Gemini识别诈骗',summary:'Chrome通过服务器端Gemini判断潜在诈骗网站，提醒用户注意风险。'},{id:'c',title:'教育部发布学校招生通知',summary:'学校招生对象和截止时间由当地通知确定。'}]
test('AI only sees candidates; all source bodies survive in final HTML with correct counts',async()=>{
 let calls=0;const r=await hybridDedup(rows,{classify:async p=>{calls++;assert.equal(p.articles.length,2);assert.deepEqual(Object.keys(p.articles[0]),['title','summary']);return {groups:[[0,1]]}}});assert.equal(calls,1);assert.equal(r.items.length,2);assert.equal(r.stats.final,2);assert.equal(r.items.reduce((n,x)=>n+x.memberCount,0),3)
 const html=renderDigestHtml({},r.items,'2026-10-21',{premerged:true,collectedCount:3,dedupStats:r.stats});for(const x of rows)assert.ok(html.includes(x.summary));assert.equal((html.match(/<article>/g)??[]).length,2);assert.ok(html.includes('采集3条'));assert.ok(html.includes('完成并通过校验'))
})
test('invalid, overlapping, missing and invented IDs fail closed without dropping news',async()=>{
 for(const groups of [[[0,9]],[[0,1],[1,2]],[[0,0]],[[0,2]],null]){const r=await hybridDedup(rows,{classify:async()=>({groups})});assert.equal(r.stats.status,'ai_fallback');assert.equal(r.items.length,3)}
 const r=await hybridDedup(rows,{classify:async()=>{throw Error('timeout')}});assert.equal(r.items.length,3);assert.equal(r.stats.aiCalls,1)
})
test('different numbers reach semantic review; budget skips rather than truncates',async()=>{
 const x=rows.slice(0,2).map((r,i)=>({...r,summary:r.summary+`利润${i+1}亿元。`}));assert.equal(dedupCandidates(aggregate(x)).length,1)
 let called=false;const r=await hybridDedup(rows,{maxChars:10,classify:async()=>{called=true}});assert.equal(called,false);assert.equal(r.stats.status,'budget_fallback');assert.equal(r.items.length,3)
})

test('same headline with extra quoted context reaches AI without merging conflicting figures blindly',async()=>{const a={id:'a',title:'绿泡泡月活1.43亿',summary:'绿泡泡月活1.43亿。'},b={id:'b',title:'绿泡泡月活 1.43 亿',summary:'旧消息：红果日活1.68亿。绿泡泡月活1.43亿。'};assert.equal(dedupCandidates([a,b]).length,1);const r=await hybridDedup([a,b],{classify:async()=>({groups:[[0,1]]})});assert.equal(r.items.length,1);assert.equal(r.items[0].memberCount,2);assert.ok(r.items[0].summary.includes('1.68'));const conflict=[a,{...b,summary:'绿泡泡月活2.5亿。'}];assert.equal(dedupCandidates(conflict).length,1);const kept=await hybridDedup(conflict,{classify:async()=>({groups:[]})});assert.equal(kept.items.length,2)})

test("regional prices and added details reach review and preserve every body",async()=>{const a={id:"us",title:"苹果发布搭载 A20 Pro 的新款 iPad mini",summary:"699美元，10月28日预售。"},b={id:"cn",title:"苹果发布搭载 A20 Pro 的新款 iPad mini，128 GB 起售价5499元",summary:"5499元，10月29日预售，11月6日发售。"};const r=await hybridDedup([a,b],{classify:async()=>({groups:[[0,1]]})});assert.equal(r.stats.status,"ai_validated");assert.equal(r.items.length,1);assert.equal(r.items[0].memberCount,2);for(const x of [a,b])assert.ok(r.items[0].summary.includes(x.summary))})
