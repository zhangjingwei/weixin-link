import test from 'node:test'
import assert from 'node:assert/strict'
import {setupLanguage,languageOption} from '../../src/setup/setup-locale.mjs'

test('terminal language follows Chinese or English locale and supports an explicit override',()=>{
 assert.equal(setupLanguage({env:{LANG:'zh_CN.UTF-8'}}),'zh')
 assert.equal(setupLanguage({env:{LC_ALL:'en_US.UTF-8',LANG:'zh_CN.UTF-8'}}),'en')
 assert.equal(setupLanguage({env:{LANG:'C'},systemLocale:'en-US'}),'zh')
 assert.deepEqual(languageOption(['--lang','en','bot2']),{language:'en',args:['bot2']})
 assert.deepEqual(languageOption(['bot2','--lang=zh']),{language:'zh',args:['bot2']})
 assert.throws(()=>languageOption(['--lang','fr']),/INVALID_SETUP_LANGUAGE/)
})
