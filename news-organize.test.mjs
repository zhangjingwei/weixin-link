import test from 'node:test'
import assert from 'node:assert/strict'
import {articleUnits,applyOrganization,organizeArticles} from './news-organize.mjs'
import {renderDigestHtml} from './news-digest.mjs'
const items=[{id:'a',title:'奖励计划',summary:'计划拟于11月生效。\n仅教师可申请，审核后最高20万元，截止12月1日。',variants:[{summary:'计划拟于11月生效。\n仅教师可申请，审核后最高20万元，截止12月1日。'},{summary:'另一来源称截止12月2日，尚待确认。'}]}]
const valid={articles:[{id:0,sections:[{label:'',paragraphs:[articleUnits(items[0]).map((_,i)=>i)]}]}]}
test('model only arranges references; every original fact and qualification survives HTML',async()=>{
 const r=await organizeArticles(items,{classify:async p=>{assert.equal(p.articles[0].units.length,articleUnits(items[0]).length);return valid}})
 assert.equal(r.stats.status,'ai_validated');const html=renderDigestHtml({},r.items,'2026-10-27',{premerged:true})
 for(const unit of articleUnits(items[0]))assert.ok(html.includes(unit));assert.ok(!html.includes('<h4>适用条件与期限</h4>'));assert.ok(!html.includes('<h4>概况</h4>'))
})
test('missing duplicated invented units and articles fail conservatively',async()=>{
 for(const response of [{articles:[]},{articles:[...valid.articles,...valid.articles]},{articles:[{id:0,sections:[{label:'保证收益',paragraphs:[[0,1,2]]}]}]}]){
  const r=await organizeArticles(items,{classify:async()=>response});assert.equal(r.stats.status,'ai_fallback');assert.equal(r.items,items)
 }
})
test('budget and timeout preserve all source material; model payload excludes links',async()=>{
 let called=false;const budget=await organizeArticles(items,{maxChars:1,classify:async()=>{called=true}});assert.equal(called,false);assert.equal(budget.stats.status,'budget_fallback')
 const failure=await organizeArticles(items,{classify:async()=>{throw Error('timeout')}});assert.equal(failure.items,items)
 const linked=[{title:'链接',summary:'参见 https://secret.test/path'}];await organizeArticles(linked,{classify:async p=>{assert.ok(!JSON.stringify(p).includes('secret.test'));return {articles:[{id:0,sections:[{label:'',paragraphs:[[0]]}]}]}}})
})
test('rendering escapes raw article markup and fallback preserves paragraph boundaries',()=>{
 const input=[{title:'标题',summary:'<script>bad</script>。\n第二段。'}];const r=applyOrganization(input,{articles:[{id:0,sections:[{label:'',paragraphs:[[0],[1]]}]}]});const html=renderDigestHtml({},r,'2026-10-27',{premerged:true});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>bad'));assert.ok(html.includes('<p>第二段。</p>'))
})
test('explicit channel boilerplate and exact copies disappear; unique dates and qualification remain',async()=>{
 const {cleanArticleText}=await import('./news-organize.mjs');const text='在花科技圈 : 新品发布。 Apple Newsroom 科技圈 · 茶馆 · 投稿 —— 凤凰网科技 ';
 assert.equal(cleanArticleText(text),'新品发布。');
 const x={title:'新品',variants:[{summary:'售价5499元。仅教师可申请，截止12月1日。'},{summary:'售价 5499 元。另一地区售价699美元。'}]};const u=articleUnits(x);assert.equal(u.filter(t=>t.includes('5499')).length,1);assert.ok(u.some(t=>t.includes('仅教师')));assert.ok(u.some(t=>t.includes('699美元')))
})
test('unproven semantic omissions are restored instead of losing unique facts',()=>{
 const input=[{title:'公告',summary:'拟提供奖励。仅教师可申请。'}];const out=applyOrganization(input,{articles:[{id:0,sections:[{label:'',paragraphs:[[0]]}],duplicates:[{id:1,coveredBy:[0]}]}]});assert.ok(out[0].structuredBody.sections.flatMap(s=>s.paragraphs).join('').includes('仅教师可申请。'))
 assert.equal(applyOrganization(input,{articles:[{id:0,sections:[{label:'',paragraphs:[[0]]}],duplicates:[{id:1,coveredBy:[1]}]}]})[0].structuredBody.restoredUnits,1)
})

test("unlisted units are restored verbatim",()=>{const out=applyOrganization(items,{articles:[{id:0,sections:[{label:"",paragraphs:[[0,1]]}]}]});assert.equal(out[0].structuredBody.restoredUnits,articleUnits(items[0]).length-2);assert.ok(out[0].structuredBody.sections.flatMap(s=>s.paragraphs).join('').includes(articleUnits(items[0])[2]))})

test("invented references cannot produce text and omitted real units are restored",()=>{const result=applyOrganization(items,{articles:[{id:0,sections:[{label:"",paragraphs:[[0,999]]}]}]});const paragraphs=result[0].structuredBody.sections.flatMap(s=>s.paragraphs).join("");for(const unit of articleUnits(items[0]))assert.ok(paragraphs.includes(unit))})
test('semantic paraphrases can be removed only after independent review',async()=>{
 const {reviewSemanticDuplicates}=await import('./news-organize.mjs');const input=[{title:'价格',summary:'标准API定价为每百万个输入token 1美元。标准 API 价格为每100万个输入 token 1 美元。'}];
 const response={articles:[{id:0,sections:[{label:'',paragraphs:[[0]]}],duplicates:[{id:1,coveredBy:[0]}]}]};let calls=0;
 const approvals=await reviewSemanticDuplicates(input,response,{verify:async p=>{calls++;assert.equal(p.candidates.length,1);return {approved:[{article:0,id:1},{article:99,id:99}]}}});assert.equal(calls,1);assert.equal(approvals.size,1);
 const accepted=applyOrganization(input,response,{semanticApprovals:approvals});assert.equal(accepted[0].structuredBody.semanticRemoved,1);assert.equal(accepted[0].structuredBody.sections.flatMap(s=>s.paragraphs).join(''),articleUnits(input[0])[0]);
 const rejected=await reviewSemanticDuplicates(input,response,{verify:async()=>({approved:[]})});assert.equal(applyOrganization(input,response,{semanticApprovals:rejected})[0].structuredBody.semanticRemoved,0);
 const failed=await reviewSemanticDuplicates(input,response,{verify:async()=>{throw Error('offline')}});assert.equal(failed.size,0)
})
test('new capacity, conflicting date and qualification survive even forged semantic approval',()=>{
 for(const [kept,removed] of [['5499元，11月6日发售。','提供128GB、256GB和512GB。'],['10月28日预购。','10月29日预购。'],['发放奖励。','仅教师可申请，审核后最高20万元。'],['方案已生效。','方案拟生效。']]){
  const input=[{title:'测试',summary:kept+removed}];const r=applyOrganization(input,{articles:[{id:0,sections:[{label:'',paragraphs:[[0]]}],duplicates:[{id:1,coveredBy:[0]}]}]},{semanticApprovals:new Set(['0:1'])});for(const unit of articleUnits(input[0]))assert.ok(r[0].structuredBody.sections.flatMap(s=>s.paragraphs).join('').includes(unit));assert.equal(r[0].structuredBody.semanticRemoved,0)
 }
})
test('conservative recovery returns omitted clauses near original context instead of pasting a tail',()=>{const input=[{title:'公告',summary:'第一事实。限定条件。第三事实。'}];const out=applyOrganization(input,{articles:[{id:0,sections:[{label:'',paragraphs:[[0,2]]}],duplicates:[]}]});assert.equal(out[0].structuredBody.sections.flatMap(s=>s.paragraphs).join(''),input[0].summary)})

test("complete sentences retain comma and condition context",()=>{const input={title:"公告",summary:"仅教师可申请，审核后最高20万元，截止12月1日。新产品支持A功能，并提供B功能。"};assert.deepEqual(articleUnits(input),["仅教师可申请，审核后最高20万元，截止12月1日。","新产品支持A功能，并提供B功能。"])})
