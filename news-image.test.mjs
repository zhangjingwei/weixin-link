import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,access} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir,homedir} from 'node:os'
import sharp from 'sharp'
import {renderNewsImages} from './news-image.mjs'
test('local news screenshots cover content beyond the viewport without losing the tail',async t=>{
 try{await access(join(homedir(),'.cache/news-fonts/NotoSansCJKsc-Regular.otf'))}catch{return t.skip('Chinese font not provisioned')}
 const dir=await mkdtemp(join(tmpdir(),'news-images-'))
 try{
  const html='<html><head><style>body{margin:0;color:#000;background:#fff}article{height:800px;box-sizing:border-box;border-top:8px solid green}</style></head><body>'+Array.from({length:3},(_,i)=>`<article>第${i+1}条新闻</article>`).join('')+'</body></html>'
  const paths=await renderNewsImages(html,join(dir,'news'),{mode:'pages'});const sizes=await Promise.all(paths.map(p=>sharp(p).metadata()))
  const single=await renderNewsImages(html,join(dir,'single'));assert.equal(single.length,1);assert.equal((await sharp(single[0]).metadata()).format,'jpeg');assert.equal((await sharp(single[0]).metadata()).height,2400)
  assert.ok(paths.length>1);assert.equal(sizes.reduce((n,s)=>n+s.height,0),2400);assert.ok(sizes.every(s=>s.width===880&&s.height<=1800));assert.equal(sizes.at(-1).height,800)
 }finally{await rm(dir,{recursive:true,force:true})}
})
