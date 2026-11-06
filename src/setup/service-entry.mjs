// Task Scheduler has no per-action environment settings.
const id=process.argv[2]??'default'
if(!/^[a-z][a-z0-9-]{0,31}$/.test(id))throw Error('INVALID_ACCOUNT_ID')
process.env.WECHAT_ACCOUNT=id
process.env.HOME??=(await import('node:os')).homedir()
const {dirname,join,delimiter}=await import('node:path')
process.env.PATH=[dirname(process.execPath),join(process.env.HOME,'.local/bin'),process.env.PATH??''].join(delimiter)
await import('../wechat/bot.mjs')
