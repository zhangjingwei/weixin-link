// Version-guarded patch: npm install reapplies it; only the CDN upload deadline changes.
import {readFileSync,writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {dirname,join} from 'node:path'
const require=createRequire(import.meta.url),entry=require.resolve('@wechatbot/wechatbot');
const path=join(dirname(entry),'media/uploader.js'),original=readFileSync(path,'utf8');
const marker='/* WECHAT_CDN_UPLOAD_TIMEOUT */';
if(!original.includes(marker)){
 if((original.match(/AbortSignal\.timeout\(60_000\)/g)||[]).length!==1)throw Error('SDK upload implementation changed; inspect before patching');
 const expression=`AbortSignal.timeout((()=>{ ${marker} const n=Number(process.env.WECHAT_CDN_UPLOAD_TIMEOUT_MS??300000); if(!Number.isSafeInteger(n)||n<1000||n>600000)throw new Error('Invalid WECHAT_CDN_UPLOAD_TIMEOUT_MS (1000..600000)'); return n; })())`;
 writeFileSync(path,original.replace('AbortSignal.timeout(60_000)',expression));
}
console.log('CDN upload deadline: configurable, default 300000ms; local guard 600000ms (not a server maximum)');
