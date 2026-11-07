const DAY = 86_400_000
const MINUTE = 60_000
const invalid = () => {throw Error('SCHEDULE_ARGUMENTS_INVALID')}

export function validateRepeat(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['frequency', 'time', 'timeZone', 'weekdays'].includes(key))) invalid()
  if (!['daily', 'weekly'].includes(value.frequency) || typeof value.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time) || typeof value.timeZone !== 'string' || value.timeZone.length > 100) invalid()
  try {new Intl.DateTimeFormat('en-US', {timeZone: value.timeZone})} catch {invalid()}
  if (value.frequency === 'daily' && value.weekdays !== undefined) invalid()
  if (value.frequency === 'weekly' && (!Array.isArray(value.weekdays) || !value.weekdays.length || value.weekdays.length > 7 || value.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7) || new Set(value.weekdays).size !== value.weekdays.length)) invalid()
  return structuredClone(value)
}

function parts(formatter, ms) {
  const value = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(part => [part.type, Number(part.value)]))
  return {year: value.year, month: value.month, day: value.day, hour: value.hour, minute: value.minute}
}
function localKey(value) {return `${value.year}-${value.month}-${value.day}`}
export function localDateAt(timeZone, ms) {
  const formatter = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
  return localKey(parts(formatter, ms))
}
function offset(formatter, ms) {
  const value = parts(formatter, ms)
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute) - Math.floor(ms / MINUTE) * MINUTE
}

export function nextOccurrence(repeat, afterMs, {skipLocalDate} = {}) {
  validateRepeat(repeat)
  const formatter = new Intl.DateTimeFormat('en-US', {timeZone: repeat.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'})
  const local = parts(formatter, afterMs), [hour, minute] = repeat.time.split(':').map(Number)
  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const date = new Date(Date.UTC(local.year, local.month - 1, local.day + dayOffset))
    const target = {year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute}
    if (localKey(target) === skipLocalDate) continue
    const weekday = (date.getUTCDay() + 6) % 7 + 1
    if (repeat.frequency === 'weekly' && !repeat.weekdays.includes(weekday)) continue
    const wallClock = Date.UTC(target.year, target.month - 1, target.day, hour, minute)
    const offsets = new Set([-DAY, -DAY / 2, 0, DAY / 2, DAY].map(delta => offset(formatter, wallClock + delta)))
    const matches = [...offsets].map(zoneOffset => wallClock - zoneOffset).filter(ms => ms > afterMs && localKey(parts(formatter, ms)) === localKey(target) && parts(formatter, ms).hour === hour && parts(formatter, ms).minute === minute).sort((a, b) => a - b)
    if (matches.length) return new Date(matches[0]).toISOString()
    // A nonexistent wall time during a spring DST transition is skipped for this date.
  }
  throw Error('SCHEDULE_TIME_INVALID')
}
