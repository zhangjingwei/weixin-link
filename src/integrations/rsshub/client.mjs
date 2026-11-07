const MAX_BYTES = 1024 * 1024
function feedUrl(config, name) {
  if (!Object.hasOwn(config.feeds, name)) throw Error('INTEGRATION_ARGUMENTS_INVALID')
  const route = config.feeds[name]
  if (!/^\/[A-Za-z0-9_./%-]{1,512}$/.test(route) || route.split('/').includes('..') || route.startsWith('//') || /%(?:2f|5c|2e|00)/i.test(route) || !/^https?:$/.test(new URL(config.baseUrl).protocol)) throw Error('INTEGRATION_ARGUMENTS_INVALID')
  const url = new URL(route.slice(1), config.baseUrl.replace(/\/?$/, '/'))
  url.searchParams.set('format', 'json')
  return url
}
async function boundedText(response) {
  if (response.body?.getReader) {
    const reader = response.body.getReader(), chunks = []
    let size = 0
    try {
      while (true) {
        const {done, value} = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_BYTES) throw Error('RSSHUB_RESPONSE_TOO_LARGE')
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    return Buffer.concat(chunks, size).toString('utf8')
  }
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_BYTES) throw Error('RSSHUB_RESPONSE_TOO_LARGE')
  return text
}
export function createRsshubClient(config, {fetchImpl = globalThis.fetch} = {}) {
  async function latest(name, limit = 10) {
    const url = feedUrl(config, name)
    const response = await fetchImpl(url, {method: 'GET', headers: {accept: 'application/feed+json'}, redirect: 'error', signal: AbortSignal.timeout(10000)})
    if (!response.ok) throw Error('RSSHUB_FETCH_FAILED')
    const feed = JSON.parse(await boundedText(response))
    if (!feed || !Array.isArray(feed.items) || feed.items.length > 500) throw Error('RSSHUB_INVALID_FEED')
    return {source: name, title: String(feed.title ?? '').slice(0, 200), items: feed.items.slice(0, limit).map(item => ({
      title: String(item.title ?? '').slice(0, 300),
      url: typeof item.url === 'string' && /^https?:\/\//.test(item.url) ? item.url.slice(0, 2048) : null,
      published: typeof item.date_published === 'string' ? item.date_published.slice(0, 80) : null,
      summary: typeof item.summary === 'string' ? item.summary.replace(/<[^>]*>/g, ' ').slice(0, 1000) : typeof item.content_text === 'string' ? item.content_text.slice(0, 1000) : '',
    }))}
  }
  return {latest}
}
