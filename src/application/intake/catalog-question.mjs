// These requests belong to the current model turn, including its MCP pagination context.
export function isCatalogQuestion(text){
 return /^(?:请|帮我)?(?:看看|列出|查看)?(?:我)?(?:当前|目前|现在)?的?(?:都?有哪些|所有的?)(?:项目|会话|对话)[？?。]?$|^(?:看看|列出|查看)?(?:电脑|桌面|终端)(?:上|端)?最近的?(?:会话|对话)[。？?]?$|^更多会话[？?。]?$/u.test(text?.trim())
}

// A bare result lookup should preserve an open prompt and must not replay a failed delivery.
export function isResultLookup(text){
 return /^(?:结果|result)[。？！!?]?$/iu.test(text?.trim())
}
