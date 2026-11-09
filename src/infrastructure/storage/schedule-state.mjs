import {randomUUID} from 'node:crypto'
import {mkdir, open, readFile, rename, unlink, lstat} from 'node:fs/promises'
import {join} from 'node:path'

const MAX_FILE_BYTES = 1024 * 1024
const code = value => Object.assign(Error(value), {code: value})

/** Account-local state file. Validation of schedule contents stays in the use case. */
export function createScheduleStateStore(stateDir) {
  const path = join(stateDir, 'schedules.json')
  return {
    async load() {
      await mkdir(stateDir, {recursive: true, mode: 0o700})
      let info
      try {info = await lstat(path)} catch (error) {
        if (error.code === 'ENOENT') return null
        throw code('SCHEDULE_STATE_INVALID')
      }
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_FILE_BYTES) throw code('SCHEDULE_STATE_INVALID')
      try {return JSON.parse(await readFile(path, 'utf8'))} catch {throw code('SCHEDULE_STATE_INVALID')}
    },
    async save(state) {
      const text = JSON.stringify(state) + '\n'
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw code('SCHEDULE_LIMIT')
      const temp = path + '.' + randomUUID() + '.tmp'
      let file
      try {
        file = await open(temp, 'wx', 0o600)
        await file.writeFile(text)
        await file.sync()
        await file.close(); file = null
        await rename(temp, path)
      } finally {
        await file?.close()
        await unlink(temp).catch(error => {if (error.code !== 'ENOENT') throw error})
      }
    },
  }
}
