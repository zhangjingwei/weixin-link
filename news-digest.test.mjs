import test from 'node:test'
import assert from 'node:assert/strict'
import {aggregate,formatDigest,category} from './news-digest.mjs'
const item=(x={})=>({title:'某公司发布全新人工智能模型并开放测试',excerpt:'新模型已经向用户开放测试。',link:'https://example.com/a',source:'甲',published:'2026-10-19',...x})
test('cross-source copies merge and retain attribution; unrelated reports remain',()=>{const a=aggregate([item(),item({source:'乙',link:'https://other.com/b'}),item({title:'央行宣布新的利率政策',excerpt:'银行利率发生调整',link:'https://example.com/c'})]);assert.equal(a.length,2);assert.deepEqual([...a[0].sources],['甲','乙'])})
test('canonical links ignore tracking but preserve article identity',()=>{assert.equal(aggregate([item(),item({title:'另一标题',link:'https://example.com/a?utm_source=x'})]).length,1);assert.equal(aggregate([item({title:'简短标题',excerpt:'',link:'https://example.com/a?id=1'}),item({title:'另一标题',excerpt:'',link:'https://example.com/a?id=2'})]).length,2)})
test('similar copies merge while different numeric developments remain separate',()=>{assert.equal(aggregate([item(),item({title:'某公司发布全新人工智能模型并开放测试！',source:'乙',link:'https://other.com/a'})]).length,1);assert.equal(aggregate([item({title:'央行降息25基点',excerpt:'',link:'https://x.com/1'}),item({title:'央行降息50基点',excerpt:'',link:'https://x.com/2'})]).length,2)})
test('digest groups stories, preserves links and marks partial failure',()=>{const s=formatDigest({time:'21:00'},[item(),item({title:'央行宣布利率调整',link:'https://example.com/b'})],'2026-10-19',{failures:['丙']});assert(s.includes('【AI与科技】'));assert(s.includes('【财经与商业】'));assert(!s.includes('https://example.com/a'));assert(s.includes('丙'));assert(s.includes('规则提取'));assert.equal(category(item()),'AI与科技')})
import {readingLead,renderDigestHtml} from './news-digest.mjs'
import {execFileSync} from 'node:child_process'
test('HTML retains reward eligibility and all stories beyond chat length; content is inert',()=>{
 const body='火山引擎推出计划。'+'背景说明。'.repeat(80)+'必须使用Seedance制作、在红果上线、进入月度TOP50并通过审核，单部最高20万元。'
 const items=Array.from({length:40},(_,i)=>item({title:'独立新闻'+i,body:body+'编号'+i,link:'https://example.com/'+i}))
 const html=renderDigestHtml({},items,'2026-10-19');assert.equal((html.match(/<article>/g)??[]).length,40);assert(html.includes('必须使用Seedance制作'));assert(html.includes('通过审核'));assert(html.includes('编号39'))
 const hostile=renderDigestHtml({},[item({body:'<script>alert(1)</script>',link:'javascript:alert(1)'})],'today');assert(!hostile.includes('<script>'));assert(!hostile.includes('href="javascript:'));assert(hostile.includes('&lt;script&gt;'))
})
test('short leads preserve full qualifications; long leads end at sentence boundary with explicit excerpt flag',()=>{const b='必须使用Seedance，在红果上线并进入月度TOP50，通过审核后最高20万元。';assert.deepEqual(readingLead(item({body:b})),{text:b,excerpted:false});const lead=readingLead(item({body:'第一句。第二句。第三句。'}),6);assert.equal(lead.text,'第一句。');assert(lead.excerpted)})
test('same title does not hide changed figures; categories prefer title over contextual investment',()=>{assert.equal(aggregate([item({body:'奖励需要审核，最高20万元'}),item({body:'奖励需要审核，最高50万元',link:'https://different.com/a'})]).length,2);assert.equal(category(item({title:'中国与塔吉克斯坦深化安全情报合作',body:'中国是投资国。'})),'国际动态');assert.equal(category(item({title:'索尼手机安卓升级',body:'美国市场'})),'AI与科技')})
test('RSS ingestion retains late conditions beyond legacy 180 characters and content:encoded',()=>{
 const code=`import runpy,io,datetime,urllib.request,json
m=runpy.run_path('rss-news.py',run_name='fixture')
body='背景。'*100+'使用Seedance制作并在红果上线，月度TOP50且审核通过，最高20万元。'
xml='<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>奖励计划</title><link>https://example.com/1</link><pubDate>Mon, 19 Oct 2026 10:00:00 GMT</pubDate><description>短描述</description><content:encoded><![CDATA['+body+']]></content:encoded></item></channel></rss>'
class Reply(io.BytesIO):
 def __enter__(self):return self
 def __exit__(self,*a):self.close()
urllib.request.urlopen=lambda *a,**k:Reply(xml.encode())
x=m['fetch']('https://example.com',datetime.datetime(2026,10,19,11,tzinfo=datetime.timezone.utc),80)[0]
assert x['summary']==body and not x['summary_truncated'];assert set(x)=={'id','title','summary','published','summary_truncated'}
print('OK')`
 assert.equal(execFileSync('python3',['-c',code],{encoding:'utf8'}).trim(),'OK')
})
import {modelInput} from './news-digest.mjs'
test('model payload has only title and summary, filters timestamps and sorts by instant',()=>{
 const now=new Date('2026-10-19T12:00:00Z');const rows=[
 {title:'旧消息',summary:'旧内容',published:'2026-10-17T12:00:00Z'},
 {title:'未来消息',summary:'未来内容',published:'2026-10-20T12:00:00Z'},
 {title:'较早消息',summary:'这是较早的具体新闻内容',published:'2026-10-19T10:00:00Z',link:'https://secret.example/token'},
 {title:'最新消息',summary:'这是最新的具体新闻内容',published:'2026-10-19T20:00:00+08:00',link:'https://secret.example/2'},
 {title:'日期缺失',summary:'无日期'}]
 const data=modelInput(rows,now);assert.equal(data.length,2);assert.equal(data[0].title,'最新消息');assert.deepEqual(Object.keys(data[0]),['title','summary']);assert(!JSON.stringify(data).includes('secret.example'))
 const html=renderDigestHtml({},rows.slice(2,4),'2026-10-19');assert(!html.includes('https://secret.example'));assert(!html.includes('{{BODY}}'))
})
test('reader sees one merged body without source version drawers or duplicated lead',()=>{
 const content='条件完整保留，审核通过后最高20万元。';const html=renderDigestHtml({},[item({summary:content})],'2026-10-19');assert(!html.includes('<details'));assert(!html.includes('不同来源版本'));assert.equal(html.split('<nav>')[1].split(content).length-1,1)
})
import {selectHighlights} from './news-digest.mjs'
test('highlights select at most one per finance technology education; absent columns stay absent',()=>{
 const items=[item({title:'央行利率政策生效',summary:'利率变化',link:'https://a/1'}),item({title:'股票传闻',summary:'另一新闻',link:'https://a/2'}),item({title:'人工智能模型发布',summary:'新模型上线',link:'https://a/3'}),item({title:'教师教育AI资源开放',summary:'学校教师适用',link:'https://a/4'})];const picks=selectHighlights(items);assert.deepEqual(picks.map(x=>x.category),['金融','科技','教育']);assert.equal(picks[0].item.title,'央行利率政策生效');assert.equal(picks[2].item.title,'教师教育AI资源开放');assert.equal(selectHighlights([]).length,0)
 const html=renderDigestHtml({},items,'today');assert(html.indexOf('重点新闻')<html.indexOf('<nav>'));assert(!html.includes('规则初选'));assert(!html.includes('{{HIGHLIGHTS}}'))
})
test('Codex highlight decomposition fills template and unknown titles are refused',()=>{
 const x=item(),h={category:'科技',title:x.title,what:'发布新模型',impact:'可能影响开发者',watch:'关注实际测试',uncertainty:'厂商自报，未核实'};const html=renderDigestHtml({},[x],'today',{highlights:[h]});assert(html.includes('关注实际测试'));assert(html.includes('厂商自报'));assert(!html.includes('尚未经过Codex'));
 assert.throws(()=>renderDigestHtml({},[x],'today',{highlights:[{...h,title:'不存在的新闻'}]}),/INVALID_NEWS_HIGHLIGHTS/)
})

test('decorative headline emoji are removed only at display time; section icons and top tips are absent',()=>{
 const title='↩️🖼 🚘 特斯拉与支付宝合作';const rows=[item({title,summary:'完整正文保持不变。'})];const html=renderDigestHtml({},rows,'2026-10-21',{highlights:[]});assert.ok(html.includes('<h3>特斯拉与支付宝合作</h3>'));assert.equal(rows[0].title,title);assert.ok(!html.includes("h2:before{content:"));assert.ok(!html.includes('<p class="edition">'));assert.ok(!html.includes('<p class="slogan">'));assert.ok(!html.includes('↩️🖼'))
})

test('timeline entries get separate year columns and headings without changing text or allowing markup',async()=>{const {renderArticleBody}=await import('./news-digest.mjs');const html=renderArticleBody('城市与基础设施 - 1682年 ：费城建城。 - 1904年 ：地铁开通。 军事与历史冲突 - 1937年 ：事件。');assert.equal((html.match(/class="timeline-entry"/g)||[]).length,3);assert.ok(html.includes('<h4>城市与基础设施</h4>'));assert.ok(html.includes('<h4>军事与历史冲突</h4>'));assert.ok(renderArticleBody('<script>alert(1)</script>').includes('&lt;script&gt;'))})
test('standalone news HTML keeps full content without a multi-megabyte cover',()=>{
 const marker='末尾条件：完成审核后方可领取。';
 const html=renderDigestHtml({time:'18:00'},[item({body:'完整正文。'.repeat(400)+marker})],'2026-11-04');
 assert(html.includes(marker));assert(html.includes('data:image/jpeg;base64,'));
 assert(Buffer.byteLength(html)<150000,'cover must leave room for complete news in a small standalone file');
})

test('mixed news bulletins are not forced into the category of their first event',()=>{
 assert.equal(category(item({title:'民主党夺回美国参众两院；新闻汇编另涉财经与社会动态',newsCategory:'国际动态'})),'综合简讯');
 assert.equal(category(item({title:'美国中期选举结果公布',newsCategory:'国际动态'})),'国际动态');
 assert.equal(category(item({title:'日本配送平台遭网络入侵',newsCategory:'AI与科技'})),'AI与科技');
})
