import { readFileSync } from 'node:fs'
import { wechatText } from '../../../src/infrastructure/wechat/text-format.mjs'
import { outputLinks } from '../../../src/infrastructure/media/outbound-media.mjs'

const deliveryHeading = text => text.split('📦 Zero · 交付').length === 2 && !text.includes('🛠️ Zero · 制作中')

const checks = {
  reproduce: text => /搜索/.test(text) && /```[^\n]*\ncd \/work\/toolbox\nnpm test\n```/.test(text),
  'project-status': text => ['知识库', '工具箱'].every(name =>
    text.split('\n').some(line => line.includes(name) && !(line.includes('知识库') && line.includes('工具箱')) &&
      (name === '知识库' ? /进行|执行|处理中|正在|索引中/ : /排队|队列|等待/).test(line))),
  'review-result': (text, links) => deliveryHeading(text) &&
    /12\s*份/.test(text) && /(?<!\d)2\s*份?[^。\n]{0,6}缺页|缺页[^。\n]{0,6}2/.test(text) && links.length === 0,
  'resend-csv': (text, links) => links.length === 1 &&
    links[0] === '/work/kb/outputs/check.csv' && text.includes('〔附件〕') && !text.includes('/work/kb/')
}
let failed = false
for (const path of process.argv.slice(2)) {
  const report = JSON.parse(readFileSync(path))
  for (const task of report.tasks) {
    const passed = task.runs.filter(run => run.status !== 'error' && checks[task.test_id](
      wechatText(run.final_output ?? ''), outputLinks(run.final_output ?? '')
    )).length
    console.log(path, task.test_id, passed + '/' + task.runs.length)
    if (passed !== task.runs.length) failed = true
  }
}
process.exitCode = failed ? 1 : 0
