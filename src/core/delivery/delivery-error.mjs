const safeCode = value => /^[A-Z][A-Z0-9_]{1,39}$/.test(String(value ?? '')) ? String(value) : undefined
const safeInteger = value => Number.isInteger(value) ? value : undefined

// Never log raw messages, response bodies, URLs, headers or credentials.
export function deliveryError(error) {
  const code=safeCode(error?.code)
  const kind=error?.name==='ApiError'?'wechat_api':
    error?.name==='AuthError'?'wechat_auth':
    error?.name==='NoContextError'?'wechat_context':
    error?.name==='TransportError'?'wechat_transport':
    error?.name==='AbortError'||error?.name==='TimeoutError'?'timeout':
    'delivery_exception'
  const out={error_kind:kind}
  if(code)out.error_code=code
  const httpStatus=safeInteger(error?.httpStatus??error?.status??error?.statusCode??error?.response?.status)
  const apiCode=safeInteger(error?.errcode??error?.data?.errcode??error?.response?.data?.errcode)
  if(httpStatus!==undefined)out.http_status=httpStatus
  if(apiCode!==undefined)out.api_code=apiCode
  const apiReason=error?.payload?.errmsg
  if(apiReason==='prepare failed')out.api_reason='prepare_failed'
  else if(apiReason==='unknown error')out.api_reason='unknown_error'
  return out
}

/** Returns whether an error proves the request was rejected, or leaves delivery ambiguous. */
export function deliveryFailureState(error) {
  if(['failed','partial','unknown'].includes(error?.deliveryState))return error.deliveryState
  const code=safeCode(error?.code)
  if(['NO_CONTEXT','AUTH_ERROR','ERR_INVALID_ARG_TYPE'].includes(code))return 'failed'
  const httpStatus=safeInteger(error?.httpStatus??error?.status??error?.statusCode??error?.response?.status)
  const apiCode=safeInteger(error?.errcode??error?.data?.errcode??error?.response?.data?.errcode)
  if(error?.name==='ApiError'||code==='API_ERROR'){
    // Business-level API rejections and HTTP 4xx responses cannot have accepted the message.
    if(apiCode!==undefined&&apiCode!==0)return 'failed'
    if(httpStatus!==undefined&&httpStatus>=400&&httpStatus<500)return 'failed'
  }
  // Timeouts, transport failures and 5xx responses may happen after the server accepted a request.
  return 'unknown'
}
