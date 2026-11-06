import sharp from 'sharp'
import {chromium} from 'playwright-core'
import {access,mkdir,writeFile} from 'node:fs/promises'
import {join,dirname} from 'node:path'
import {homedir} from 'node:os'
const exists=async p=>{try{await access(p);return true}catch{return false}}
// Local deterministic rendering: no model calls, network requests or page scripts.
export async function renderNewsImages(html,outputBase,{mode='single',quality=80}={}){
 const home=homedir(),libs=join(home,'.cache/mova-browser-libs/usr/lib/aarch64-linux-gnu'),fonts=join(home,'.cache/news-fonts'),config=join(fonts,'fontconfig.xml')
 if(!await exists(join(fonts,'NotoSansCJKsc-Regular.otf')))throw Error('NEWS_FONT_UNAVAILABLE')
 await mkdir(fonts,{recursive:true,mode:0o700});await writeFile(config,`<?xml version="1.0"?><fontconfig><dir>${fonts}</dir><cachedir>${fonts}/cache</cachedir></fontconfig>`,{mode:0o600})
 const browser=await chromium.launch({headless:true,env:{...process.env,FONTCONFIG_FILE:config,...(await exists(libs)?{LD_LIBRARY_PATH:[libs,process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')}:{})}})
 const deadline=setTimeout(()=>browser.close().catch(()=>{}),45000)
 try{
  const page=await browser.newPage({viewport:{width:880,height:1800},deviceScaleFactor:1,javaScriptEnabled:false})
  await page.route('**/*',r=>r.abort())
  // Image shows only titles; the source HTML keeps full summaries unchanged.
  const titleStyle='<style>.original,article > p,.highlights aside > p,.highlights .meta,.highlights .badge,.batch-meta,.morning-note,.caption,footer{display:none!important}main article,main .highlights aside{padding:10px 12px 16px;margin-bottom:12px}main h3{font-size:30px;line-height:1.5;letter-spacing:0}</style>'
  await page.setContent(titleStyle+html,{waitUntil:'load',timeout:15000})
  await page.evaluate(()=>document.fonts.ready)
  const height=await page.locator('body').evaluate(e=>e.scrollHeight)
  if(height*880>40000000||(mode==='pages'&&height>12600))throw Error('NEWS_IMAGE_TOO_LONG') // Never silently omit remaining stories.
  await mkdir(dirname(outputBase),{recursive:true,mode:0o700})
  if(mode==='single'){const path=outputBase+'.jpg';const pixels=await page.screenshot({fullPage:true,timeout:15000});await sharp(pixels,{limitInputPixels:40000000}).jpeg({quality,mozjpeg:true,chromaSubsampling:'4:4:4'}).toFile(path);return [path]}
  const cuts=await page.locator('article,aside,section h2,footer').evaluateAll(es=>es.map(e=>Math.floor(e.getBoundingClientRect().top+window.scrollY)))
  const paths=[]
  for(let y=0;y<height;){
   const limit=Math.min(y+1800,height),candidates=cuts.filter(n=>n>y+900&&n<=limit)
   const end=limit===height?height:candidates.at(-1)??limit
   const path=`${outputBase}-${paths.length+1}.png`
   await page.screenshot({path,fullPage:true,clip:{x:0,y,width:880,height:end-y},timeout:15000});paths.push(path);y=end
   if(paths.length>7)throw Error('NEWS_IMAGE_TOO_LONG')
  }
  return paths
 }finally{clearTimeout(deadline);await browser.close()}
}
