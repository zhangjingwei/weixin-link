import test from 'node:test'
import assert from 'node:assert/strict'
import {fetchDeepSeekBalance,formatDeepSeekBalance} from './deepseek-balance.mjs'

test('DeepSeek balance request is authenticated and normalized without exposing the key',async()=>{
 let request
 const result=await fetchDeepSeekBalance({
  env:{DEEPSEEK_API_KEY:'unit-test-key'},
  fetchImpl:async(url,options)=>{
   request={url,options}
   return {ok:true,status:200,json:async()=>({is_available:true,balance_infos:[{currency:'CNY',total_balance:'42.13',granted_balance:'0.00',topped_up_balance:'42.13'}]})}
  },
 })
 assert.equal(request.url,'https://api.deepseek.com/user/balance')
 assert.equal(request.options.headers.Authorization,'Bearer unit-test-key')
 assert.deepEqual(result,{isAvailable:true,balances:[{currency:'CNY',totalBalance:'42.13',grantedBalance:'0.00',toppedUpBalance:'42.13'}]})
 const text=formatDeepSeekBalance(result)
 assert.ok(text.includes('状态：可用'))
 assert.ok(text.includes('剩余总额：¥42.13'))
 assert.ok(!text.includes('unit-test-key'))
})

test('DeepSeek balance failures stay concise and do not echo credentials',async()=>{
 await assert.rejects(()=>fetchDeepSeekBalance({env:{}}),/密钥未配置/)
 await assert.rejects(()=>fetchDeepSeekBalance({env:{DEEPSEEK_API_KEY:'unit-test-key'},fetchImpl:async()=>({ok:false,status:401})}),/认证失败/)
 await assert.rejects(()=>fetchDeepSeekBalance({env:{DEEPSEEK_API_KEY:'unit-test-key'},fetchImpl:async()=>({ok:true,status:200,json:async()=>({})})}),/无效的余额数据/)
})
