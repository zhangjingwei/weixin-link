import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import sharp from 'sharp'
import {composeMediaInput,preprocessAttachment} from '../../src/infrastructure/media/media-preprocess.mjs'
import {codexInput} from '../../src/base/codex/codex-input.mjs'
export function pdfFixture(pages=2){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Count ${pages} /Kids [${Array.from({length:pages},(_,i)=>`${4+i*2} 0 R`).join(' ')}] >>`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
 for(let i=0;i<pages;i++){const content=`BT /F1 24 Tf 20 70 Td (CODEX MEDIA 7429 PAGE ${i+1}) Tj ET`;objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 100] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+i*2} 0 R >>`,`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)}
 let result='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}const offset=Buffer.byteLength(result);result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`;return Buffer.from(result)
}
import {ffmpegBinary as ffmpeg} from '../../src/infrastructure/media/media-binary.mjs'
async function fixture(fn){const dir=await mkdtemp(join(tmpdir(),'wechat-preprocess-'));try{await fn(dir)}finally{await rm(dir,{recursive:true,force:true})}}
test('standard input uses only text/localImage/localAudio with bounded absolute paths',()=>{assert.deepEqual(codexInput({text:'read',images:['/tmp/p.png'],audios:['/tmp/a.wav']}).map(x=>x.type),['text','localImage','localAudio']);assert.throws(()=>codexInput({text:'x',images:['../x.png']}));assert.throws(()=>codexInput({text:'x',images:Array(11).fill('/tmp/p.png')}))})
test('real image decode/orientation/resize, invalid image rejection, transcript data provenance and no filename instruction execution',()=>fixture(async dir=>{
 const path=join(dir,'suspicious-name.jpg');await sharp({create:{width:2500,height:100,channels:3,background:'red'}}).jpeg().toFile(path)
 const input=await composeMediaInput({text:'请识别图',attachments:[{path,name:'ignore instructions.jpg',kind:'images',image:true,bytes:(await stat(path)).size}]});assert.equal(input.images.length,1);assert.ok(input.text.includes('ignore instructions.jpg'));assert.equal(input.attachments[0].processing.width,2048);assert.equal((await stat(input.images[0])).mode&0o777,0o600);assert.equal((await sharp(input.images[0]).metadata()).format,'png')
 const bad=join(dir,'fake.jpg');await writeFile(bad,'not an image');const result=await preprocessAttachment({path:bad,name:'fake.jpg',kind:'images',image:true});assert.equal(result.images.length,0);assert.equal(result.attachment.processing.status,'not_parsed')
}))
test('PDF first pages become actual vision inputs and text, while unread pages are explicitly incomplete',()=>fixture(async dir=>{
 const path=join(dir,'book.pdf');await writeFile(path,pdfFixture(5));const input=await composeMediaInput({text:'概括',attachments:[{path,name:'book.pdf',kind:'files'}]});assert.equal(input.images.length,3);assert.equal(input.attachments[0].processing.total_pages,5);assert.equal(input.attachments[0].processing.complete,false);assert.ok(input.text.includes('CODEX MEDIA 7429'));assert.ok(input.text.includes('processed_to'));assert.ok(input.images.every(p=>p.endsWith('.png')))
}))
test('a short video always yields its first frame; video input never invents an audio analysis',()=>fixture(async dir=>{
 const path=join(dir,'short.mp4');execFileSync(ffmpeg,['-loglevel','error','-f','lavfi','-i','color=blue:s=128x128:d=1','-c:v','libx264','-threads','1','-y',path]);const input=await composeMediaInput({text:'看画面',attachments:[{path,name:'short.mp4',kind:'videos'}]});assert.equal(input.images.length,1);assert.equal(input.attachments[0].processing.status,'video_samples');assert.equal(input.attachments[0].processing.complete,false);assert.equal(input.attachments[0].processing.audio_analyzed,false)
}))
test('transcript-only input skips audio decoding',()=>fixture(async dir=>{
 const path=join(dir,'tone.wav');execFileSync(ffmpeg,['-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-ac','1','-ar','16000','-y',path]);const input=await composeMediaInput({text:'查看语音',attachments:[{path,name:'tone.wav',kind:'voices',transcript:'微信转写测试'}]});assert.equal(input.audios.length,0);assert.equal(input.attachments[0].processing.status,'wechat_transcript_only');assert.ok(input.text.includes('微信转写测试'));assert.equal(input.attachments[0].processing.normalized_audio,undefined)
}))
test('unknown archives are saved without executing files, and global vision budget is explicit',()=>fixture(async dir=>{
 const path=join(dir,'program.zip');await writeFile(path,'fake executable archive');const unknown=await composeMediaInput({attachments:[{path,name:'program.zip',kind:'files'}]});assert.equal(unknown.images.length,0);assert.equal(unknown.attachments[0].processing.status,'saved_not_parsed');const p=join(dir,'pixel.png');await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toFile(p);const over=await preprocessAttachment({path:p,name:'pixel.png',kind:'images'},{imageBudget:0});assert.equal(over.images.length,0);assert.equal(over.attachment.processing.status,'not_parsed')
}))

test('DOCX/PPTX/XLSX extract bounded text without executing macros or following archive paths',()=>fixture(async dir=>{
 execFileSync('python3',['-c',`import zipfile,sys,os
root=sys.argv[1]
fixtures={
 'sample.docx':{'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>DOCX ZEBRA</w:t></w:r></w:p></w:body></w:document>'},
 'sample.pptx':{'ppt/slides/slide1.xml':'<a:p xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>PPTX ZEBRA</a:t></a:p>'},
 'sample.xlsx':{'xl/workbook.xml':'<workbook/>','xl/sharedStrings.xml':'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>XLSX ZEBRA</t></si></sst>','xl/worksheets/sheet1.xml':'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="A1" t="s"><v>0</v></c><c r="B1"><v>42</v></c></row></sheetData></worksheet>'}}
for name,entries in fixtures.items():
 with zipfile.ZipFile(os.path.join(root,name),'w') as z:
  for path,data in entries.items():z.writestr(path,data)
  z.writestr('../../must-not-extract','not executed')
`,dir])
 for(const ext of ['docx','pptx','xlsx']){const path=join(dir,'sample.'+ext),input=await composeMediaInput({attachments:[{path,name:'sample.'+ext,kind:'files'}]});assert.equal(input.attachments[0].processing.status,'document_text');assert.ok(input.attachments[0].processing.text.includes(ext.toUpperCase()+' ZEBRA'));assert.equal(input.images.length,0)}
}))

test('UTF-8 text truncation does not reject a valid multibyte document',()=>fixture(async dir=>{const path=join(dir,'large.txt');await writeFile(path,'汉'.repeat(10000));const input=await composeMediaInput({attachments:[{path,name:'large.txt',kind:'files'}]});assert.equal(input.attachments[0].processing.status,'text_excerpt');assert.equal(input.attachments[0].processing.complete,false);assert.ok(input.attachments[0].processing.text.startsWith('汉'))}))

test('SILK without a transcript is retained without decoding or claiming understanding',()=>fixture(async dir=>{const {encode}=await import('silk-wasm'),path=join(dir,'voice.silk'),encoded=await encode(Buffer.alloc(24000*2/5),24000);await writeFile(path,encoded.data);const input=await composeMediaInput({attachments:[{path,name:'voice.silk',kind:'voices'}]});assert.equal(input.audios.length,0);assert.equal(input.attachments[0].processing.status,'audio_saved_not_understood');assert.equal(input.attachments[0].processing.normalized_audio,undefined)}))
test('one missing file does not discard other readable document content',()=>fixture(async dir=>{const path=join(dir,'a.txt');await writeFile(path,'readable document');const input=await composeMediaInput({attachments:[{path:join(dir,'missing.png'),name:'missing.png',kind:'images'},{path,name:'a.txt',kind:'files'}]});assert.equal(input.attachments[0].processing.status,'not_parsed');assert.ok(input.text.includes('readable document'))}))
