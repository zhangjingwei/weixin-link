import {readFileSync} from 'node:fs'
const template=readFileSync(new URL('./news-template.html',import.meta.url),'utf8')
const heroImage='data:image/jpeg;base64,'+readFileSync(new URL('./assets/news/sunrise-compact.jpg',import.meta.url)).toString('base64')
// Feed content is data. No LLM calls; never execute embedded HTML or instructions.
export function canonicalLink(value){try{const u=new URL(value);for(const k of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(k))u.searchParams.delete(k);u.hash='';return u.href}catch{return value}}
const normalize=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/https?:\/\/\S+/g,'').replace(/[^\p{L}\p{N}]/gu,'')
const numbers=s=>JSON.stringify(s.match(/\d+(?:\.\d+)?/g)??[])
const grams=s=>new Set(Array.from({length:Math.max(0,s.length-2)},(_,i)=>s.slice(i,i+3)))
function similar(a,b){if(a.length<18||b.length<18||numbers(a)!==numbers(b))return false;const x=grams(a),y=grams(b);let n=0;for(const k of x)if(y.has(k))n++;return 2*n/(x.size+y.size)>=0.9}
const displayBody=value=>String(value??'').replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u2194-\u21FF]/gu,'')
export const displayTitle=value=>String(value??'').replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u2194-\u21FF]/gu,'').replace(/\s+/g,' ').trim()
export const articleBody=item=>String(item.summary??item.body??[item.title,item.excerpt].filter(Boolean).join(' ')).trim()
export function aggregate(items){const out=[];for(const item of [...items].sort((a,b)=>(Date.parse(b.published)||0)-(Date.parse(a.published)||0))){
 const text=normalize(articleBody(item)),link=canonicalLink(item.link)
 const found=out.find(x=>link&&x.links.has(link)||text.length>=18&&x.textKey===text||similar(x.textKey,text))
 if(found){found.sources.add(item.source??'新闻源');found.links.add(link);if(!found.variants.some(v=>articleBody(v)===articleBody(item)))found.variants.push(item);continue}
 out.push({...item,textKey:text,links:new Set([link]),sources:new Set([item.source??'新闻源']),variants:[item]})
 }return out}
const categories=[
 ['教育',/教育|教师|学校|招生|考试|课程|教学|学生|大学|高考/],
 ['AI与科技',/人工智能|大模型|机器人|芯片|半导体|科技|软件|手机|苹果|索尼|英伟达|安卓|卫星|openai|claude|codex|chatgpt|\bai\b|google|微软|minimax/i],
 ['财经与商业',/股市|股票|基金|利率|央行|融资|上市|财报|经济|银行|美元|人民币|比特币|金融|投资|收购|贸易|关税|工厂|办公室|汽车|激励/],
 ['国际动态',/美国|俄罗斯|乌克兰|以色列|伊朗|欧洲|欧盟|联合国|外交|总统|战争|停火|朝鲜|韩国|塔吉克斯坦|加沙|塞尔维亚/],
 ['国内与社会',/中国|北京|上海|国务院|教育|医疗|交通|警方|法院|学校|居民|事故|社会|网信办|未成年人|地震/]
]
export function category(item){if(/(?:新闻|要闻|消息|资讯)(?:汇编|合集|汇总)|另涉.{0,12}(?:财经|社会|科技|教育)/u.test(String(item.title??'')))return '综合简讯';if(categories.some(([name])=>name===item.newsCategory)||item.newsCategory==='其他动态'||item.newsCategory==='综合简讯')return item.newsCategory;for(const s of [item.title,articleBody(item)])for(const [name,re] of categories)if(re.test(s))return name;return '其他动态'}
export function readingLead(item,budget=600){const body=articleBody(item);if(body.length<=budget)return {text:body,excerpted:false};const sentences=body.match(/[^。！？!?]+[。！？!?]+|[^。！？!?]+$/gu)??[body];let text='';for(const sentence of sentences){if(text&&text.length+sentence.length>budget)break;text+=sentence;if(text.length>=budget)break}return {text,excerpted:text.length<body.length}}
export function digestGroups(items,{premerged=false}={}){const unique=premerged?items:aggregate(items),groups=new Map();for(const item of unique){const c=category(item);if(!groups.has(c))groups.set(c,[]);groups.get(c).push(item)}return {unique,groups}}
export function formatDigest(job,items,date,{failures=[]}={}){const {unique,groups}=digestGroups(items);let text=`${job.title??'新闻分类汇总'}｜${date} ${job.time??''}\n频道摘录，规则提取，未经独立核实；按消息发布时间筛选，事件可能早于今日。\n采集${items.length}条，合并重复后${unique.length}条。\n`;if(failures.length)text+='部分来源读取失败：'+failures.join('、')+'。\n';let shown=0;const groupBudget=Math.floor((4800-text.length)/Math.max(1,groups.size));for(const [name,entries] of groups){const start=text.length;text+=`\n【${name}】\n`;for(const x of entries){const lead=readingLead(x,350);const row=`${shown+1}. ${x.title}\n${lead.text}${lead.excerpted?'〔节选，完整频道内容见HTML〕':''}\n\n`;if(text.length-start+row.length>groupBudget||text.length+row.length>5000)break;text+=row;shown++}}if(shown<unique.length)text+=`\n聊天预览${shown}/${unique.length}条，全部内容见HTML附件。`;if(!unique.length)text+='\n成功读取的来源未返回时间范围内的消息。';return text}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const safeLink=s=>/^https?:\/\//i.test(s??'')?esc(s):'#'
export function newsEdition(time='09:00'){
 const hour=Number(String(time).split(':')[0]);
 if(!Number.isInteger(hour)||hour<0||hour>23)throw Error('INVALID_NEWS_EDITION_TIME');
 if(hour<11&&hour>=5)return {title:'沃恩早班车',noteTitle:'早安寄语',note:'认真看世界，从容过今天。',label:'早间'};
 if(hour>=11&&hour<14)return {title:'沃恩午间报',noteTitle:'午间寄语',note:'稍作休息，带着新知继续前行。',label:'午间'};
 if(hour>=14&&hour<18)return {title:'沃恩下午报',noteTitle:'午后寄语',note:'整理今日见闻，从容走好下一程。',label:'下午'};
 if(hour>=18&&hour<21)return {title:'沃恩晚间报',noteTitle:'晚安寄语',note:'回看今日，安心休息，明日再出发。',label:'晚间'};
 return {title:'沃恩夜间报',noteTitle:'晚安寄语',note:'回看今日，安心休息，明日再出发。',label:'夜间'};
}
// Keep collected text intact; add semantic blocks without asking a model to rewrite it.
export function renderArticleBody(value){
 let text=displayBody(value).trim();
 const timeline=(text.match(/(?:^|\s)-\s*\d{3,4}年\s*[：:]/g)??[]).length>=2;
 if(timeline){
  text=text.replace(/(?:^|\s)([\p{Script=Han}]{2,14})\s+-\s*(?=\d{3,4}年\s*[：:])/gu,'\n$1\n- ').replace(/\s+-\s*(?=\d{3,4}年\s*[：:])/g,'\n- ');
 }
 const lines=text.split(/\n+/).map(x=>x.trim()).filter(Boolean);
 return '<div class="original">'+lines.map(line=>{
  if(timeline&&/^-\s*\d{3,4}年\s*[：:]/.test(line)){const m=line.match(/^-\s*(\d{3,4}年)\s*[：:]\s*([\s\S]*)/);return '<div class="timeline-entry"><b>'+esc(m[1])+'</b><p>'+esc(m[2])+'</p></div>'}
  if(timeline&&/^[\p{Script=Han}]{2,14}$/u.test(line))return '<h4>'+esc(line)+'</h4>';
  return '<p>'+esc(line)+'</p>';
 }).join('')+'</div>';
}
function renderStructuredBody(body){return '<div class="original">'+body.sections.map(s=>s.paragraphs.filter(p=>p.trim()).map(p=>'<p>'+esc(displayBody(p))+'</p>').join('')).join('')+'</div>'}

export function renderDigestHtml(job,items,date,{failures=[],generatedAt=new Date().toISOString(),highlights=null,premerged=false,collectedCount=items.length,dedupStats=null,window=null}={}){const edition=newsEdition(job.time??new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(generatedAt)));const {unique,groups}=digestGroups(items,{premerged});const nav=[...groups.keys()].map((n,i)=>`<a href="#c${i}">${esc(n)}</a>`).join(' · ');let index=0;const body=[...groups].map(([name,entries],i)=>`<section id="c${i}"><h2>${esc(name)} · ${entries.length}条</h2>${entries.map(x=>{const seen=new Set(),parts=[];for(const v of (x.variants??[x])){for(const sentence of articleBody(v).match(/[^。！？!?]+[。！？!?]+|[^。！？!?]+$/gu)??[]){const key=normalize(sentence);if(key&&!seen.has(key)){seen.add(key);parts.push(sentence)}}}return `<article${Array.isArray(x.sourceIndices)?' data-source-indices="'+x.sourceIndices.join(',')+'"':''}><h3>${esc(displayTitle(x.title))}</h3>${x.structuredBody?renderStructuredBody(x.structuredBody):renderArticleBody(parts.join('\n'))}${(x.variants??[x]).some(v=>v.summary_truncated||v.body_truncated)?'<p class="meta">采集内容超过安全上限，未据此补写缺失信息。</p>':''}</article>`}).join('')}</section>`).join('');return template.replace(/\{\{([A-Z_]+)\}\}/g,(_,key)=>({WINDOW_NOTE:esc(window?'采集区间（北京时间）：'+new Date(window.start).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 至 '+new Date(window.end).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（起点不含，终点包含）。':'按消息发布时间筛选近24小时。'),HERO_IMAGE:heroImage,EDITION_TITLE:esc(edition.title),NOTE_TITLE:esc(edition.noteTitle),NOTE_TEXT:esc(edition.note),CAPTION:esc(edition.label+'新闻精选，事件日期见正文。'),WEEKDAY:(/^\d{4}-\d{2}-\d{2}$/.test(date)?new Intl.DateTimeFormat('zh-CN',{weekday:'long',timeZone:'Asia/Shanghai'}).format(new Date(date+'T12:00:00+08:00')):''),EDITION:esc(edition.label+'版'+(job.time?'｜'+job.time:'')),DATE:esc(date),TITLE:esc(job.title??'新闻分类汇总'),TIME:esc(job.time??''),COUNT:String(unique.length),FETCHED:String(collectedCount),GENERATED:esc(generatedAt),FAILURES:failures.length?`<p>读取失败：${esc(failures.join('、'))}</p>`:'',DEDUP_META:dedupStats?esc(` 批次${dedupStats.batch}；算法去重后${dedupStats.algorithm}条；AI阶段${({ai_validated:'完成并通过校验',ai_fallback:'失败，保留算法结果',budget_fallback:'超过输入预算，保留算法结果',not_needed:'无候选，无需调用'})[dedupStats.status]}；最终${dedupStats.final}条。${dedupStats.pipeline==='model-compose'?' '+(dedupStats.status==='ai_validated'?'正文为AI聚合摘要（未经独立核实）':'AI聚合未完成，保留完整采集正文')+'；输入'+dedupStats.collected+'条，去向覆盖'+dedupStats.coverage+'条。':''}${dedupStats.organization?' 正文结构整理：'+({ai_validated:'AI语义整理及原句去向校验通过',ai_fallback:'失败，保留完整正文',budget_fallback:'超过预算，保留完整正文',not_needed:'无需处理'}[dedupStats.organization]??'未知')+'。':''}`):'',NAV:nav,HIGHLIGHTS:renderHighlights(items,highlights,{premerged}),BODY:body||'<p>暂无符合时间范围的消息。</p>'}[key]??''))}

// Time handling and duplicate filtering are algorithmic; only these fields need enter a model.
export function modelInput(items,now=new Date()){const timestamp=now.getTime();const eligible=items.filter(x=>{const t=Date.parse(x.published);return Number.isFinite(t)&&t<=timestamp&&timestamp-t<=86400000});return aggregate(eligible).map(x=>({title:x.title,summary:articleBody(x)}))}

export function selectHighlights(items,{premerged=false}={}){const {unique}=digestGroups(items,{premerged}),selected=[];for(const [name,group] of [['金融','财经与商业'],['科技','AI与科技'],['教育','教育']]){const eligible=unique.filter(x=>category(x)===group);if(!eligible.length)continue;const score=x=>{const t=x.title;return (/政策|央行|利率|监管|发布|开放|招生|考试|教师|教育/.test(t)?3:0)+(/生效|启动|落地|上线/.test(t)?2:0)-(/传闻|或将|计划|预测|预计/.test(t)?2:0)};eligible.sort((a,b)=>score(b)-score(a));selected.push({category:name,item:eligible[0]})}return selected}
function renderHighlights(items,analysis=null,{premerged=false}={}){if(analysis!==null){if(!Array.isArray(analysis)||analysis.length>5)throw Error('INVALID_NEWS_HIGHLIGHTS');const titles=new Set(items.map(x=>x.title));for(const x of analysis)if(!titles.has(x.title)||!['category','title','what','impact','watch','uncertainty'].every(k=>typeof x[k]==='string'&&x[k].length<=1200))throw Error('INVALID_NEWS_HIGHLIGHTS');if(!analysis.length)return '';return `<section class="highlights"><h2>重点新闻</h2>${analysis.map(x=>`<aside><span class="badge">${esc(x.category)}</span><h3>${esc(displayTitle(x.title))}</h3><p><b>发生了什么：</b>${esc(x.what)}</p><p><b>影响：</b>${esc(x.impact)}</p><p><b>后续关注：</b>${esc(x.watch)}</p><p class="meta">${esc(x.uncertainty)}</p></aside>`).join('')}</section>`}const chosen=selectHighlights(items,{premerged});if(!chosen.length)return '';return `<section class="highlights"><h2>重点新闻</h2>${chosen.map(({category:group,item})=>`<aside><span class="badge">${esc(group)}</span><h3>${esc(displayTitle(item.title))}</h3></aside>`).join('')}</section>`}
