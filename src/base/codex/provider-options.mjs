import {nativeMemoryConfig} from './native-memory.mjs'

const PRIMARY_PROVIDER_PREFIX = 'WECHAT_CODEX'
const FALLBACK_PROVIDER_PREFIX = 'WECHAT_CODEX_FALLBACK'
export const DEEPSEEK_FALLBACK_NOTICE = '⚠️ GPT 当前不可用，本次对话使用 DeepSeek 生成。'

export function codexProviderOptions(env = process.env, {prefix = PRIMARY_PROVIDER_PREFIX} = {}) {
  const value = name => env[`${prefix}_${name}`]?.trim()
  const provider = value('PROVIDER')
  if (provider && !/^[a-zA-Z0-9_-]+$/.test(provider)) throw Error('Invalid Codex provider')
  const reasoningEffort = value('REASONING_EFFORT')
  if (reasoningEffort && !['low','high','max'].includes(reasoningEffort)) throw Error('Invalid Codex reasoning effort')
  const model = value('MODEL')
  const overrides=[]
  if(provider){
    const baseUrl = value('BASE_URL')
    const apiKeyEnv = value('API_KEY_ENV') ?? 'DEEPSEEK_API_KEY'
    if(!baseUrl?.startsWith('https://'))throw Error('HTTPS Codex provider URL required')
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))throw Error('Invalid Codex provider API key environment name')
    const values={model,model_provider:provider,model_reasoning_effort:reasoningEffort,
      [`model_providers.${provider}.name`]:provider,
      [`model_providers.${provider}.base_url`]:baseUrl,
      [`model_providers.${provider}.wire_api`]:'responses',
      [`model_providers.${provider}.env_key`]:apiKeyEnv,
      [`model_providers.${provider}.requires_openai_auth`]:false,
      [`shell_environment_policy.filters.${apiKeyEnv}`]:'exclude'}
    for(const [key,item]of Object.entries(values))if(item!==undefined)overrides.push('-c',`${key}=${JSON.stringify(item)}`)
  }
  const search = value('WEB_SEARCH') ?? 'live'
  if (!['live', 'cached', 'disabled'].includes(search)) throw Error('Invalid Codex web search mode')
  return {
    args: ['app-server', ...Object.entries(nativeMemoryConfig).flatMap(([key,value])=>['-c',`${key}=${value}`]), ...overrides, '-c', `web_search="${search}"`, '--listen', 'stdio://'],
    thread: {...(model ? {model} : {}),
      ...(provider ? {modelProvider: provider} : {}),
      ...(reasoningEffort ? {reasoningEffort} : {})},
    provider: provider || null,
    prefix,
  }
}

export function codexFallbackProviderOptions(env = process.env) {
  if(!env[`${FALLBACK_PROVIDER_PREFIX}_PROVIDER`]?.trim())return null
  return codexProviderOptions(env,{prefix:FALLBACK_PROVIDER_PREFIX})
}

const PROVIDER_UNAVAILABLE_PATTERN=/(?:model.{0,80}(?:not found|not available|unsupported|unavailable|no access|unauthori[sz]ed|forbidden)|provider.{0,80}(?:not found|unsupported|unavailable|disabled)|(?:^|\D)(?:401|403|429)(?:\D|$)|rate.?limit|quota|unauthori[sz]ed|forbidden|overloaded|service unavailable|upstream|network|connection (?:closed|reset|refused)|ECONN(?:RESET|REFUSED)|ENOTFOUND|fetch failed|stream (?:error|disconnected))/i

export function isProviderAvailabilityFailure(error,{stage='connect'}={}) {
  if(error?.fallbackEligible===false)return false
  if(error?.connectionClosed||error?.requestTimeout)return true
  const message=String(error?.message??'')
  return Boolean(error?.definitiveRpcError&&PROVIDER_UNAVAILABLE_PATTERN.test(message))
}

export function providerEventCode(params={}) {
  const info=params.codexErrorInfo
  if(typeof info==='string')return info
  if(info&&typeof info==='object')return Object.keys(info)[0]
  return null
}

export function isIncompatibleThreadProvider(error) {
  if(!error?.definitiveRpcError)return false
  return /model provider .{0,100}(?:not found|unsupported|unavailable)/i.test(String(error.message??''))
}

export function providerEventFailure(params={}) {

  const code=providerEventCode(params)
  if(!code)return null
  const terminalEvents=new Set(['responseStreamConnectionFailed','responseTooManyFailedAttempts','unauthorized','usageLimitExceeded','rateLimitExceeded','serverOverloaded','httpConnectionFailed'])
  if(params.willRetry===true&&!terminalEvents.has(code))return null
  return Object.assign(Error(`Codex provider event: ${code}`),{definitiveRpcError:true,providerEventCode:code})
}
