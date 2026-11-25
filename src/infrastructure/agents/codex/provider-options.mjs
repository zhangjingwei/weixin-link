import {nativeMemoryConfig} from './native-memory.mjs'

import localTransport from './subscription-transport.json' with {type:'json'}

const httpSubscriptionProvider='weixin-subscription-http'
const PROVIDER_PREFIX = 'WECHAT_CODEX'

export function codexProviderOptions(env = process.env, {prefix = PROVIDER_PREFIX, subscriptionTransport = localTransport} = {}) {
  const value = name => env[`${prefix}_${name}`]?.trim()
  const provider = value('PROVIDER')
  if (provider && !/^[a-zA-Z0-9_-]+$/.test(provider)) throw Error('Invalid Codex provider')
  const reasoningEffort = value('REASONING_EFFORT')
  if (reasoningEffort && !['low','high','max'].includes(reasoningEffort)) throw Error('Invalid Codex reasoning effort')
  const model = value('MODEL')
  const contextWindow=value('CONTEXT_WINDOW')
  if(contextWindow&&!/^[1-9][0-9]{0,7}$/.test(contextWindow))throw Error('Invalid Codex model context window')
  const overrides=[]
  let credentialEnvKey
  if(provider){
    const baseUrl = value('BASE_URL')
    const apiKeyEnv = value('API_KEY_ENV')
    if(!baseUrl?.startsWith('https://'))throw Error('HTTPS Codex provider URL required')
    if(typeof apiKeyEnv!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv))throw Error('Invalid Codex provider API key environment name')
    credentialEnvKey=apiKeyEnv
    const values={model,model_provider:provider,model_reasoning_effort:reasoningEffort,...(contextWindow?{model_context_window:Number(contextWindow)}:{}),
      [`model_providers.${provider}.name`]:provider,
      [`model_providers.${provider}.base_url`]:baseUrl,
      [`model_providers.${provider}.wire_api`]:'responses',
      [`model_providers.${provider}.env_key`]:apiKeyEnv,
      [`model_providers.${provider}.requires_openai_auth`]:false,
      [`shell_environment_policy.filters.${apiKeyEnv}`]:'exclude'}
    for(const [key,item]of Object.entries(values))if(item!==undefined)overrides.push('-c',`${key}=${JSON.stringify(item)}`)
  }
  const httpSubscription=!provider && subscriptionTransport==='http'
  if(httpSubscription){
    const table='model_providers.'+httpSubscriptionProvider
    // Let Codex select the endpoint for its current login and manage token renewal.
    overrides.push('-c',`model_provider="${httpSubscriptionProvider}"`,
      '-c',`${table}.name="Weixin subscription HTTP"`,
      '-c',`${table}.wire_api="responses"`,
      '-c',`${table}.requires_openai_auth=true`,
      '-c',`${table}.supports_websockets=false`)
  }
  const threadProvider=httpSubscription?httpSubscriptionProvider:provider
  const search = value('WEB_SEARCH') ?? 'live'
  if (!['live', 'cached', 'disabled'].includes(search)) throw Error('Invalid Codex web search mode')
  return {
    args: ['app-server', ...Object.entries(nativeMemoryConfig).flatMap(([key,value])=>['-c',`${key}=${value}`]), ...overrides, '-c', `web_search="${search}"`, '--listen', 'stdio://'],
    thread: {...(model ? {model} : {}),
      ...(threadProvider ? {modelProvider: threadProvider} : {}),
      ...(reasoningEffort ? {reasoningEffort} : {})},
    provider: provider || null,
    credentialEnvKey,
    credentialReady: !provider || Boolean(env[credentialEnvKey]?.trim()),
    prefix,
  }
}

const knownErrorCodes=new Set([
  'contextWindowExceeded','sessionBudgetExceeded','usageLimitExceeded','rateLimitExceeded','flexUnavailable',
  'serverOverloaded','cyberPolicy','misalignmentPolicyViolation','tooManyDenials','httpConnectionFailed',
  'responseStreamConnectionFailed','internalServerError','unauthorized','badRequest','threadRollbackFailed',
  'sandboxError','responseStreamDisconnected','responseTooManyFailedAttempts','activeTurnNotSteerable','other',
])
export function providerEventCode(params={}) {
  const info=params.error?.codexErrorInfo??params.codexErrorInfo
  const code=typeof info==='string'?info:info && typeof info==='object'?Object.keys(info)[0]:null
  return knownErrorCodes.has(code)?code:null
}
