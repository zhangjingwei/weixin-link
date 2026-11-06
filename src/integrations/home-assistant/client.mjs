// Read-only client: all REST paths and WebSocket commands are fixed here.
export function createHaClient(config, {fetchImpl = globalThis.fetch, WebSocketImpl = globalThis.WebSocket} = {}) {
const haBaseUrl = config.baseUrl.replace(/\/$/, '')
const haToken = config.token
const readableDomains = new Set([
  'binary_sensor', 'climate', 'cover', 'fan', 'humidifier', 'light', 'lock',
  'media_player', 'sensor', 'switch', 'vacuum', 'water_heater', 'weather',
])
const visibleAttributes = [
  'unit_of_measurement', 'device_class', 'current_temperature', 'temperature',
  'current_humidity', 'humidity', 'hvac_action', 'hvac_mode', 'preset_mode',
  'brightness', 'percentage', 'current_position', 'battery', 'battery_level',
]
function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[\s_\-，,。.]+/g, '')
}

let registryCache
let registryCacheUntil = 0
let registryFetch
async function getHaRegistry() {
  if (registryCache && Date.now() < registryCacheUntil) return registryCache
  if (registryFetch) return registryFetch
  registryFetch = new Promise((resolve, reject) => {
    const url = `${haBaseUrl.replace(/^http/, 'ws')}/api/websocket`
    const socket = new WebSocketImpl(url)
    const results = new Map()
    let settled = false
    const timer = setTimeout(() => finish(new Error('Home Assistant registry timed out')), 10_000)

    function finish(error, registry) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.close()
      if (error) reject(error)
      else resolve(registry)
    }

    socket.addEventListener('message', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'auth_required') {
          socket.send(JSON.stringify({ type: 'auth', access_token: haToken }))
        } else if (data.type === 'auth_ok') {
          for (const [id, type] of [
            [1, 'config/area_registry/list'],
            [2, 'config/device_registry/list'],
            [3, 'config/entity_registry/list_for_display'],
          ]) socket.send(JSON.stringify({ id, type }))
        } else if (data.type === 'auth_invalid') {
          finish(new Error('Home Assistant registry authentication failed'))
        } else if (data.type === 'result') {
          if (!data.success) return finish(new Error('Home Assistant registry request failed'))
          results.set(data.id, data.result)
          if (results.size === 3) {
            finish(null, {
              areas: new Map(results.get(1).map((area) => [area.area_id, area.name])),
              devices: new Map(results.get(2).map((device) => [device.id, device])),
              entities: new Map(results.get(3).entities.map((entity) => [entity.ei, entity])),
            })
          }
        }
      } catch (error) {
        finish(error)
      }
    })
    socket.addEventListener('error', () => finish(new Error('Home Assistant registry connection failed')))
  }).then((registry) => {
    registryCache = registry
    registryCacheUntil = Date.now() + 5 * 60_000
    return registry
  }).finally(() => { registryFetch = undefined })
  return registryFetch
}

function getEntityMetadata(registry, entityId) {
  const entry = registry?.entities.get(entityId)
  const device = registry?.devices.get(entry?.di)
  const areaId = entry?.ai ?? device?.area_id
  return {
    area: registry?.areas.get(areaId) ?? null,
    device: device?.name_by_user ?? device?.name ?? null,
  }
}

async function searchHaEntities(query = '') {
  const response = await fetchImpl(haBaseUrl + '/api/states', { headers: { Authorization: 'Bearer ' + haToken }, redirect: 'error', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error('HA returned HTTP ' + response.status)
  const states = await response.json()
  let registry, registryWarning
  try { registry = await getHaRegistry() } catch (error) { registryWarning = 'HA_REGISTRY_UNAVAILABLE' }
  const needle = normalize(query)
  const entities = states.filter(item => readableDomains.has(item.entity_id?.split('.')[0])).map(item => {
    const metadata = getEntityMetadata(registry, item.entity_id)
    return {
      entity_id: item.entity_id, name: item.attributes?.friendly_name ?? item.entity_id,
      ...metadata, state: item.state, last_changed: item.last_changed,
      attributes: Object.fromEntries(visibleAttributes.filter(key => ['string','number','boolean'].includes(typeof item.attributes?.[key])).map(key => [key,item.attributes[key]])),
    }
  }).filter(item => !needle || normalize([item.entity_id,item.name,item.area,item.device].join(' ')).includes(needle))
  return { count: entities.length, entities, ...(registryWarning ? {warning: registryWarning} : {}) }
}

async function getHaHistory(entityId, requestedHours) {
  if (!/^[a-z0-9_]+\.[a-z0-9_]+$/.test(entityId) || !readableDomains.has(entityId.split('.')[0])) throw new Error('Invalid entity_id')
  const hours = Number(requestedHours)
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error('History window must be 1 to 168 hours')
  const end = new Date()
  const start = new Date(end.getTime() - hours * 3600_000)
  const url = new URL(haBaseUrl + '/api/history/period/' + encodeURIComponent(start.toISOString()))
  url.searchParams.set('filter_entity_id', entityId)
  url.searchParams.set('end_time', end.toISOString())
  url.searchParams.set('minimal_response', '')
  const response = await fetchImpl(url, { headers: { Authorization: 'Bearer ' + haToken }, redirect: 'error', signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error('HA history returned HTTP ' + response.status)
  const body = await response.json()
  if (!Array.isArray(body) || body.some(rows => !Array.isArray(rows))) throw new Error('HA_INVALID_RESPONSE')
  const records = body.flat().map(row => ({ state: row.state, last_changed: row.last_changed ?? row.last_updated }))
  return { entity_id: entityId, from: start.toISOString(), to: end.toISOString(), count: records.length, records }
}

return {
  states: searchHaEntities,
  history: getHaHistory,
  async health() {
    const response = await fetchImpl(haBaseUrl + '/api/config', {
      headers: {Authorization: 'Bearer ' + haToken}, redirect: 'error', signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) throw Error('HA_CONNECTION_FAILED')
    const data = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('HA_INVALID_RESPONSE')
    return {ok: true}
  },
}
}
