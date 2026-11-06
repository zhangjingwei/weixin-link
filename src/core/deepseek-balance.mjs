const BALANCE_URL = 'https://api.deepseek.com/user/balance'

function money(currency, value) {
  if (typeof value !== 'string' || value.trim() === '') return '未提供'
  const symbol = { CNY: '¥', USD: '$' }[currency]
  return symbol ? `${symbol}${value}` : `${currency} ${value}`
}

export function formatDeepSeekBalance(result) {
  const state = result.isAvailable ? '可用' : '不可用'
  const sections = (result.balances ?? []).map(balance => [
    `币种：${balance.currency}`,
    `剩余总额：${money(balance.currency, balance.totalBalance)}`,
    `赠送余额：${money(balance.currency, balance.grantedBalance)}`,
    `充值余额：${money(balance.currency, balance.toppedUpBalance)}`,
  ].join('\n'))
  return [`DeepSeek API 余额`, `状态：${state}`, ...(sections.length ? sections : ['余额信息：未提供'])].join('\n\n')
}

export async function fetchDeepSeekBalance({env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 15_000} = {}) {
  const apiKey = env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) throw Error('DeepSeek API 密钥未配置。')
  if (typeof fetchImpl !== 'function') throw Error('当前运行环境不支持余额查询。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(BALANCE_URL, {
      method: 'GET',
      headers: {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'},
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) {
      if ([401, 403].includes(response.status)) throw Error('DeepSeek 余额查询认证失败。')
      if (response.status === 429) throw Error('DeepSeek 余额查询请求过于频繁，请稍后再试。')
      throw Error(`DeepSeek 余额查询失败（HTTP ${response.status}）。`)
    }
    let data
    try { data = await response.json() } catch { throw Error('DeepSeek 返回了无效的余额数据。') }
    if (typeof data?.is_available !== 'boolean' || (data.balance_infos !== undefined && !Array.isArray(data.balance_infos))) {
      throw Error('DeepSeek 返回了无效的余额数据。')
    }
    return {
      isAvailable: data.is_available,
      balances: (data.balance_infos ?? []).map(item => ({
        currency: typeof item?.currency === 'string' ? item.currency : '未知',
        totalBalance: typeof item?.total_balance === 'string' ? item.total_balance : '',
        grantedBalance: typeof item?.granted_balance === 'string' ? item.granted_balance : '',
        toppedUpBalance: typeof item?.topped_up_balance === 'string' ? item.topped_up_balance : '',
      })),
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw Error('DeepSeek 余额查询超时。')
    if (typeof error?.message === 'string' && error.message.startsWith('DeepSeek')) throw error
    throw Error('DeepSeek 余额查询失败。')
  } finally {
    clearTimeout(timer)
  }
}
