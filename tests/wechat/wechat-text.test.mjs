import test from 'node:test'
import assert from 'node:assert/strict'
import {wechatText} from '../../src/wechat/wechat-text.mjs'
test('wide tables become phone-friendly records',()=>{const s=wechatText('当前：\n\n| 智能体 | 设备 | 用途 |\n| --- | --- | --- |\n| 微信助手 | 树莓派 | 调度 |\n| Spark | DGX | 开发 |\n\n结束');assert.equal(s,'当前：\n\n微信助手\n设备：树莓派\n用途：调度\n\nSpark\n设备：DGX\n用途：开发\n\n\n结束')})
test('table-like code is preserved',()=>{const s='```text\n| a | b |\n| --- | --- |\n| 1 | 2 |\n```';assert.equal(wechatText(s),s)})
test('long code packets each retain matching fences',async()=>{const {wechatParts}=await import('../../src/wechat/wechat-text.mjs'),parts=wechatParts('```js\n'+('console.log("test");\n'.repeat(180))+'```');assert.ok(parts.length>1);for(const p of parts){assert.ok(p.startsWith('```js\n'));assert.ok(p.endsWith('```'));assert.equal((p.match(/```/g)??[]).length,2)}})
test('headings, bold and bullets become readable WeChat text',()=>{
 assert.equal(wechatText('## **状态**\n- **树莓派**：在线\n+ __NAS__：在线\n1. 保留编号\n> 提示'), '状态\n• 树莓派：在线\n• NAS：在线\n1. 保留编号\n提示')
})
test('URLs, inline code and fenced programs preserve literal syntax',()=>{
 assert.equal(wechatText('`a ** b` 和 https://example.com/a_b?q=x*y\n```js\nconst x = "**bold**";\n```'),'a ** b 和 https://example.com/a_b?q=x*y\n```js\nconst x = "**bold**";\n```')
})
test('web links expose usable URL; local delivery labels hide transport paths',()=>{
 assert.equal(wechatText('[官网](https://example.com/a_b)\n![状态图](/tmp/status.png)\n[下载文件](</tmp/a b.csv>)'), '官网：https://example.com/a_b\n状态图\n下载文件')
})
test('table output retains the approved record layout while cleaning cell styles',()=>{
 assert.equal(wechatText('| 设备 | 状态 |\n| --- | --- |\n| **NAS** | `Up` |'), 'NAS\n状态：Up\n')
})
test('inline code inside link labels does not leak internal placeholders',()=>{
 assert.equal(wechatText('[`文件名`](https://example.com)'), '文件名：https://example.com')
})
