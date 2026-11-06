// Compatibility command; task orchestration lives in core/.
import {pathToFileURL} from 'node:url'
import {runRemoteCli} from '../core/remote-tasks/remote-cli.mjs'
export {runRemoteCli} from '../core/remote-tasks/remote-cli.mjs'
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runRemoteCli()
