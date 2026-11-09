// Compatibility entry point for callers that do not yet inject the delivery port.
import {recoverFailedFinal as recover} from '../../application/notifications/failed-final-recovery.mjs'
import {confirmedFinalRejection} from '../../infrastructure/wechat/delivery-evidence.mjs'

export function recoverFailedFinal(manager, key, deliver, confirmedRejection = confirmedFinalRejection) {
  return recover(manager, key, deliver, confirmedRejection)
}
