import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,mkdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {accountPaths} from '../../src/infrastructure/accounts/account-store.mjs'
test('default account path and invalid account ids cannot traverse directories',()=>{assert.equal(accountPaths('default','/tmp/home').stateDir,'/tmp/home/.local/share/wechat-ping-bot');for(const id of ['../default','a/b','a;id','DEFAULT','', '-bad'])assert.throws(()=>accountPaths(id,'/tmp/home'));assert.throws(()=>accountPaths('one','/tmp/home'),/SINGLE_USER_INSTALLATION/)})
test('single user registration rejects named profiles and binds the scanner',async t=>{
 const {registerLogin}=await import('../../src/infrastructure/accounts/account-store.mjs')
 const home=await mkdtemp('/tmp/single-registration-');t.after(()=>rm(home,{recursive:true,force:true}))
 const p=accountPaths('default',home);await mkdir(p.stateDir,{recursive:true})
 const credentials={accountId:'bot',userId:'owner',token:'mock'}
 await registerLogin('default',credentials,home)
 await assert.rejects(registerLogin('one',credentials,home),/SINGLE_USER_INSTALLATION/)
 await assert.rejects(registerLogin('default',{...credentials,userId:'stranger'},home),/PROFILE_BOUND/)
})
test('a different scanner account cannot inherit an existing profile history or owners',async()=>{const {registerLogin}=await import('../../src/infrastructure/accounts/account-store.mjs'),{readFile}=await import('node:fs/promises'),home=await mkdtemp('/tmp/profile-binding-');try{const p=accountPaths('default',home);await mkdir(p.stateDir,{recursive:true});await registerLogin('default',{accountId:'original',userId:'original-owner',token:'private'},home);await assert.rejects(registerLogin('default',{accountId:'different',userId:'other',token:'other-private'},home),/PROFILE_BOUND/);assert.equal(JSON.parse(await readFile(join(p.stateDir,'credentials.json'),'utf8')).accountId,'original');assert.deepEqual(JSON.parse(await readFile(join(p.stateDir,'codex-owners.json'),'utf8')),['original-owner'])}finally{await rm(home,{recursive:true,force:true})}})
test('an identity remains bound when credentials are missing',async()=>{const {registerLogin,rememberIdentity}=await import('../../src/infrastructure/accounts/account-store.mjs'),{readFile}=await import('node:fs/promises'),home=await mkdtemp('/tmp/profile-identity-');try{const p=accountPaths('default',home);await mkdir(p.stateDir,{recursive:true});await rememberIdentity(p,{accountId:'original'});await assert.rejects(registerLogin('default',{accountId:'different',userId:'other-owner',token:'private'},home),/PROFILE_BOUND/);assert.equal(JSON.parse(await readFile(join(p.stateDir,'account-identity.json'),'utf8')).accountId,'original');await assert.rejects(readFile(join(p.stateDir,'credentials.json')),e=>e.code==='ENOENT')}finally{await rm(home,{recursive:true,force:true})}})
test('the same scanner can relink a new bot ID without reusing the old poll cursor',async()=>{const {registerLogin}=await import('../../src/infrastructure/accounts/account-store.mjs'),{readFile,readdir}=await import('node:fs/promises'),home=await mkdtemp('/tmp/profile-relink-');try{const p=accountPaths('default',home);await mkdir(p.stateDir,{recursive:true});await registerLogin('default',{accountId:'old-bot',userId:'same-owner',token:'old-token'},home);await writeFile(join(p.stateDir,'cursor.json'),'old-cursor');await writeFile(join(p.stateDir,'context_tokens.json'),'old-context');await registerLogin('default',{accountId:'new-bot',userId:'same-owner',token:'new-token'},home);assert.equal(JSON.parse(await readFile(join(p.stateDir,'credentials.json'),'utf8')).accountId,'new-bot');assert.equal(JSON.parse(await readFile(join(p.stateDir,'account-identity.json'),'utf8')).accountId,'new-bot');assert.deepEqual(JSON.parse(await readFile(join(p.stateDir,'codex-owners.json'),'utf8')),['same-owner']);const files=await readdir(p.stateDir);assert(!files.includes('cursor.json'));assert(!files.includes('context_tokens.json'));assert(files.some(name=>name.startsWith('cursor.json.previous-')));assert(files.some(name=>name.startsWith('context_tokens.json.previous-')))}finally{await rm(home,{recursive:true,force:true})}})

test('a verified sole owner can relink after the old credential file was lost',async t=>{
 const {registerLogin}=await import('../../src/infrastructure/accounts/account-store.mjs')
 const home=await mkdtemp('/tmp/profile-owner-relink-')
 t.after(()=>rm(home,{recursive:true,force:true}))
 const p=accountPaths('default',home)
 await mkdir(p.stateDir,{recursive:true})
 await registerLogin('default',{accountId:'old',userId:'owner',token:'first'},home)
 await rm(join(p.stateDir,'credentials.json'))
 await assert.rejects(registerLogin('default',{accountId:'new',userId:'different',token:'second'},home),/PROFILE_BOUND/)
 await registerLogin('default',{accountId:'new',userId:'owner',token:'second'},home)
})

test('scanner identity survives conflicting bot IDs and missing owner file',async t=>{
 const {registerLogin,rememberIdentity}=await import('../../src/infrastructure/accounts/account-store.mjs')
 const home=await mkdtemp('/tmp/profile-rotated-bot-')
 t.after(()=>rm(home,{recursive:true,force:true}))
 const p=accountPaths('default',home)
 await mkdir(p.stateDir,{recursive:true})
 await registerLogin('default',{accountId:'first',userId:'owner',token:'old'},home)
 await rememberIdentity(p,{accountId:'second',userId:'owner'})
 await rm(join(p.stateDir,'codex-owners.json'))
 await assert.rejects(registerLogin('default',{accountId:'first',userId:'other',token:'new'},home),/PROFILE_BOUND/)
 await registerLogin('default',{accountId:'third',userId:'owner',token:'new'},home)
})
