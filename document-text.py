#!/usr/bin/env python3
# Bounded OOXML extraction; never extracts archive paths, executes macros, or follows document relationships.
import sys,zipfile,json,re,xml.etree.ElementTree as ET
path=sys.argv[1];limit=12000;lines=[];used=0;truncated=False
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main','a':'http://schemas.openxmlformats.org/drawingml/2006/main','s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def add(s):
 global used,truncated
 if used>=limit:truncated=True;return
 s=s[:limit-used];lines.append(s);used+=len(s)+1
with zipfile.ZipFile(path) as z:
 infos=z.infolist()
 if len(infos)>2000 or sum(i.file_size for i in infos)>32*1024*1024:raise ValueError('DOCUMENT_LIMIT')
 def xml(name):
  i=z.getinfo(name)
  if i.file_size>4*1024*1024:raise ValueError('XML_LIMIT')
  return ET.fromstring(z.read(name))
 names=set(z.namelist())
 if 'word/document.xml' in names:
  for p in xml('word/document.xml').findall('.//w:p',ns):add(''.join(t.text or '' for t in p.findall('.//w:t',ns)))
  kind='docx'
 elif 'xl/workbook.xml' in names:
  strings=[]
  if 'xl/sharedStrings.xml' in names:strings=[''.join(t.text or '' for t in x.findall('.//s:t',ns)) for x in xml('xl/sharedStrings.xml').findall('s:si',ns)]
  sheets=sorted(n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml',n));kind='xlsx'
  for name in sheets:
   add('Worksheet part '+name)
   rows=xml(name).findall('.//s:row',ns)
   for row in rows[:200]:
    cells=[]
    for c in row.findall('s:c',ns):
     v=c.find('s:v',ns);text=v.text or '' if v is not None else ''
     if c.get('t')=='s':text=strings[int(text)] if text.isdigit() and int(text)<len(strings) else '[unresolved shared string]'
     if c.get('t')=='inlineStr':text=''.join(t.text or '' for t in c.findall('.//s:t',ns))
     f=c.find('s:f',ns)
     cells.append((c.get('r') or '')+': '+('formula '+(f.text or '')+'; cached=' if f is not None else '')+text)
    add(' | '.join(cells))
   if len(rows)>200:truncated=True
 elif any(re.fullmatch(r'ppt/slides/slide\d+\.xml',n) for n in names):
  slides=sorted((n for n in names if re.fullmatch(r'ppt/slides/slide\d+\.xml',n)),key=lambda n:int(re.search(r'(\d+)\.xml',n)[1]));kind='pptx'
  for name in slides:add(name+'\n'+'\n'.join(t.text or '' for t in xml(name).findall('.//a:t',ns)))
 else:raise ValueError('UNSUPPORTED_ARCHIVE')
print(json.dumps({'format':kind,'text':'\n'.join(lines),'truncated':truncated,'scope':'OOXML text only; formatting, embedded images, macros and external links not processed.'},ensure_ascii=False))
