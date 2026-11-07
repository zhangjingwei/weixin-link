const text = {type: 'string', minLength: 1, maxLength: 8192, pattern: '^[^\\r\\n\\u0000]+$'}
export default {
  type: 'object', additionalProperties: false,
  properties: {
    version: {const: 1},
    baseUrl: {...text, format: 'http-url'},
    feeds: {type: 'object', propertyNames: {pattern: '^[a-z][a-z0-9-]{0,31}$'}, additionalProperties: {type: 'string', minLength: 2, maxLength: 512, pattern: '^/[A-Za-z0-9_./%-]+$'}},
  },
  required: ['version', 'baseUrl', 'feeds'],
}
