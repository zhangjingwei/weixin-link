import {ConfigError} from './config-schema.mjs'

export async function readConfigStdin(input=process.stdin){let text='';for await(const chunk of input){text+=chunk;if(Buffer.byteLength(text)>1024*1024)throw new ConfigError('CONFIG_INPUT_TOO_LARGE')}let value;try{value=JSON.parse(text)}catch{throw new ConfigError('CONFIG_INVALID_JSON')};return value}
