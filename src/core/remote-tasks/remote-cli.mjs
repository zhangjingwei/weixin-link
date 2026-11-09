#!/usr/bin/env node
import {pathToFileURL} from 'node:url'
import {runRemoteCli} from '../../interfaces/cli/remote-cli.mjs'
export {runRemoteCli} from '../../interfaces/cli/remote-cli.mjs'
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await runRemoteCli()
