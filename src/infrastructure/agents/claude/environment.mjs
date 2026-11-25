// Subscription credentials stay with the unmodified CLI. Never inherit API routing.
export function claudeEnvironment(source=process.env){
 return Object.fromEntries(Object.entries(source).filter(([key])=>!/^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_USE_|AWS_|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_CLOUD_|AZURE_|CLAUDE_CODE_API_KEY_HELPER)/.test(key)))
}
