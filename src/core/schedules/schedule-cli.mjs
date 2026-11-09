#!/usr/bin/env node
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {runScheduleCommand} from '../../interfaces/cli/schedule-cli.mjs'
export {runScheduleCommand} from '../../interfaces/cli/schedule-cli.mjs'
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await runScheduleCommand()))}
  catch (error) {console.error(JSON.stringify({ok:false,error:/^SCHEDULE_[A-Z_]+$/.test(error.message)?error.message:'SCHEDULE_REQUEST_FAILED'}));process.exitCode=1}
}
