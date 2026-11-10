import {setupLanguage,installerCommand} from './setup-locale.mjs'

export function setupMessage(action, result = {}, language = setupLanguage()) {
 if(language==='en'){
  switch(action){
   case 'init':return `✓ Workspace ready: ${result.workspace}\n  Existing account and configuration data were preserved.`
   case 'deps':return '✓ Dependencies installed.'
   case 'services':return '✓ Background service prepared. It starts after WeChat pairing.'
   case 'pair':return result.status==='already_pairing'?'✓ WeChat pairing is already in progress…':'✓ WeChat pairing started…'
   case 'refresh-qr':return '✓ WeChat login address refreshed.'
   case 'create':return `✓ Account profile ${result.account} created.`
   case 'verify-wait':return result.pin_submitted?'✓ PIN submitted; WeChat login completed.':'✓ WeChat login completed; no PIN was required.'
   default:return JSON.stringify(result)
  }
 }
 switch (action) {
  case 'init': return `✓ 工作目录已准备：${result.workspace}\n  已保留现有账号与配置。`
  case 'deps': return '✓ 依赖安装完成。'
  case 'services': return '✓ 后台服务已准备，微信登录后启动。'
  case 'pair': return result.status === 'already_pairing' ?
   '✓ 登录已在进行，正在获取登录地址…' : '✓ 已发起微信登录，正在获取登录地址…'
  case 'refresh-qr': return '✓ 微信登录地址已刷新。'
  case 'create': return `✓ 已创建账号档案 ${result.account}。`
  case 'verify-wait': return result.pin_submitted?'✓ PIN 已提交，微信登录完成。':'✓ 微信登录完成，无需输入 PIN。'
  default: return JSON.stringify(result)
 }
}

export function setupError(error,language=setupLanguage()) {
 const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : error.code || 'SETUP_FAILED'
 const loginCommand=installerCommand('login',{language}),reloginCommand=installerCommand('relogin',{language})
 if(language==='en'){
  const english={QR_NOT_READY_OR_EXPIRED:'No current login address is available. Run '+loginCommand+' again.',QR_TOO_OLD_REFRESH_REQUIRED:'The login address expired. Run '+loginCommand+' again.',QR_REFRESH_REQUIRED:'The login address is unavailable. Run '+loginCommand+' again.',LOGIN_URL_NOT_READY_RETRY:'The login address is not ready. Retry '+loginCommand+' shortly.',VERIFICATION_NOT_REQUESTED:'WeChat has not requested a PIN, or this login has ended.',ACCOUNT_NOT_FOUND:'Account profile not found. Check the account name.',LOGIN_URL_UNAVAILABLE:'No usable HTTPS login address was returned. Retry login or check the WeChat service.',PIN_TERMINAL_REQUIRED:'WeChat requires a PIN. Run '+loginCommand+' in an interactive terminal.',VERIFICATION_WAIT_TIMEOUT:'WeChat login timed out. Request a new login address.',PAIRING_STOPPED:'WeChat pairing stopped. Check the account service before requesting another login address.',WECHAT_SERVICE_NOT_READY:'WeChat confirmed login, but the account service is not ready. Check its status before scanning again.',LOGIN_OR_START_FAILED:'Account registration or service startup did not finish after WeChat login. Check the account service.',ACCOUNT_ONLINE_NO_REFRESH_NEEDED:'This account is already online.',ACCOUNT_RUNNING_NOT_READY:'The account service is running. Rerun '+reloginCommand+' and choose 3 to authorize again.',ACCOUNT_STOP_UNCONFIRMED:'The account service could not be confirmed stopped. No new login address was generated.',VERIFICATION_FLOW_FAILED:'WeChat login did not complete. Check your phone or retry '+loginCommand+'.',INSTALLATION_ALREADY_CONFIGURED:'Installation is already configured. Continue with the existing workspace.',INVALID_WORKSPACE:'The workspace must be a valid absolute path.',EXISTING_SERVICE_REQUIRES_REVIEW:'An unmanaged service with the same name exists. Review its source before continuing.',MACOS_SERVICE_NOT_FOUND:'The macOS login service is not ready. Retry shortly.',INVALID_SETUP_LANGUAGE:'Use WEIXIN_LINK_LANG=zh or WEIXIN_LINK_LANG=en.',ENOENT:'A required file or command is missing.',EACCES:'Access denied. Check installation permissions.'}
  const detail=code==='EXISTING_SERVICE_REQUIRES_REVIEW'&&typeof error.servicePath==='string'?`\nConflicting file: ${error.servicePath}`:''
  return `Setup did not finish: ${english[code]??'Check the network and local environment, then retry.'}${detail}\nError code: ${code}`
 }
 const messages = {
  QR_NOT_READY_OR_EXPIRED:'暂未获取到有效登录地址，请稍后重新运行 '+loginCommand+'。',
  QR_TOO_OLD_REFRESH_REQUIRED:'登录地址已过期，请重新运行 '+loginCommand+'。',
  QR_REFRESH_REQUIRED:'当前登录地址不可用，请重新运行 '+loginCommand+'。',
  LOGIN_URL_NOT_READY_RETRY:'登录地址尚未准备好，请稍后重试 '+loginCommand+'。',
  VERIFICATION_NOT_REQUESTED:'微信尚未要求输入 PIN，或本次登录已经结束。请在手机确认当前登录状态。',
  ACCOUNT_NOT_FOUND:'未找到该账号档案，请核对账号名。',
  LOGIN_URL_UNAVAILABLE:'未获取到可用的 HTTPS 登录地址，请重试或检查微信服务。',PIN_TERMINAL_REQUIRED:'微信要求输入 PIN，请在交互式终端重新运行 '+loginCommand+'。',
  VERIFICATION_WAIT_TIMEOUT:'等待微信登录超时，请重新获取登录地址。',
  PAIRING_STOPPED:'微信登录进程已停止；请检查后台服务状态后再决定是否重新登录。',
  WECHAT_SERVICE_NOT_READY:'微信已确认登录，但助手后台尚未就绪；请检查服务状态，暂时不要重新扫码。',
  LOGIN_OR_START_FAILED:'微信登录后的账号保存或后台服务启动未完成；请检查服务状态。',
  ACCOUNT_ONLINE_NO_REFRESH_NEEDED:'微信账号已在线，无需重新登录。请在微信发送「安装状态」。',
  ACCOUNT_RUNNING_NOT_READY:'账号服务仍在运行。若需重新授权，请运行 '+reloginCommand+' 并选择 3。',
  ACCOUNT_STOP_UNCONFIRMED:'未能确认账号服务已安全停止，本次没有生成新登录地址。',
  VERIFICATION_FLOW_FAILED:'微信登录未完成，请检查手机确认或重新运行 '+loginCommand+'。',
  STOP_ACCOUNT_BEFORE_RELOGIN:'微信账号已在线，请在微信发送「安装状态」继续。',
  INSTALLATION_ALREADY_CONFIGURED:'已有安装配置，请使用原工作目录继续安装。',
  INVALID_WORKSPACE:'工作目录必须是有效的绝对路径。',
  INVALID_SETUP_LANGUAGE:'语言只支持 zh 或 en，可使用 --lang 指定。',
  EXISTING_SERVICE_REQUIRES_REVIEW:'检测到未由本安装器管理的同名后台服务，已保留原配置。请先核对该服务的来源和启动路径，再决定是否迁移。',
  MACOS_SERVICE_NOT_FOUND:'macOS 登录服务尚未准备好，请稍后重新运行安装命令。',
  ENOENT:'缺少所需文件或命令，请检查安装目录和运行环境。',
  EACCES:'没有足够的访问权限，请检查安装目录权限。',
 }
 const detail=code==='EXISTING_SERVICE_REQUIRES_REVIEW'&&typeof error.servicePath==='string'?`\n冲突文件：${error.servicePath}`:''
 return `安装未完成：${messages[code] || '当前步骤执行失败，请检查网络和运行环境后重试。'}${detail}\n错误代码：${code}`
}

export const setupProgress = {
 init:'[1/5] 准备工作目录…', deps:'[2/5] 安装依赖，可能需要几分钟…',wizard:'[3/5] 配置并测试模型…',
 services:'[4/5] 配置后台服务…', 'wechat-login':'[5/5] 连接微信…',
}
export const setupProgressEn={init:'[1/5] Preparing the workspace…',deps:'[2/5] Installing dependencies…',wizard:'[3/5] Configuring and testing a model…',services:'[4/5] Preparing the background service…','wechat-login':'[5/5] Connecting WeChat…'}
