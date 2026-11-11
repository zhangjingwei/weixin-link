import {createHash, randomUUID} from 'node:crypto'
import {readFile, writeFile, rename, unlink, lstat} from 'node:fs/promises'
import {join} from 'node:path'

export function createUpdateNoticeStateStore(stateDir) {
  const path = owner => join(stateDir, 'update-notice-' + createHash('sha256').update(owner).digest('hex').slice(0, 24) + '.json')
  return {
    path,
    async read(owner) {
      const file = path(owner)
      let info
      try {info = await lstat(file)} catch (error) {if (error.code === 'ENOENT') return null; throw error}
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw Error('UPDATE_NOTICE_STATE_INVALID')
      return JSON.parse(await readFile(file, 'utf8'))
    },
    async write(owner, value) {
      const text=JSON.stringify(value)+'\n'
      if(Buffer.byteLength(text)>4096)throw Error('UPDATE_NOTICE_STATE_INVALID')
      const file = path(owner), temp = file + '.' + randomUUID() + '.tmp'
      try {await writeFile(temp, text, {flag: 'wx', mode: 0o600}); await rename(temp, file)}
      finally {await unlink(temp).catch(error => {if (error.code !== 'ENOENT') throw error})}
    },
  }
}
