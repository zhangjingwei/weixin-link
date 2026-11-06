import homeAssistant from './home-assistant/index.mjs'

// Bundled integrations are explicitly reviewed and registered, never loaded from user input.
export const integrations = Object.freeze([homeAssistant])
export function integrationById(id) {
  return integrations.find(item => item.manifest.id === id)
}
export function integrationByConfig(kind) {
  return integrations.find(item => item.manifest.configKind === kind)
}
