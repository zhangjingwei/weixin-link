import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {displayQr} from '../../src/setup/qr-display.mjs'

const qr = {path:'/tmp/source with spaces/二维码-default-test.png'}
function fixture(overrides = {}) {
 const writes = [], calls = []
 return {writes, calls, options: {language:'zh',
  output:{isTTY:true,columns:80,write:text=>writes.push(text)},
  platform:'darwin', env:{}, now:()=>100,
  read:async path=>path.endsWith('pairing.json') ?
   JSON.stringify({status:'waiting_scan',valid_until:200,qr_version:'test'}) : '▀▄█',
  run:async(...args)=>calls.push(args), ...overrides,
 }}
}
test('local Mac opens the exported PNG using a literal path argument', async()=>{
 const f=fixture()
 await displayQr(qr,'/state',f.options)
 assert.deepEqual(f.calls[0],['open',[qr.path],{timeout:5000}])
 assert(f.writes.includes('▀▄█\n'))
 assert(f.writes.some(text=>text.includes(qr.path)))
})
test('image opener failure retains the path and does not fail installation', async()=>{
 const f=fixture({run:async()=>{throw Error('no viewer')}})
 await displayQr(qr,'/state',f.options)
 assert(f.writes.some(text=>text.includes('无法自动打开')))
 assert(f.writes.some(text=>text.includes(qr.path)))
})
test('SSH and headless Linux never launch a local viewer', async()=>{
 for(const overrides of [{env:{SSH_CONNECTION:'remote'}},{platform:'linux'}]){
  const f=fixture(overrides)
  await displayQr(qr,'/state',f.options)
  assert.equal(f.calls.length,0)
  assert(f.writes.some(text=>text.includes(qr.path)))
 }
})
test('Linux desktop opens PNG with xdg-open', async()=>{
 const f=fixture({platform:'linux',env:{WAYLAND_DISPLAY:'wayland-0'}})
 await displayQr(qr,'/state',f.options)
 assert.equal(f.calls[0][0],'xdg-open')
})
test('redirected output stays machine readable and does not open windows', async()=>{
 const f=fixture()
 f.options.output.isTTY=false
 await displayQr(qr,'/state',f.options)
 assert.deepEqual(f.calls,[])
 assert.deepEqual(f.writes,[])
})
test('human installation logs retain the PNG path even when redirected', async()=>{
 const f=fixture({human:true})
 f.options.output.isTTY=false
 await displayQr(qr,'/state',f.options)
 assert.deepEqual(f.calls,[])
 assert(f.writes.some(text=>text.includes(qr.path)))
 assert(!f.writes.includes('▀▄█\n'))
})
test('narrow terminals skip QR characters that would wrap', async()=>{
 const f=fixture()
 f.options.output.columns=3
 await displayQr(qr,'/state',f.options)
 assert(!f.writes.includes('▀▄█\n'))
 assert.equal(f.calls.length,1)
})
test('a newer pairing generation is not mixed with the exported PNG', async()=>{
 const f=fixture()
 await displayQr({...qr,path:'/tmp/qr-previous.png'},'/state',f.options)
 assert(!f.writes.includes('▀▄█\n'))
})
test('desktop opens the current HTTPS login link and shows its address',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'qr-link-')),version='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',url='https://weixin.qq.com/x/test'
 t.after(()=>rm(dir,{recursive:true,force:true}))
 await writeFile(join(dir,'login-'+version+'.url'),url,{mode:0o600})
 const f=fixture({read:async path=>path.endsWith('pairing.json')?JSON.stringify({status:'waiting_scan',valid_until:200,qr_version:version}):'QR'})
 await displayQr({path:'/tmp/login-'+version+'.png'},dir,f.options)
 assert.deepEqual(f.calls[0],['open',[url],{timeout:5000}])
 assert(f.writes.some(text=>text.includes(url)))
 const windows=fixture({platform:'win32',read:f.options.read})
 await displayQr({path:'/tmp/login-'+version+'.png'},dir,windows.options)
 assert.deepEqual(windows.calls[0],['explorer.exe',[url],{timeout:5000}])
})
test('English QR display explains the browser link and PNG fallback',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'qr-link-en-')),version='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',url='https://weixin.qq.com/x/english'
 t.after(()=>rm(dir,{recursive:true,force:true}))
 await writeFile(join(dir,'login-'+version+'.url'),url,{mode:0o600})
 const f=fixture({language:'en',read:async path=>path.endsWith('pairing.json')?JSON.stringify({status:'waiting_scan',valid_until:200,qr_version:version}):'QR'})
 await displayQr({path:'/tmp/login-'+version+'.png'},dir,f.options)
 assert(f.writes.join('').includes('WeChat login link'))
 assert(f.writes.join('').includes('open this PNG'))
})
