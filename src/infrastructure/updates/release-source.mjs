import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {githubLatestRelease} from '../../core/updates/releases.mjs'

export async function readInstalledRelease(sourceDir) {
  try {return JSON.parse(await readFile(join(sourceDir, '.weixin-link-release.json'), 'utf8'))}
  catch (error) {if (error.code === 'ENOENT') return null; throw error}
}

export {githubLatestRelease as fetchLatestRelease}
