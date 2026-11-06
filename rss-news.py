"""Fetch RSS/Atom as data only; no model, Telegram login or WeChat dependency."""
import hashlib
import sys,json,urllib.request,xml.etree.ElementTree as E,datetime,email.utils,html,re
from html.parser import HTMLParser
class Text(HTMLParser):
 def __init__(self):super().__init__();self.parts=[];self.skip=0
 def handle_starttag(self,tag,attrs):
  if tag in ['script','style']:self.skip+=1
  if not self.skip and tag in ['p','div','br','li','h1','h2','h3','h4','blockquote']:self.parts.append('\n')
 def handle_endtag(self,tag):
  if tag in ['script','style']:self.skip=max(0,self.skip-1)
  if not self.skip and tag in ['p','div','li','h1','h2','h3','h4','blockquote']:self.parts.append('\n')
 def handle_data(self,data):
  if not self.skip:self.parts.append(data)
def plain(s):
 p=Text();p.feed(s or '');return '\n'.join(re.sub(r'[^\S\n]+',' ',line).strip() for line in html.unescape(' '.join(p.parts)).splitlines() if line.strip())
def fetch(url,now,limit,start=None):
 req=urllib.request.Request(url,headers={'User-Agent':'WeChatNews/1.0'})
 with urllib.request.urlopen(req,timeout=20) as r:
  b=r.read(4000001)
  if len(b)>4000000:raise ValueError('FEED_TOO_LARGE')
 if b'<!DOCTYPE' in b.upper() or b'<!ENTITY' in b.upper():raise ValueError('UNSAFE_XML')
 root=E.fromstring(b)
 if root.tag not in ['rss','{http://www.w3.org/2005/Atom}feed']:raise ValueError('NOT_A_FEED')
 atom='{http://www.w3.org/2005/Atom}';items=root.findall('./channel/item') or root.findall(atom+'entry');out=[];seen=set()
 for i in items:
  date=i.findtext('pubDate') or i.findtext(atom+'published') or i.findtext(atom+'updated')
  try:
   dt=email.utils.parsedate_to_datetime(date) if date and ',' in date else datetime.datetime.fromisoformat(date.replace('Z','+00:00'));dt=dt.astimezone(datetime.timezone.utc)
  except (ValueError,TypeError,AttributeError):continue
  age=(now-dt).total_seconds()
  if age<0 or (dt<=start if start is not None else age>86400):continue
  link=i.findtext('link');al=i.find(atom+'link')
  if not link and al is not None:link=al.get('href')
  if link and not link.startswith(('https://','http://')):link=None
  key=i.findtext('guid') or i.findtext(atom+'id') or link or hashlib.sha256(E.tostring(i)).hexdigest()
  if key in seen:continue
  seen.add(key);title=plain(i.findtext('title') or i.findtext(atom+'title'));text=plain(i.findtext('{http://purl.org/rss/1.0/modules/content/}encoded') or i.findtext(atom+'content') or i.findtext('description') or i.findtext(atom+'summary'))
  out.append({'id':hashlib.sha256(key.encode()).hexdigest()[:24],'title':title,'summary':text[:16000],'published':dt.isoformat(),'summary_truncated':len(text)>16000})
 return sorted(out,key=lambda x:x['published'],reverse=True)[:limit]
if __name__=='__main__':
 try:
  c=json.load(sys.stdin);now=datetime.datetime.fromisoformat(c['now'].replace('Z','+00:00'));print(json.dumps(fetch(c['url'],now,c.get('limit',80),datetime.datetime.fromisoformat(c['start'].replace('Z','+00:00')) if c.get('start') else None),ensure_ascii=False))
 except Exception:print(json.dumps({'error':'RSS_FETCH_OR_PARSE_FAILED'}));sys.exit(1)
