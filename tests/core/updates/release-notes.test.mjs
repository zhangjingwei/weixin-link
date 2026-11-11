import test from 'node:test'
import assert from 'node:assert/strict'
import {changelogSection,releaseDetails,releaseSummary} from '../../../src/domain/updates/release-notes.mjs'

test('summary uses at most five maintained bullets, ignores code and bounds Unicode length',()=>{
 const notes='Intro\n```md\n- example to ignore\n```\n'+Array.from({length:8},(_,i)=>'- **Change '+i+'** '+(i===0?'😀'.repeat(200):'[details](https://example.com)')).join('\n')
 const result=releaseSummary(notes)
 assert.equal(result.split('\n').filter(line=>line.startsWith('• ')).length,5)
 assert.doesNotMatch(result,/example to ignore|Change 5|https:\/\/example/)
 assert.match(result,/…/);assert.ok(Array.from(result).length<900)
 assert.match(releaseSummary('No maintained bullets'),/暂未提供/)
 assert.match(releaseSummary('', 'en'),/No release highlights/)
})
test('installed changelog selects exactly the installed version, never the newest entry',()=>{
 const changelog='# Changelog\n## 2.0.0 — tomorrow\n- Newer changes\n## 1.2.0 — today\n- Installed change\n## 1.1.0\n- Older changes'
 assert.equal(changelogSection(changelog,'v1.2.0').trim(),'- Installed change')
 assert.equal(changelogSection(changelog,'v1.9.0'),'')
 const text=releaseDetails({tag:'v1.2.0',notes:changelogSection(changelog,'v1.2.0')})
 assert.match(text,/Installed change/);assert.doesNotMatch(text,/Newer changes|Older changes/)
 assert.match(text,/https:\/\/github.com\/zhangjingwei\/weixin-link\/releases\/tag\/v1.2.0/)
 assert.doesNotMatch(releaseDetails({tag:'../../invalid',notes:''}),/https:/)
})
