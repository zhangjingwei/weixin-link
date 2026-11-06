export function setupMessage(action, result = {}) {
 switch (action) {
  case 'init': return `✓ 工作目录已准备：${result.workspace}\n  已保留现有账号与配置。`
  case 'deps': return '✓ 依赖安装完成。'
  case 'services': return '✓ 后台服务已准备，扫码登录后启动。'
  case 'pair': return result.status === 'already_pairing' ?
   '✓ 登录已在进行，正在获取二维码…' : '✓ 已发起微信登录，正在获取二维码…'
  case 'refresh-qr': return '✓ 登录二维码已刷新。'
  case 'qr': return '扫码并在手机上确认后，请在微信发送「安装状态」继续配置。'
  default: return JSON.stringify(result)
 }
}

export function setupError(error) {
 const code = /^[A-Z0-9_]+$/.test(error.message) ? error.message : error.code || 'SETUP_FAILED'
 const messages = {
  QR_NOT_READY_OR_EXPIRED:'暂未获取到有效二维码，请稍后重新运行安装命令刷新二维码。',
  QR_TOO_OLD_REFRESH_REQUIRED:'二维码已过期，请重新运行安装命令刷新二维码。',
  QR_REFRESH_REQUIRED:'当前二维码不可用，请重新运行安装命令刷新二维码。',
  QR_NOT_READY_RETRY:'二维码尚未准备好，请稍后重试。',
  ACCOUNT_ONLINE_NO_REFRESH_NEEDED:'微信账号已在线，无需重新扫码。请在微信发送「安装状态」。',
  STOP_ACCOUNT_BEFORE_RELOGIN:'微信账号已在线，请在微信发送「安装状态」继续。',
  INSTALLATION_ALREADY_CONFIGURED:'已有安装配置，请使用原工作目录继续安装。',
  INVALID_WORKSPACE:'工作目录必须是有效的绝对路径。',
  EXISTING_SERVICE_REQUIRES_REVIEW:'检测到未由本安装器管理的同名后台服务，已保留原配置。请先核对该服务的来源和启动路径，再决定是否迁移。',
  MACOS_SERVICE_NOT_FOUND:'macOS 登录服务尚未准备好，请稍后重新运行安装命令。',
  ENOENT:'缺少所需文件或命令，请检查安装目录和运行环境。',
  EACCES:'没有足够的访问权限，请检查安装目录权限。',
 }
 const detail=code==='EXISTING_SERVICE_REQUIRES_REVIEW'&&typeof error.servicePath==='string'?`\n冲突文件：${error.servicePath}`:''
 return `安装未完成：${messages[code] || '当前步骤执行失败，请检查网络和运行环境后重试。'}${detail}\n错误代码：${code}`
}

export const setupProgress = {
 init:'[1/5] 准备工作目录…', deps:'[2/5] 安装依赖，可能需要几分钟…',
 services:'[3/5] 配置后台服务…', pair:'[4/5] 发起微信登录…', qr:'[5/5] 获取登录二维码…',
}
