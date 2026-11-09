/** Map a known WeChat context rejection to evidence the domain can evaluate. */
export function confirmedFinalRejection(recovery) {
  return recovery?.delivery_error?.api_code === -2
}
