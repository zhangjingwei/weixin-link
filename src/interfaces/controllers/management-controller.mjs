import {installerCommand} from '../../setup/setup-locale.mjs'

/** Recovery commands from WeChat when model setup is unavailable. */
export function createManagementController({manager, jobs, runtime, setupReceipts, setupController, view}) {
  const acknowledge = message => jobs.acknowledge([message._ingressId].filter(Boolean))
  const desktopBlocked=async(message,deliver)=>{
    if(!manager?.state?.desktopHandoff)return false
    await deliver('桌面正在接续工作，暂不升级、重启或修改安装配置。请先完成并关闭桌面，再说“回到微信继续”。',{conversationControl:true})
    acknowledge(message);return true
  }
  return {
    async setup(action, message, deliver) {
      if(!['status','doctor','help','manual','manualEn'].includes(action)&&await desktopBlocked(message,deliver))return
      const receipt = message._setupReceiptId ? {id: message._setupReceiptId} : setupReceipts.capture(message)
      if (!receipt || !setupReceipts.claim(receipt.id)) {
        if (message._recovered) {
          await deliver('上次安装操作的结果需要核对，未重复执行。请在安装电脑运行 '+installerCommand('setup')+' 继续检查。', {conversationControl: true})
          acknowledge(message)
        }
        return
      }
      const token = manager.lifecycle.capture(message.userId)
      const reply = (value, options = {}) => {
        if (!token.current()) throw Error('SETUP_CANCELLED')
        return options.sensitive ? view.sensitive(message.userId, value) : deliver(value, {current: () => token.current(), conversationControl: true})
      }
      await runtime.track('setup', () => setupController.handle(action, reply, {
        signal: token.signal,
        scope: message._conversationOwner ?? message.userId,
        executionKey: message.userId,
      }))
      setupReceipts.finish(receipt.id)
      acknowledge(message)
    },
  }
}

export {runConfigurationAction} from '../../setup/config-action.mjs'
