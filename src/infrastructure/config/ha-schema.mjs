const text = {type: 'string', minLength: 1, maxLength: 8192, pattern: '^[^\\r\\n\\u0000]+$'}
export default {
  type: 'object', additionalProperties: false,
  properties: {version: {const: 1}, baseUrl: {...text, format: 'http-url'}, token: text},
  required: ['version', 'baseUrl', 'token'],
}
