import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createRsshubClient} from '../../src/integrations/rsshub/client.mjs'
import {integrationStatus, setIntegrationEnabled, invokeIntegration} from '../../src/integrations/runtime.mjs'
import {configPath} from '../../src/setup/config-manager.mjs'
import {validateConfig} from '../../src/setup/config-schema.mjs'

const config = {baseUrl: 'http://rsshub.example.test', feeds: {tech: '/example/news'}}
async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'integration-rsshub-'))
  t.after(() => rm(home, {recursive: true, force: true}))
  const options = {home, account: 'default'}
  await mkdir(join(home, '.config/wechat-assistant'), {recursive: true})
  await writeFile(configPath('rsshub', options), JSON.stringify({version: 1, ...config}))
  return options
}

test('RSSHub uses only configured routes, JSON Feed, bounded GET and summaries', async () => {
  const calls = []
  const client = createRsshubClient(config, {fetchImpl: async (url, options) => {
    calls.push({url: String(url), options})
    return {ok: true, text: async () => JSON.stringify({title: 'Tech', items: [{title: 'News', url: 'https://news.example/item', summary: '<b>Summary</b>', date_published: '2026-11-06T00:00:00Z'}]})}
  }})
  const result = await client.latest('tech', 1)
  assert.deepEqual(result.items[0], {title: 'News', url: 'https://news.example/item', summary: ' Summary ', published: '2026-11-06T00:00:00Z'})
  assert.equal(calls[0].url, 'http://rsshub.example.test/example/news?format=json')
  assert.equal(calls[0].options.method, 'GET')
  assert.equal(calls[0].options.redirect, 'error')
  assert.ok(calls[0].options.signal instanceof AbortSignal)
  await assert.rejects(client.latest('unknown'), /INTEGRATION_ARGUMENTS_INVALID/)
  await assert.rejects(createRsshubClient({...config, feeds: {tech: '//other.test/feed'}}).latest('tech'), /INTEGRATION_ARGUMENTS_INVALID/)
  assert.equal(calls.length, 1)
})

test('RSSHub refuses oversized responses and invalid configuration routes', async () => {
  const client = createRsshubClient(config, {fetchImpl: async () => ({ok: true, text: async () => 'x'.repeat(1024 * 1024 + 1)})})
  await assert.rejects(client.latest('tech'), /RSSHUB_RESPONSE_TOO_LARGE/)
  assert.throws(() => validateConfig('rsshub', {...config, feeds: {tech: '/foo?url=secret'}}), /CONFIG_INVALID_STRING/)
})

test('RSSHub is denied until enabled per account and rechecked after disable', async t => {
  const options = await fixture(t), calls = []
  t.mock.method(globalThis, 'fetch', async url => {
    calls.push(String(url))
    return {ok: true, text: async () => JSON.stringify({title: 'Tech', items: []})}
  })
  await assert.rejects(invokeIntegration('rsshub', {operation: 'latest', source: 'tech'}, options), /INTEGRATION_DISABLED/)
  await setIntegrationEnabled('rsshub', true, options)
  assert.equal((await integrationStatus(options)).find(item => item.id === 'rsshub').valid, true)
  await assert.rejects(invokeIntegration('rsshub', {operation: 'latest', source: 'tech'}, {...options, account: 'second'}), /INTEGRATION_DISABLED/)
  await assert.rejects(invokeIntegration('rsshub', {operation: 'latest', source: 'unknown'}, options), /INTEGRATION_ARGUMENTS_INVALID/)
  assert.equal((await invokeIntegration('rsshub', {operation: 'latest', source: 'tech'}, options)).items.length, 0)
  await setIntegrationEnabled('rsshub', false, options)
  await assert.rejects(invokeIntegration('rsshub', {operation: 'latest', source: 'tech'}, options), /INTEGRATION_DISABLED/)
  assert.equal(calls.length, 2)
})
