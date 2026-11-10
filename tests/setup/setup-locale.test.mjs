import test from 'node:test'
import assert from 'node:assert/strict'
import {setupLanguage,languageOption,installerCommand} from '../../src/setup/setup-locale.mjs'

test('terminal language follows Chinese or English locale and supports an explicit override',()=>{
 assert.equal(setupLanguage({env:{LANG:'zh_CN.UTF-8'}}),'zh')
 assert.equal(setupLanguage({env:{LC_ALL:'en_US.UTF-8',LANG:'zh_CN.UTF-8'}}),'en')
 assert.equal(setupLanguage({env:{LANG:'C'},systemLocale:'en-US'}),'zh')
 assert.deepEqual(languageOption(['--lang','en','bot2']),{language:'en',args:['bot2']})
 assert.deepEqual(languageOption(['bot2','--lang=zh']),{language:'zh',args:['bot2']})
 assert.throws(()=>languageOption(['--lang','fr']),/INVALID_SETUP_LANGUAGE/)
})
test('installer command gives copyable Unix and Windows maintenance entry points',()=>{
 assert.equal(installerCommand('setup',{platform:'linux',language:'en'}),'curl -fsSL https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.sh | WEIXIN_LINK_LANG=en sh')
 assert.equal(installerCommand('relogin',{platform:'win32',accountId:'bot2'}),"& ([scriptblock]::Create((Invoke-RestMethod 'https://raw.githubusercontent.com/zhangjingwei/weixin-link/main/install.ps1')))")
})
